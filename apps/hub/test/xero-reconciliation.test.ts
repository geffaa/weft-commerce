import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { asRole, boot, reset } from "./helpers";
import { FakeXero } from "./fake-xero";
import { connection, ledgerOrder, outbox, run } from "../src/db/schema";
import { XeroService } from "../src/xero/xero.service";

let ctx: Awaited<ReturnType<typeof boot>>;
let xero: FakeXero;
let ops: { authorization: string };
const http = () => request(ctx.app.getHttpServer());
beforeAll(async () => { ctx = await boot(); });
afterAll(async () => { await ctx.app.close(); });
beforeEach(async () => {
  await reset(ctx.db);
  xero = new FakeXero();
  const svc = ctx.app.get(XeroService); svc["cache"].clear(); svc.factory = () => xero;
  ctx.handlers["stock.push"] = async () => {};
  ops = await asRole(ctx, "ops");
  await ctx.inventory.adjust("HM-BP-0196", 1000, "seed", "seed:1");
});

const connect = () => http().post("/connections/xero").set(ops).send({ clientId: "c", clientSecret: "xero_secret_9999" });
const order = (ref: string, over: object = {}) => ctx.ledger.ingestOrder({ source: "shopify", sourceRef: ref, currency: "USD", totalMinor: 3100, customerEmail: "sam@example.com",
  lines: [{ sku: "HM-BP-0196", qty: 1, unitMinor: 2500 }], ...over } as never) as Promise<{ outcome: string; orderId: string }>;
const drain = async () => { for (let i = 0; i < 20; i++) { const r = await ctx.worker.tick(new Date(Date.now() + 3600_000), 200); if (!r.done && !r.retried && !r.dead) break; } };
const recon = () => http().post("/reconciliation/run").set(ops).send({ kind: "xero" });
const fix = (id: string, body: object = {}) => http().post(`/reconciliation/${id}/fix`).set(ops).send(body);
const inv = (orderId: string) => xero.invoices.get(`WEFT-${orderId}`)!;

describe("Xero reconciliation", () => {
  it("needs a Xero connection", async () => {
    expect((await recon()).status).toBe(404);
  });

  it("is clean when every paid order has a matching, paid invoice", async () => {
    await connect(); await order("a"); await order("b"); await drain();
    const r = await recon();
    expect(r.body.summary).toEqual({ checked: 2, missingInvoice: 0, unpaid: 0, amountMismatch: 0, voided: 0 });
  });

  it("orders that arrived before Xero was connected show up and are backfilled by fix", async () => {
    const early = await order("early"); // sem conexão Xero: nenhum job de fatura
    expect((await ctx.db.select().from(outbox)).filter((o) => o.topic === "xero.invoice")).toHaveLength(0);
    await connect();
    const r = await recon();
    expect(r.body.summary.missingInvoice).toBe(1);
    expect(r.body.diffs[0]).toMatchObject({ orderId: early.orderId, kind: "missing_invoice", fixable: true, pendingJob: false, invoiceId: null });

    const f = await fix(r.body.reportId);
    expect(f.body.queued).toBe(1);
    await drain();
    expect(inv(early.orderId)).toMatchObject({ Status: "PAID" });
    expect((await recon()).body.summary.missingInvoice).toBe(0);
  });

  it("flags an unpaid invoice and fix settles it without creating a second invoice", async () => {
    await connect();
    const o = await order("p"); xero.failPaymentOnce = true; await drain();
    expect(inv(o.orderId).AmountDue).toBeGreaterThan(0);
    await ctx.db.update(outbox).set({ status: "dead" }); // o job de retry foi abandonado
    const r = await recon();
    expect(r.body.diffs[0]).toMatchObject({ orderId: o.orderId, kind: "unpaid", fixable: true, invoiceStatus: "AUTHORISED", amountDueMinor: 3100 });
    await fix(r.body.reportId); await drain();
    expect(xero.invoiceCreates).toBe(1);
    expect(inv(o.orderId).Status).toBe("PAID");
    expect((await recon()).body.diffs).toEqual([]);
  });

  it("reports a voided invoice and an invoice whose amount was edited in Xero, but never auto-fixes them", async () => {
    await connect();
    const a = await order("v"); const b = await order("m"); await drain();
    inv(a.orderId).Status = "VOIDED";
    inv(b.orderId).Total = 28.5; inv(b.orderId).AmountDue = 0;
    const r = await recon();
    const kinds = Object.fromEntries(r.body.diffs.map((d: { orderId: string; kind: string }) => [d.orderId, d.kind]));
    expect(kinds).toEqual({ [a.orderId]: "voided", [b.orderId]: "amount_mismatch" });
    expect(r.body.diffs.every((d: { fixable: boolean }) => d.fixable === false)).toBe(true);
    const mism = r.body.diffs.find((d: { kind: string }) => d.kind === "amount_mismatch");
    expect(mism).toMatchObject({ orderTotalMinor: 3100, invoiceTotalMinor: 2850 });
    const f = await fix(r.body.reportId);
    expect(f.body).toMatchObject({ queued: 0, skippedNeedsPerson: 2 });
  });

  it("does not expect an invoice for an order that could not be fulfilled", async () => {
    await connect();
    await order("big", { lines: [{ sku: "HM-BP-0196", qty: 99999, unitMinor: 1 }] });
    expect((await recon()).body.summary.checked).toBe(0);
  });

  it("marks a diff whose invoice job is still queued as possibly transient", async () => {
    await connect();
    const o = await order("q"); // job na fila, ainda não processado
    const r = await recon();
    expect(r.body.diffs[0]).toMatchObject({ orderId: o.orderId, kind: "missing_invoice", pendingJob: true });
  });

  it("fix can target specific orders", async () => {
    const x = await order("x"); const y = await order("y");
    await connect();
    const r = await recon();
    expect(r.body.summary.missingInvoice).toBe(2);
    const f = await fix(r.body.reportId, { orderIds: [y.orderId, "nope"] });
    expect(f.body).toMatchObject({ queued: 1, orders: [y.orderId] });
    await drain();
    expect(inv(y.orderId)).toBeDefined();
    expect(xero.invoices.has(`WEFT-${x.orderId}`)).toBe(false);
  });

  it("records a failed run when Xero is unreachable, and writes no report", async () => {
    await connect(); await order("z");
    xero.listWeftInvoices = async function* () { throw new Error("Xero down"); };
    expect((await recon()).status).toBe(500);
    const rows = await ctx.db.select().from(run).where(eq(run.kind, "reconcile.xero"));
    expect(rows[0].status).toBe("failed");
  });

  it("stock reports still work, and finance can read but not run Xero reconciliation", async () => {
    await connect(); await order("s"); await drain();
    const fin = await asRole(ctx, "finance");
    const r = await recon();
    expect((await http().get(`/reconciliation/${r.body.reportId}`).set(fin)).status).toBe(200);
    expect((await http().post("/reconciliation/run").set(fin).send({ kind: "xero" })).status).toBe(403);
    expect((await http().post("/reconciliation/run").set(ops).send({ kind: "bogus" })).status).toBe(400);
  });
});
