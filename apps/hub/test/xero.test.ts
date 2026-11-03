import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { asRole, boot, reset } from "./helpers";
import { connection, exceptionItem, ledgerOrder, outbox } from "../src/db/schema";
import { XeroService } from "../src/xero/xero.service";
import { FakeXero } from "./fake-xero";
import { decrypt } from "../src/common/crypto";
import { env } from "./helpers";

let ctx: Awaited<ReturnType<typeof boot>>;
let xero: FakeXero;
let ops: { authorization: string };
const http = () => request(ctx.app.getHttpServer());
beforeAll(async () => { ctx = await boot(); });
afterAll(async () => { await ctx.app.close(); });
beforeEach(async () => {
  await reset(ctx.db);
  xero = new FakeXero();
  ctx.app.get(XeroService)["cache"].clear();
  ctx.app.get(XeroService).factory = () => xero;
  ops = await asRole(ctx, "ops");
  ctx.handlers["stock.push"] = async () => {}; // tak ada koneksi Shopify di tes ini; yang diuji hanya sisi Xero
});

const connect = (extra: object = {}) => http().post("/connections/xero").set(ops).send({ clientId: "cid", clientSecret: "xero_secret_9999", ...extra });
const order = (ref: string, over: Partial<Parameters<typeof ctx.ledger.ingestOrder>[0]> = {}) => ctx.ledger.ingestOrder({
  source: "shopify", sourceRef: ref, currency: "USD", totalMinor: 2985, customerEmail: "sam@example.com", customerName: "Sam Reyes",
  lines: [{ sku: "HM-BP-0196", qty: 1, unitMinor: 2490 }], ...over,
});
const drain = async (at = new Date()) => { let t = { done: 0, retried: 0, dead: 0 }; for (let i = 0; i < 100; i++) { const r = await ctx.worker.tick(at, 200); t = { done: t.done + r.done, retried: t.retried + r.retried, dead: t.dead + r.dead }; if (!r.done && !r.retried && !r.dead) break; } return t; };
const makeDue = () => ctx.db.update(outbox).set({ nextAttemptAt: new Date(0) }).where(sql`status = 'pending'`);

describe("connecting Xero", () => {
  it("rejects bad credentials and unknown account codes without saving anything", async () => {
    xero.badCreds = true;
    const a = await connect();
    expect(a.status).toBe(422); expect(a.body.message).toContain("rejected the credentials");
    xero.badCreds = false;
    const b = await connect({ salesAccountCode: "999" });
    expect(b.status).toBe(422); expect(b.body.message).toBe("Account code 999 does not exist (or is not active) in Demo Company (Global)");
    expect(await ctx.db.select().from(connection)).toHaveLength(0);
  });

  it("saves an encrypted connection with the org, currency and account settings", async () => {
    const r = await connect();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: "xero", shop: "Demo Company (Global)", env: "sandbox", baseCurrency: "USD", isDemo: true, secretHint: "…9999" });
    expect(JSON.stringify(r.body)).not.toContain("xero_secret_9999");
    const [row] = await ctx.db.select().from(connection);
    expect(decrypt(row.secretEnc, env.HUB_ENCRYPTION_KEY)).toBe("xero_secret_9999");
    expect(row.settings).toMatchObject({ salesAccountCode: "200", bankAccountCode: "090" });
  });

  it("re-testing a Xero connection uses Xero, and flags it failing when a configured account disappears", async () => {
    const { body: c } = await connect();
    expect((await http().post(`/connections/${c.id}/test`).set(ops)).body).toMatchObject({ ok: true, orgName: "Demo Company (Global)", baseCurrency: "USD" });
    xero.accounts.delete("090");
    const r = await http().post(`/connections/${c.id}/test`).set(ops);
    expect(r.body).toMatchObject({ ok: false, missingAccounts: ["090"] });
    expect((await ctx.db.select().from(connection))[0].status).toBe("failing");
  });

  it("only Ops (or Owner) can connect", async () => {
    expect((await http().post("/connections/xero").set(await asRole(ctx, "finance")).send({ clientId: "a", clientSecret: "b" })).status).toBe(403);
  });
});

