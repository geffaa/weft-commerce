import { ChannelError } from "../outbox/errors";

export type XeroCreds = { clientId: string; clientSecret: string };
export const XERO_SCOPES = "accounting.invoices accounting.payments accounting.contacts accounting.settings.read";
export type XeroInvoice = { InvoiceID: string; InvoiceNumber?: string; Status: string; Total: number; AmountDue: number; AmountPaid: number; Reference?: string; CurrencyCode?: string };
export type XeroInvoiceInput = {
  reference: string; contactId: string; currency: string; date: string; dueDate: string;
  lines: { description: string; quantity: number; unitAmount: number; accountCode: string }[];
};

/** Antarmuka yang dipakai layanan (dan tiruan di tes). */
export interface XeroApi {
  testConnection(accountCodes: string[]): Promise<{ orgName: string; baseCurrency: string; isDemo: boolean; scopes: string[]; missingAccounts: string[] }>;
  findContactByEmail(email: string): Promise<string | null>;
  createContact(name: string, email: string | null, idempotencyKey: string): Promise<string>;
  findInvoiceByReference(reference: string): Promise<XeroInvoice | null>;
  /** Semua faktur yang dibuat Weft (Reference berawalan WEFT-), untuk rekonsiliasi. */
  listWeftInvoices(): AsyncGenerator<XeroInvoice>;
  createInvoice(input: XeroInvoiceInput, idempotencyKey: string): Promise<XeroInvoice>;
  createPayment(invoiceId: string, accountCode: string, amount: number, date: string, idempotencyKey: string): Promise<void>;
}

type Fetch = typeof fetch;
const API = "https://api.xero.com/api.xro/2.0";

/** Pesan validasi Xero ada di Elements[].ValidationErrors[].Message; tampilkan apa adanya agar terbaca di Exceptions. */
function validationMessage(body: any): string {
  const msgs: string[] = [];
  for (const el of body?.Elements ?? []) for (const e of el.ValidationErrors ?? []) msgs.push(e.Message);
  return msgs.length ? msgs.join("; ") : body?.Message ?? body?.Detail ?? "Xero rejected the request";
}

export class XeroClient implements XeroApi {
  private token?: { value: string; expiresAt: number };
  private tenantId?: string;
  constructor(private readonly creds: XeroCreds, private readonly opts: { fetch?: Fetch; now?: () => number } = {}) {}
  private get f() { return this.opts.fetch ?? fetch; }
  private now() { return (this.opts.now ?? Date.now)(); }

