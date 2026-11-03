import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { asRole, boot, reset } from "./helpers";
import { outbox, reconciliationReport, run } from "../src/db/schema";
import { ConnectionService } from "../src/shopify/connection.service";
import { ReconciliationService, msUntilNext } from "../src/reconciliation/reconciliation.service";
import type { ShopifyVariant } from "../src/shopify/shopify.client";

const V = (id: string, sku: string | null, available: number | null, tracked = true): ShopifyVariant =>
  ({ variantId: id, sku, productTitle: "Prod " + id, variantTitle: "Default", inventoryItemId: "inv-" + id, tracked, available });

let ctx: Awaited<ReturnType<typeof boot>>;
let shop: ShopifyVariant[];
let failWith: Error | null;
let ops: { authorization: string };
const http = () => request(ctx.app.getHttpServer());

beforeAll(async () => { ctx = await boot(); });
afterAll(async () => { await ctx.app.close(); });
beforeEach(async () => {
  await reset(ctx.db);
  failWith = null;
  shop = [V("1", "HM-BP-0196", 38), V("2", "HM-OF-0112", 112), V("3", "HM-SP-0541", 9), V("4", null, 5), V("5", "HM-GK-0450", null, false)];
  ctx.app.get(ConnectionService).factory = () => ({
    testConnection: async () => ({ shopName: "s", currency: "USD", granted: ["read_products"], missing: [] }),
    locations: async () => [{ id: "loc-1", name: "Shop location", isActive: true }],
    variants: async function* () { if (failWith) throw failWith; for (const v of [...shop]) yield { ...v }; },
    setQuantity: async (item: string, _l: string, qty: number) => { const v = shop.find((x) => x.inventoryItemId === item)!; v.available = qty; },
    ensureWebhook: async () => "created",
  } as never);
  ops = await asRole(ctx, "ops");
  const { body: c } = await http().post("/connections").set(ops).send({ shop: "x.myshopify.com", clientId: "c", clientSecret: "shpss_secret1234" });
  await http().post(`/connections/${c.id}/import`).set(ops); // stok awal Weft = stok Shopify
  await ctx.db.delete(outbox);
});

const recon = () => http().post("/reconciliation/run").set(ops);

describe("stock reconciliation", () => {
  it("finds nothing when both sides agree, and skips unmapped and untracked variants", async () => {
    const r = await recon();
    expect(r.body.summary).toEqual({ checked: 3, mismatches: 0, missingInChannel: 0 });
    expect(r.body.diffs).toEqual([]);
  });

  it("reports a manual Shopify edit with both values and the difference", async () => {
    shop[0].available = 41; // alguém edita à mão no admin Shopify: Weft 38, Shopify 41
    const r = await recon();
    expect(r.body.summary.mismatches).toBe(1);
    expect(r.body.diffs[0]).toMatchObject({ sku: "HM-BP-0196", weft: 38, channel: 41, difference: 3, kind: "mismatch", pendingPush: false });
    const [row] = await ctx.db.select().from(run).where(eq(run.kind, "reconcile.stock"));
    expect(row.status).toBe("done");
    expect(row.stats).toEqual(r.body.summary);
  });

  it("closes the loop: fix queues a push, the worker writes Weft's value, the next run is clean", async () => {
    shop[0].available = 41; shop[2].available = 4;
    const rep = await recon();
    const fix = await http().post(`/reconciliation/${rep.body.reportId}/fix`).set(ops).send({});
    expect(fix.body).toMatchObject({ queued: 2 });
    const [fixRun] = await ctx.db.select().from(run).where(eq(run.kind, "reconcile.fix"));
    expect(fixRun.parentId).toBe(rep.body.runId);
    expect(fixRun.trigger).toBe("ops@example.com");

    await ctx.db.update(outbox).set({ nextAttemptAt: new Date(0) });
    expect((await ctx.worker.tick()).done).toBe(2);
    expect(shop[0].available).toBe(38);
    expect(shop[2].available).toBe(9);
    expect((await recon()).body.summary.mismatches).toBe(0);
  });

  it("fix can target specific SKUs and ignores ones that are not in the report", async () => {
    shop[0].available = 41; shop[1].available = 100;
    const rep = await recon();
    const fix = await http().post(`/reconciliation/${rep.body.reportId}/fix`).set(ops).send({ skus: ["HM-OF-0112", "NOPE"] });
    expect(fix.body).toMatchObject({ queued: 1, skus: ["HM-OF-0112"] });
  });

  it("flags a diff whose stock push is still in flight as possibly transient", async () => {
    await ctx.inventory.adjust("HM-BP-0196", -1, "sale", "sale:1"); // Weft 37, push pending; Shopify masih 38
    const r = await recon();
    expect(r.body.diffs[0]).toMatchObject({ sku: "HM-BP-0196", weft: 37, channel: 38, pendingPush: true });
  });

  it("flags a mapped variant that no longer exists in Shopify", async () => {
    shop.splice(1, 1);
    const r = await recon();
    expect(r.body.diffs).toHaveLength(1);
    expect(r.body.diffs[0]).toMatchObject({ sku: "HM-OF-0112", kind: "missing_in_channel", channel: null });
    // varian yang hilang tidak ikut "fix" (tak ada tujuan untuk didorong)
    const fix = await http().post(`/reconciliation/${r.body.reportId}/fix`).set(ops).send({});
    expect(fix.body.queued).toBe(0);
  });

  it("a failing channel marks the run failed and writes no report", async () => {
    failWith = new Error("Shopify down");
    expect((await recon()).status).toBe(500);
    const [row] = await ctx.db.select().from(run).where(eq(run.kind, "reconcile.stock"));
    expect(row.status).toBe("failed");
    expect(row.stats).toEqual({ error: "Shopify down" });
    expect(await ctx.db.select().from(reconciliationReport)).toHaveLength(0);
  });

  it("is limited by role: finance reads, only ops runs and fixes", async () => {
    const fin = await asRole(ctx, "finance"); const sup = await asRole(ctx, "support");
    const rep = await recon();
    expect((await http().get("/reconciliation").set(fin)).status).toBe(200);
    expect((await http().get(`/reconciliation/${rep.body.reportId}`).set(fin)).status).toBe(200);
    expect((await http().post("/reconciliation/run").set(fin)).status).toBe(403);
    expect((await http().post(`/reconciliation/${rep.body.reportId}/fix`).set(fin).send({})).status).toBe(403);
    expect((await http().get("/reconciliation").set(sup)).status).toBe(403);
    expect((await http().get("/reconciliation/00000000-0000-0000-0000-000000000000").set(ops)).status).toBe(404);
  });
});

describe("nightly schedule", () => {
  it("computes the next run in the future, today or tomorrow", () => {
    const now = new Date("2026-11-03T10:00:00Z");
    expect(msUntilNext(18, now)).toBe(8 * 3600_000);
    expect(msUntilNext(2, now)).toBe(16 * 3600_000);
    expect(msUntilNext(10, now)).toBe(24 * 3600_000); // tepat sekarang = besok, bukan loop cepat
    expect(ctx.app.get(ReconciliationService)).toBeDefined();
  });
});
