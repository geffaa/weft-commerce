import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { exponent } from "@weft/shared";
import { DB, type Db } from "../db/db";
import { connection, ledgerLine, ledgerOrder } from "../db/schema";
import { ENV } from "../common/tokens";
import type { Env } from "../common/env";
import { decrypt, encrypt } from "../common/crypto";
import { ChannelError } from "../outbox/errors";
import type { Handler } from "../outbox/outbox.worker";
import { XeroClient, type XeroApi } from "./xero.client";

export type XeroSettings = { salesAccountCode: string; bankAccountCode: string };
export type XeroFactory = (c: { clientId: string; clientSecret: string }) => XeroApi;
const DEFAULTS: XeroSettings = { salesAccountCode: "200", bankAccountCode: "090" };

@Injectable()
export class XeroService {
  factory: XeroFactory = (c) => new XeroClient(c);
  private readonly cache = new Map<string, XeroApi>();
  private readonly locks = new Map<string, Promise<unknown>>();

  /** Serialkan pekerjaan dengan kunci yang sama dalam proses ini (mis. email pelanggan yang sama). */
  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.locks.set(key, next);
    try { return await next; } finally { if (this.locks.get(key) === next) this.locks.delete(key); }
  }

  constructor(@Inject(DB) private readonly db: Db, @Inject(ENV) private readonly env: Env) {}

  /** Uji dulu, simpan hanya bila lolos: akun penjualan/bank yang tak ada ditolak saat menyimpan, bukan saat faktur pertama. */
  async connect(input: { clientId: string; clientSecret: string; salesAccountCode?: string; bankAccountCode?: string }) {
    const settings: XeroSettings = { ...DEFAULTS, ...(input.salesAccountCode ? { salesAccountCode: input.salesAccountCode } : {}), ...(input.bankAccountCode ? { bankAccountCode: input.bankAccountCode } : {}) };
    const api = this.factory({ clientId: input.clientId, clientSecret: input.clientSecret });
    let t;
    try { t = await api.testConnection([settings.salesAccountCode, settings.bankAccountCode]); }
    catch (e) { if (e instanceof ChannelError) throw new UnprocessableEntityException(e.message); throw e; }
    if (t.missingAccounts.length) throw new UnprocessableEntityException(`Account code ${t.missingAccounts.join(", ")} does not exist (or is not active) in ${t.orgName}`);
    const values = {
      kind: "xero", shop: t.orgName, clientId: input.clientId, secretEnc: encrypt(input.clientSecret, this.env.HUB_ENCRYPTION_KEY),
      secretHint: "…" + input.clientSecret.slice(-4), scopes: t.scopes, env: t.isDemo ? "sandbox" : "live", status: "ok",
      settings: { ...settings, baseCurrency: t.baseCurrency }, lastCheckedAt: new Date(),
    };
    const [row] = await this.db.insert(connection).values(values).onConflictDoUpdate({ target: [connection.kind, connection.shop], set: values }).returning();
    this.cache.delete(row.id);
    return { row, baseCurrency: t.baseCurrency, isDemo: t.isDemo };
  }

  /** Uji ulang koneksi Xero: token, organisasi, dan akun yang dikonfigurasi masih ada. */
  async test(id: string) {
    const [row] = await this.db.select().from(connection).where(eq(connection.id, id));
    if (!row) throw new NotFoundException("Connection not found");
    try {
      const { api, settings } = await this.current();
      const t = await api.testConnection([settings.salesAccountCode, settings.bankAccountCode]);
      const ok = t.missingAccounts.length === 0;
      await this.db.update(connection).set({ status: ok ? "ok" : "failing", scopes: t.scopes, lastCheckedAt: new Date() }).where(eq(connection.id, id));
      return { ok, orgName: t.orgName, baseCurrency: t.baseCurrency, missingAccounts: t.missingAccounts };
    } catch (e) {
      await this.db.update(connection).set({ status: "failing", lastCheckedAt: new Date() }).where(eq(connection.id, id));
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async current() {
    const [row] = await this.db.select().from(connection).where(eq(connection.kind, "xero"));
    if (!row) throw new ChannelError("No Xero connection is configured", "validation");
    let api = this.cache.get(row.id);
    if (!api) { api = this.factory({ clientId: row.clientId, clientSecret: decrypt(row.secretEnc, this.env.HUB_ENCRYPTION_KEY) }); this.cache.set(row.id, api); }
    return { api, settings: { ...DEFAULTS, ...((row.settings as Partial<XeroSettings>) ?? {}) } };
  }

  /**
   * Handler outbox `xero.invoice`. Idempoten di tiga lapis: satu job per order (kunci outbox), pencarian faktur
   * berdasarkan Reference sebelum membuat, dan header Idempotency-Key. Kunci itu terikat ke JOB (bukan hanya order):
   * Xero menyimpan hasil per kunci, termasuk kegagalan, sehingga kunci yang sama setelah perbaikan akan terus
   * mengembalikan kegagalan lama. Retry di job yang sama (parameter sama) memakai ulang kunci; retry operator
   * (job baru) memakai kunci baru. Duplikat tetap dicegah oleh pencarian Reference. Jika proses mati setelah faktur dibuat
   * tetapi sebelum job selesai, percobaan ulang menemukan faktur yang sama dan hanya melengkapi pembayaran.
   */
  handler(): Handler {
    return async (job) => {
      const { orderId } = job.payload as { orderId: string };
      const [order] = await this.db.select().from(ledgerOrder).where(eq(ledgerOrder.id, orderId));
      if (!order) throw new ChannelError(`Order ${orderId} not found`, "validation");
      if (order.status !== "accepted") return; // tidak ditagihkan: tidak terpenuhi/dibatalkan
      const { api, settings } = await this.current();
      const lines = await this.db.select().from(ledgerLine).where(eq(ledgerLine.orderId, orderId));
      const exp = 10 ** exponent(order.currency);
      const major = (n: number) => Math.round(n) / exp;
      const reference = `WEFT-${order.id}`;

      let invoice = await api.findInvoiceByReference(reference);
      if (!invoice) {
        const email = order.customerEmail;
        // Cari-lalu-buat di bawah kunci per email: dua job bersamaan untuk pelanggan yang sama tidak membuat dua kontak.
        const contactId = await this.withLock(`contact:${email ?? order.id}`, async () => {
          const found = email ? await api.findContactByEmail(email) : null;
          return found ?? api.createContact(email ? (order.customerName ? `${order.customerName} (${email})` : email) : `Guest (${order.source} ${order.sourceRef})`, email, `contact:${order.id}:${job.id}`);
        });
        const items = lines.map((l) => ({ description: l.sku, quantity: l.qty, unitAmount: major(l.unitMinor), accountCode: settings.salesAccountCode }));
        const extra = order.totalMinor - lines.reduce((n, l) => n + l.qty * l.unitMinor, 0);
        if (extra !== 0) items.push({ description: "Shipping, tax and adjustments", quantity: 1, unitAmount: major(extra), accountCode: settings.salesAccountCode });
        const day = (order.paidAt ?? order.createdAt).toISOString().slice(0, 10);
        invoice = await api.createInvoice({ reference, contactId, currency: order.currency, date: day, dueDate: day, lines: items }, `invoice:${order.id}:${job.id}`);
      }
      await this.db.update(ledgerOrder).set({ xeroInvoiceId: invoice.InvoiceID }).where(eq(ledgerOrder.id, orderId));
      if (invoice.AmountDue > 0) {
        const day = (order.paidAt ?? order.createdAt).toISOString().slice(0, 10);
        await api.createPayment(invoice.InvoiceID, settings.bankAccountCode, invoice.AmountDue, day, `payment:${order.id}:${job.id}`);
      }
    };
  }
}