describe("invoice outbox", () => {
  beforeEach(async () => { await ctx.inventory.adjust("HM-BP-0196", 1000, "seed", "seed:1"); });

  it("queues no invoice job without a Xero connection, and none for an order that cannot be fulfilled", async () => {
    await order("a1");
    expect((await ctx.db.select().from(outbox)).filter((o) => o.topic === "xero.invoice")).toHaveLength(0);
    await connect();
    await order("a2", { lines: [{ sku: "HM-BP-0196", qty: 5000, unitMinor: 1 }] });
    expect((await ctx.db.select().from(outbox)).filter((o) => o.topic === "xero.invoice")).toHaveLength(0);
  });

  it("creates one invoice and one payment per paid order, totals matching the order", async () => {
    await connect();
    const r = await order("b1");
    expect(r.outcome).toBe("accepted");
    expect((await drain()).done).toBeGreaterThanOrEqual(1);
    const inv = [...xero.invoices.values()];
    expect(inv).toHaveLength(1);
    expect(inv[0].Reference).toBe("WEFT-" + (r as { orderId: string }).orderId);
    expect(inv[0].input.lines.map((l) => [l.description, l.unitAmount, l.accountCode])).toEqual([["HM-BP-0196", 24.9, "200"], ["Shipping, tax and adjustments", 4.95, "200"]]);
    expect(inv[0].Total).toBe(29.85);
    expect(xero.payments).toEqual([{ invoiceId: inv[0].InvoiceID, amount: 29.85, account: "090" }]);
    const [o] = await ctx.db.select().from(ledgerOrder);
    expect(o.xeroInvoiceId).toBe(inv[0].InvoiceID);
  });

  it("the same order delivered three times yields one invoice", async () => {
    await connect();
    for (let i = 0; i < 3; i++) await order("c1");
    await drain();
    expect(xero.invoiceCreates).toBe(1);
    expect(xero.payments).toHaveLength(1);
  });

  it("two jobs for the same customer running at the same time create only one contact", async () => {
    await connect();
    await Promise.all(Array.from({ length: 20 }, (_, i) => order(`same-${i}`)));
    await drain();
    expect(xero.invoiceCreates).toBe(20);
    expect(xero.contactCreates).toHaveLength(1);
  });

  it("reuses a contact by email, and falls back to a guest contact without one", async () => {
    await connect();
    await order("d1"); await order("d2"); await order("d3", { customerEmail: null, customerName: null });
    await drain();
    expect(xero.contactCreates.map((c) => c.name).sort()).toEqual(["Guest (shopify d3)", "Sam Reyes (sam@example.com)"]);
  });

  it("a crash after the invoice is created but before the job finishes does not create a second invoice", async () => {
    await connect();
    xero.failPaymentOnce = true; // faktur sudah dibuat, lalu pembayaran gagal
    await order("e1");
    expect((await drain()).retried).toBe(1);
    expect(xero.invoiceCreates).toBe(1); expect(xero.payments).toHaveLength(0);
    await makeDue(); await drain(new Date(Date.now() + 3600_000));
    expect(xero.invoiceCreates).toBe(1);
    expect(xero.payments).toHaveLength(1);
  });

  it("a Xero rejection lands in Exceptions with Xero's own words, and heals after the fix and a retry", async () => {
    await connect();
    await order("f1", { currency: "GBP" }); // organisasi hanya mengaktifkan USD
    expect((await drain()).dead).toBe(1);
    const [ex] = await ctx.db.select().from(exceptionItem);
    expect(ex).toMatchObject({ errorClass: "validation", message: "Organisation is not subscribed to currency GBP", state: "open" });
    expect(xero.invoiceCreates).toBe(0);

    xero.currencies.add("GBP"); // operator mengaktifkan GBP di Xero
    expect((await http().post(`/exceptions/${ex.id}/retry`).set(ops)).body.state).toBe("resolved");
    await makeDue();
    expect((await drain()).done).toBeGreaterThanOrEqual(1);
    expect(xero.invoiceCreates).toBe(1);
    expect([...xero.invoices.values()][0].input.currency).toBe("GBP");
    // kunci idempotensi retry operator berbeda dari kunci percobaan yang gagal (kunci lama akan memutar ulang kegagalan)
    expect(new Set(xero.keysUsed).size).toBe(2);
  });

  it("a wrong account code appears as a readable exception", async () => {
    await connect();
    xero.accounts.delete("200"); // akun dihapus di Xero setelah koneksi disimpan
    await order("g1");
    await drain();
    const [ex] = await ctx.db.select().from(exceptionItem);
    expect(ex.message).toBe("Account code '200' is not a valid code for this document.");
  });
});

