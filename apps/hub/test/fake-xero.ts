import { ChannelError } from "../src/outbox/errors";
import type { XeroApi, XeroInvoice, XeroInvoiceInput } from "../src/xero/xero.client";

/** Simulator Xero: tidak menolak duplikat berdasarkan Idempotency-Key, agar yang diuji adalah jaminan hub sendiri. */
export class FakeXero implements XeroApi {
  invoices = new Map<string, XeroInvoice & { input: XeroInvoiceInput }>();
  payments: { invoiceId: string; amount: number; account: string }[] = [];
  contacts = new Map<string, string>(); contactCreates: { name: string; email: string | null }[] = [];
  currencies = new Set(["USD"]); accounts = new Set(["200", "090", "610"]);
  invoiceCreates = 0; failPaymentOnce = false; badCreds = false;
  /** Seperti Xero asli: hasil per Idempotency-Key disimpan, termasuk kegagalan, dan dikembalikan lagi untuk kunci yang sama. */
  private seen = new Map<string, { error?: ChannelError; invoice?: XeroInvoice & { input: XeroInvoiceInput } }>();
  keysUsed: string[] = [];
  async testConnection(codes: string[]) {
    if (this.badCreds) throw new ChannelError("Xero rejected the credentials: invalid_client (check the client ID and secret)", "auth");
    return { orgName: "Demo Company (Global)", baseCurrency: "USD", isDemo: true, scopes: ["accounting.invoices", "accounting.payments", "accounting.contacts", "accounting.settings.read"], missingAccounts: codes.filter((c) => !this.accounts.has(c)) };
  }
  async findContactByEmail(email: string) { await new Promise((r) => setTimeout(r, 3)); return this.contacts.get(email) ?? null; } // jeda jaringan
  async createContact(name: string, email: string | null, _key?: string) { await new Promise((r) => setTimeout(r, 3)); const id = "contact-" + this.contactCreates.length; this.contactCreates.push({ name, email }); if (email) this.contacts.set(email, id); return id; }
  async findInvoiceByReference(ref: string) { return this.invoices.get(ref) ?? null; }
  async createInvoice(i: XeroInvoiceInput, key: string) {
    this.keysUsed.push(key);
    const prior = this.seen.get(key);
    if (prior) { if (prior.error) throw prior.error; return prior.invoice!; }
    const reject = (m: string) => { const e = new ChannelError(m, "validation"); this.seen.set(key, { error: e }); return e; };
    if (!this.currencies.has(i.currency)) throw reject(`Organisation is not subscribed to currency ${i.currency}`);
    for (const l of i.lines) if (!this.accounts.has(l.accountCode)) throw reject(`Account code '${l.accountCode}' is not a valid code for this document.`);
    this.invoiceCreates++;
    const total = Math.round(i.lines.reduce((n, l) => n + l.quantity * l.unitAmount, 0) * 100) / 100;
    const inv = { CurrencyCode: i.currency, InvoiceID: "inv-" + this.invoiceCreates, Status: "AUTHORISED", Total: total, AmountDue: total, AmountPaid: 0, Reference: i.reference, input: i };
    this.invoices.set(i.reference, inv);
    this.seen.set(key, { invoice: inv });
    return inv;
  }
  async *listWeftInvoices() { for (const v of [...this.invoices.values()]) yield v; }
  async createPayment(invoiceId: string, account: string, amount: number) {
    if (this.failPaymentOnce) { this.failPaymentOnce = false; throw new ChannelError("Xero error HTTP 503", "transient"); }
    this.payments.push({ invoiceId, account, amount });
    for (const inv of this.invoices.values()) if (inv.InvoiceID === invoiceId) { inv.AmountDue = 0; inv.AmountPaid = inv.Total; inv.Status = "PAID"; }
  }
}

