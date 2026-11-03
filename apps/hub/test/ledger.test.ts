import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { boot, medusaSig, reset, shopifyOrder, shopifySig } from "./helpers";
import { exceptionItem, ledgerOrder, outbox, webhookReceipt } from "../src/db/schema";

let ctx: Awaited<ReturnType<typeof boot>>;
beforeAll(async () => { ctx = await boot(); });
afterAll(async () => { await ctx.app.close(); });
beforeEach(async () => { await reset(ctx.db); });

const postShopify = (body: object, id: string, sig?: string, topic = "orders/paid") => {
  const raw = JSON.stringify(body);
  return request(ctx.app.getHttpServer()).post("/webhooks/shopify")
    .set("content-type", "application/json").set("x-shopify-webhook-id", id).set("x-shopify-topic", topic)
    .set("x-shopify-hmac-sha256", sig ?? shopifySig(raw)).send(raw);
};

describe("webhook idempotency", () => {
  it("same Shopify order delivered 3 times lowers stock once", async () => {
    await ctx.inventory.adjust("HM-BP-0196", 10, "seed", "seed:1");
    const body = shopifyOrder(1001, "HM-BP-0196", 2);
    const res = [];
    for (let i = 0; i < 3; i++) res.push((await postShopify(body, "wh-1")).body.status);
    expect(res).toEqual(["accepted", "duplicate", "duplicate"]);
    expect(await ctx.inventory.stock("HM-BP-0196")).toBe(8);
  });

  it("a redelivery with a NEW webhook id is still deduplicated by the order itself", async () => {
    await ctx.inventory.adjust("HM-BP-0196", 10, "seed", "seed:1");
    const body = shopifyOrder(1002, "HM-BP-0196", 1);
    expect((await postShopify(body, "wh-a")).body.status).toBe("accepted");
    expect((await postShopify(body, "wh-b")).body.status).toBe("duplicate");
    expect(await ctx.inventory.stock("HM-BP-0196")).toBe(9);
  });

  it("rejects a bad signature and changes nothing", async () => {
    await ctx.inventory.adjust("HM-BP-0196", 10, "seed", "seed:1");
    const r = await postShopify(shopifyOrder(1003, "HM-BP-0196", 1), "wh-x", "not-a-valid-signature");
    expect(r.status).toBe(401);
    expect(await ctx.inventory.stock("HM-BP-0196")).toBe(10);
    expect(await ctx.db.select().from(webhookReceipt)).toHaveLength(0);
  });

  it("drops the receipt when processing fails so the retry is processed", async () => {
    await ctx.inventory.adjust("HM-BP-0196", 10, "seed", "seed:1");
    const spy = vi.spyOn(ctx.ledger, "ingestOrder").mockRejectedValueOnce(new Error("db down"));
    const body = shopifyOrder(1004, "HM-BP-0196", 1);
    expect((await postShopify(body, "wh-r")).status).toBe(500);
    expect(await ctx.db.select().from(webhookReceipt)).toHaveLength(0);
    spy.mockRestore();
    expect((await postShopify(body, "wh-r")).body.status).toBe("accepted");
    expect(await ctx.inventory.stock("HM-BP-0196")).toBe(9);
  });

  it("ignores topics it does not handle", async () => {
    const r = await postShopify({ id: 1 }, "wh-t", undefined, "products/update");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ignored");
  });

  it("accepts a signed storefront (Medusa) order and converts major units to minor", async () => {
    await ctx.inventory.adjust("HM-BP-0196", 5, "seed", "seed:1");
    const raw = JSON.stringify({ event: "order.paid", order: { id: "order_1", currency_code: "gbp", total: 29.85, items: [{ sku: "HM-BP-0196", quantity: 1, unit_price: 24.9 }] } });
    const r = await request(ctx.app.getHttpServer()).post("/webhooks/medusa").set("content-type", "application/json")
      .set("x-weft-event-id", "ev-1").set("x-weft-signature", medusaSig(raw)).send(raw);
    expect(r.body.status).toBe("accepted");
    const [o] = await ctx.db.select().from(ledgerOrder).where(eq(ledgerOrder.sourceRef, "order_1"));
    expect(o.totalMinor).toBe(2985);
    expect(o.currency).toBe("GBP");
  });
});

describe("stock ledger", () => {
  it("50 concurrent orders for stock 10 -> exactly 10 succeed, stock never negative", async () => {
    await ctx.inventory.adjust("HM-OF-0112", 10, "seed", "seed:1");
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => ctx.ledger.ingestOrder({
        source: i % 2 ? "shopify" : "storefront", sourceRef: `c-${i}`, currency: "GBP", totalMinor: 790,
        lines: [{ sku: "HM-OF-0112", qty: 1, unitMinor: 790 }],
      })),
    );
    expect(results.filter((r) => r.outcome === "accepted")).toHaveLength(10);
    expect(results.filter((r) => r.outcome === "cannot_fulfil")).toHaveLength(40);
    expect(await ctx.inventory.stock("HM-OF-0112")).toBe(0);
    expect(await ctx.db.select().from(exceptionItem)).toHaveLength(40);
  });

  it("a multi-SKU order is all-or-nothing", async () => {
    await ctx.inventory.adjust("A", 5, "seed", "seed:a");
    await ctx.inventory.adjust("B", 1, "seed", "seed:b");
    const r = await ctx.ledger.ingestOrder({ source: "shopify", sourceRef: "m-1", currency: "GBP", totalMinor: 100,
      lines: [{ sku: "A", qty: 2, unitMinor: 50 }, { sku: "B", qty: 2, unitMinor: 50 }] });
    expect(r.outcome).toBe("cannot_fulfil");
    expect(await ctx.inventory.stock("A")).toBe(5);
    expect(await ctx.inventory.stock("B")).toBe(1);
    const [ex] = await ctx.db.select().from(exceptionItem);
    expect(ex.message).toBe("Insufficient stock: B 1 left, 2 requested");
  });

  it("opposite SKU order across concurrent orders does not deadlock", async () => {
    await ctx.inventory.adjust("A", 100, "seed", "seed:a");
    await ctx.inventory.adjust("B", 100, "seed", "seed:b");
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => ctx.ledger.ingestOrder({
      source: "shopify", sourceRef: `d-${i}`, currency: "GBP", totalMinor: 100,
      lines: i % 2 ? [{ sku: "A", qty: 1, unitMinor: 50 }, { sku: "B", qty: 1, unitMinor: 50 }] : [{ sku: "B", qty: 1, unitMinor: 50 }, { sku: "A", qty: 1, unitMinor: 50 }],
    })));
    expect(rs.every((r) => r.outcome === "accepted")).toBe(true);
    expect(await ctx.inventory.stock("A")).toBe(70);
  });

  it("a stock event id cannot be counted twice", async () => {
    expect(await ctx.inventory.adjust("A", 5, "receive", "po:1")).toBe(true);
    expect(await ctx.inventory.adjust("A", 5, "receive", "po:1")).toBe(false);
    expect(await ctx.inventory.stock("A")).toBe(5);
  });

  it("stock pushes to channels are coalesced per SKU and carry the absolute quantity", async () => {
    await ctx.inventory.adjust("A", 10, "seed", "seed:a");
    for (let i = 0; i < 4; i++) await ctx.ledger.ingestOrder({ source: "shopify", sourceRef: `p-${i}`, currency: "GBP", totalMinor: 1, lines: [{ sku: "A", qty: 1, unitMinor: 1 }] });
    const pending = await ctx.db.select().from(outbox).where(sql`status = 'pending' and topic = 'stock.push'`);
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ sku: "A", quantity: 6 });
  });
});