describe("replay and crash", () => {
  it("replaying 10,000 events (2,000 orders x 5 deliveries, concurrent) creates 0 duplicate invoices", async () => {
    await connect();
    const skus = ["R1", "R2", "R3", "R4", "R5"];
    for (const s of skus) await ctx.inventory.adjust(s, 100_000, "seed", "seed:" + s);
    const events = Array.from({ length: 2000 }, (_, i) => Array.from({ length: 5 }, () => i)).flat();
    for (let i = events.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [events[i], events[j]] = [events[j], events[i]]; }
    const results: string[] = [];
    for (let i = 0; i < events.length; i += 50) {
      const batch = await Promise.all(events.slice(i, i + 50).map((n) => order(`replay-${n}`, { customerEmail: `c${n % 50}@example.com`, lines: [{ sku: skus[n % 5], qty: 1, unitMinor: 2985 }] })));
      results.push(...batch.map((b) => b.outcome));
    }
    expect(results.filter((r) => r === "accepted")).toHaveLength(2000);
    expect(results.filter((r) => r === "duplicate")).toHaveLength(8000);
    expect(await ctx.db.select().from(ledgerOrder)).toHaveLength(2000);
    expect((await ctx.db.select().from(outbox)).filter((o) => o.topic === "xero.invoice")).toHaveLength(2000);

    await drain();
    expect(xero.invoiceCreates).toBe(2000);
    expect(xero.invoices.size).toBe(2000);
    expect(xero.payments).toHaveLength(2000);
    expect(new Set(xero.payments.map((p) => p.invoiceId)).size).toBe(2000);
    expect(xero.contactCreates).toHaveLength(50);
  }, 180_000);

  it("a worker killed mid-batch resumes: every order is invoiced exactly once", async () => {
    await connect();
    await ctx.inventory.adjust("K1", 10_000, "seed", "seed:k");
    for (let i = 0; i < 300; i++) await order(`kill-${i}`, { lines: [{ sku: "K1", qty: 1, unitMinor: 2985 }] });
    await ctx.db.delete(outbox).where(eq(outbox.topic, "stock.push")); // hanya job faktur, agar hitungan klaim pasti
    const t0 = new Date();
    const claimed = await ctx.worker.claim(t0, 120); // worker "mati" setelah mengklaim 120 job, tanpa menyelesaikannya
    expect(claimed.length).toBe(120);
    expect(xero.invoiceCreates).toBe(0);
    const early = await drain(new Date(t0.getTime() + 10_000)); // lease belum habis: 120 itu tidak disentuh
    expect(early.done).toBe(180);
    expect(xero.invoiceCreates).toBe(180);
    const later = await drain(new Date(t0.getTime() + 120_000)); // lease kedaluwarsa: sisanya direklaim
    expect(later.done).toBe(120);
    expect(xero.invoiceCreates).toBe(300);
    expect(xero.payments).toHaveLength(300);
    expect(new Set([...xero.invoices.keys()]).size).toBe(300);
  }, 120_000);
});