  /** client_credentials: token hanya berlaku 30 menit, jadi diperbarui dengan margin 60 detik. */
  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const res = await this.f("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: { authorization: "Basic " + Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: XERO_SCOPES }),
    });
    const b = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !b.access_token) throw new ChannelError(`Xero rejected the credentials: ${b.error ?? "HTTP " + res.status} (check the client ID and secret)`, res.status >= 500 ? "transient" : "auth");
    this.token = { value: b.access_token, expiresAt: this.now() + (b.expires_in ?? 1800) * 1000 };
    return b.access_token;
  }

  private async tenant(): Promise<string> {
    if (this.tenantId) return this.tenantId;
    const res = await this.f("https://api.xero.com/connections", { headers: { authorization: `Bearer ${await this.accessToken()}` } });
    const list = (await res.json().catch(() => [])) as { tenantId: string }[];
    if (!res.ok || !Array.isArray(list) || !list.length) throw new ChannelError("This Xero app is not connected to any organisation", "auth");
    return (this.tenantId = list[0].tenantId);
  }

  private async call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string, retried = false): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${await this.accessToken()}`, "xero-tenant-id": await this.tenant(), accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey.slice(0, 128);
    const res = await this.f(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401 && !retried) { this.token = undefined; return this.call<T>(method, path, body, idempotencyKey, true); }
    if (res.status === 401 || res.status === 403) throw new ChannelError(`Xero denied access (HTTP ${res.status})`, "auth");
    if (res.status === 429) throw new ChannelError(`Xero rate limit (${res.headers.get("x-rate-limit-problem") ?? "unknown"})`, "rate_limit", Number(res.headers.get("retry-after") ?? 30) * 1000);
    if (res.status >= 500) throw new ChannelError(`Xero error HTTP ${res.status}`, "transient");
    const json = (await res.json().catch(() => ({}))) as any;
    if (res.status === 400 || res.status === 404 || res.status === 409) throw new ChannelError(validationMessage(json), "validation");
    if (!res.ok) throw new ChannelError(`Xero error HTTP ${res.status}`, "transient");
    return json as T;
  }

  async testConnection(accountCodes: string[]) {
    const org = (await this.call<{ Organisations: { Name: string; BaseCurrency: string; IsDemoCompany: boolean }[] }>("GET", "/Organisation")).Organisations[0];
    const accounts = (await this.call<{ Accounts: { Code: string; Status: string }[] }>("GET", "/Accounts")).Accounts;
    const active = new Set(accounts.filter((a) => a.Status === "ACTIVE").map((a) => a.Code));
    // Scope yang diberikan dibaca dari token: respons token menyertakan "scope".
    const t = await this.f("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: { authorization: "Basic " + Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: XERO_SCOPES }),
    }).then((r) => r.json()).catch(() => ({})) as { scope?: string };
    return { orgName: org.Name, baseCurrency: org.BaseCurrency, isDemo: org.IsDemoCompany, scopes: (t.scope ?? "").split(" ").filter(Boolean), missingAccounts: accountCodes.filter((c) => !active.has(c)) };
  }

  async findContactByEmail(email: string) {
    const q = new URLSearchParams({ where: `EmailAddress=="${email.replace(/"/g, "")}"` });
    const d = await this.call<{ Contacts: { ContactID: string }[] }>("GET", `/Contacts?${q}`);
    return d.Contacts[0]?.ContactID ?? null;
  }

  async createContact(name: string, email: string | null, idempotencyKey: string) {
    const d = await this.call<{ Contacts: { ContactID: string }[] }>("POST", "/Contacts", { Contacts: [{ Name: name, ...(email ? { EmailAddress: email } : {}) }] }, idempotencyKey);
    return d.Contacts[0].ContactID;
  }

  async findInvoiceByReference(reference: string) {
    const q = new URLSearchParams({ where: `Reference=="${reference.replace(/"/g, "")}"` });
    const d = await this.call<{ Invoices: XeroInvoice[] }>("GET", `/Invoices?${q}`);
    return d.Invoices.find((i) => i.Status !== "DELETED" && i.Status !== "VOIDED") ?? null;
  }

  async *listWeftInvoices(): AsyncGenerator<XeroInvoice> {
    const where = encodeURIComponent('Reference!=null && Reference.StartsWith("WEFT-")');
    for (let page = 1; ; page++) {
      const d = await this.call<{ Invoices: XeroInvoice[] }>("GET", `/Invoices?where=${where}&page=${page}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID,VOIDED,DELETED`);
      yield* d.Invoices;
      if (d.Invoices.length < 100) return; // Xero memberi 100 per halaman
    }
  }

  async createInvoice(i: XeroInvoiceInput, idempotencyKey: string) {
    const d = await this.call<{ Invoices: XeroInvoice[] }>("POST", "/Invoices", { Invoices: [{
      Type: "ACCREC", Reference: i.reference, Contact: { ContactID: i.contactId }, CurrencyCode: i.currency,
      Date: i.date, DueDate: i.dueDate, Status: "AUTHORISED", LineAmountTypes: "NoTax",
      LineItems: i.lines.map((l) => ({ Description: l.description, Quantity: l.quantity, UnitAmount: l.unitAmount, AccountCode: l.accountCode, TaxType: "NONE" })),
    }] }, idempotencyKey);
    return d.Invoices[0];
  }

  async createPayment(invoiceId: string, accountCode: string, amount: number, date: string, idempotencyKey: string) {
    await this.call("POST", "/Payments", { Payments: [{ Invoice: { InvoiceID: invoiceId }, Account: { Code: accountCode }, Date: date, Amount: amount }] }, idempotencyKey);
  }
}
