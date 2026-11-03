import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { asRole, boot, reset } from "./helpers";
import { connection, exceptionItem, outbox, skuMap } from "../src/db/schema";
import { classify } from "../src/shopify/import.service";
import { ShopifyClient, type ShopifyVariant } from "../src/shopify/shopify.client";
import { ConnectionService } from "../src/shopify/connection.service";
import { decrypt } from "../src/common/crypto";
import { ChannelError } from "../src/outbox/errors";
import { env } from "./helpers";

const V = (o: Partial<ShopifyVariant> & { variantId: string }): ShopifyVariant => ({
  sku: null, productTitle: "P", variantTitle: "Default", inventoryItemId: "inv-" + o.variantId, tracked: true, available: 0, ...o,
});
let AUTH: { authorization: string };

let ctx: Awaited<ReturnType<typeof boot>>;
let conns: ConnectionService;
let calls: { sku?: string; item: string; loc: string; qty: number; key: string }[];
let fakeVariants: ShopifyVariant[];
let granted: string[];

beforeAll(async () => { ctx = await boot(); conns = ctx.app.get(ConnectionService); });
afterAll(async () => { await ctx.app.close(); });
beforeEach(async () => {
  await reset(ctx.db);
  AUTH = await asRole(ctx, "ops");
  calls = []; granted = ["read_products", "read_inventory", "write_inventory", "read_orders", "read_locations"];
  fakeVariants = [];
  conns.factory = (c) => ({
    testConnection: async (required: string[]) => {
      if (c.clientSecret === "bad") throw new ChannelError("Shopify rejected the credentials: invalid_client", "auth");
      return { shopName: "weft-dev", currency: "USD", granted, missing: required.filter((s) => !granted.includes(s)) };
    },
    locations: async () => [{ id: "loc-1", name: "Shop location", isActive: true }],
    variants: async function* () { for (const v of fakeVariants) yield v; },
    setQuantity: async (item: string, loc: string, qty: number, key: string) => { calls.push({ item, loc, qty, key }); },
    ensureWebhook: async () => "created",
  } as ReturnType<typeof conns.factory>);
});

const create = (extra: object = {}) =>
  request(ctx.app.getHttpServer()).post("/connections").set(AUTH)
    .send({ shop: "weft-dev.myshopify.com", clientId: "cid", clientSecret: "shpss_secret1234", ...extra });

describe("classify", () => {
  it("flags missing SKUs and case-insensitive duplicates, maps the rest", () => {
    const r = classify([
      V({ variantId: "1", sku: "HM-BP-0196" }), V({ variantId: "2" }),
      V({ variantId: "3", sku: "dup-1" }), V({ variantId: "4", sku: " DUP-1 " }), V({ variantId: "5", sku: "HM-OF-0112" }),
    ]);
    expect(r.map((v) => v.state)).toEqual(["mapped", "missing", "conflict", "conflict", "mapped"]);
    expect(r[2].conflictReason).toContain("used by 2 variants");
  });
});

describe("connections API", () => {
  it("needs a valid login token", async () => {
    expect((await request(ctx.app.getHttpServer()).get("/connections")).status).toBe(401);
    expect((await request(ctx.app.getHttpServer()).get("/connections").set("authorization", "Bearer nope")).status).toBe(401);
  });

  it("wrong credentials: 422 with the reason, and nothing is saved", async () => {
    const r = await create({ clientSecret: "bad" });
    expect(r.status).toBe(422);
    expect(r.body.message).toContain("rejected the credentials");
    expect(await ctx.db.select().from(connection)).toHaveLength(0);
  });

  it("missing scope: 422 names the scope, and nothing is saved", async () => {
    granted = ["read_products", "read_locations"];
    const r = await create();
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/Missing scopes: .*write_inventory/);
    expect(await ctx.db.select().from(connection)).toHaveLength(0);
  });

  it("saves a working connection with the secret encrypted and never returned", async () => {
    const r = await create();
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain("shpss_secret1234");
    expect(r.body.secretHint).toBe("…1234");
    expect(r.body.secretEnc).toBeUndefined();
    const [row] = await ctx.db.select().from(connection);
    expect(row.secretEnc).not.toContain("shpss_secret1234");
    expect(decrypt(row.secretEnc, env.HUB_ENCRYPTION_KEY)).toBe("shpss_secret1234");
    const list = await request(ctx.app.getHttpServer()).get("/connections").set(AUTH);
    expect(JSON.stringify(list.body)).not.toContain("secretEnc");
  });

  it("rejects a malformed shop domain", async () => {
    expect((await create({ shop: "evil.example.com" })).status).toBe(422);
  });
});

describe("import", () => {
  it("maps SKUs, records conflicts, imports opening stock once", async () => {
    fakeVariants = [
      V({ variantId: "1", sku: "HM-BP-0196", available: 20 }),
      V({ variantId: "2", sku: null, available: 5 }),
      V({ variantId: "3", sku: "DUP", available: 3 }), V({ variantId: "4", sku: "dup", available: 4 }),
      V({ variantId: "5", sku: "HM-OF-0112", tracked: false, available: null }),
    ];
    const { body: c } = await create();
    const r1 = await request(ctx.app.getHttpServer()).post(`/connections/${c.id}/import`).set(AUTH);
    expect(r1.body).toMatchObject({ variants: 5, mapped: 2, missing: 1, conflict: 2, stockImported: 1 });
    expect(await ctx.inventory.stock("HM-BP-0196")).toBe(20);
    expect(await ctx.inventory.stock("DUP")).toBe(0); // conflict: tidak diimpor

    await ctx.inventory.adjust("HM-BP-0196", -2, "sale", "sale:1");
    const r2 = await request(ctx.app.getHttpServer()).post(`/connections/${c.id}/import`).set(AUTH);
    expect(r2.body.stockImported).toBe(0);
    expect(await ctx.inventory.stock("HM-BP-0196")).toBe(18); // impor ulang tidak menimpa stok Weft
    expect(await ctx.db.select().from(skuMap)).toHaveLength(5);

    const conflicts = await request(ctx.app.getHttpServer()).get("/sku-map?state=conflict").set(AUTH);
    expect(conflicts.body).toHaveLength(2);
  });
});

describe("channel push", () => {
  it("pushes the absolute current stock to the mapped variant", async () => {
    fakeVariants = [V({ variantId: "1", sku: "HM-BP-0196", available: 20 })];
    const { body: c } = await create();
    await request(ctx.app.getHttpServer()).post(`/connections/${c.id}/import`).set(AUTH);
    await ctx.db.delete(outbox);
    await ctx.ledger.ingestOrder({ source: "storefront", sourceRef: "o1", currency: "GBP", totalMinor: 1, lines: [{ sku: "HM-BP-0196", qty: 3, unitMinor: 1 }] });
    await ctx.db.update(outbox).set({ nextAttemptAt: new Date(0) });
    expect((await ctx.worker.tick()).done).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ item: "inv-1", loc: "loc-1", qty: 17 });
    expect(calls[0].key).toMatch(/^[0-9a-f-]{36}:17$/);
  });

  it("a changed quantity gets a new idempotency key; a retry of the same quantity reuses it", async () => {
    fakeVariants = [V({ variantId: "1", sku: "A", available: 20 })];
    const { body: c } = await create();
    await request(ctx.app.getHttpServer()).post(`/connections/${c.id}/import`).set(AUTH);
    const push = async () => { await ctx.db.update(outbox).set({ nextAttemptAt: new Date(0) }).where(sql`status = 'pending'`); await ctx.worker.tick(); };
    await push();
    await ctx.inventory.adjust("A", -1, "sale", "sale:1"); await push();
    await ctx.inventory.adjust("A", +1, "restock", "restock:1"); await push();
    const keys = calls.map((x) => x.key);
    expect(calls.map((x) => x.qty)).toEqual([20, 19, 20]);
    expect(new Set(keys).size).toBe(3); // 20 de novo tidak memakai ulang kunci "20" yang lama
  });

  it("an unmapped SKU is a permanent error that surfaces in Exceptions", async () => {
    const { body: c } = await create();
    void c;
    await ctx.inventory.adjust("HM-NEW-0001", 5, "seed", "seed:n");
    await ctx.db.update(outbox).set({ nextAttemptAt: new Date(0) });
    expect((await ctx.worker.tick()).dead).toBe(1);
    const [ex] = await ctx.db.select().from(exceptionItem);
    expect(ex).toMatchObject({ errorClass: "validation", message: "SKU HM-NEW-0001 is not mapped to a Shopify variant" });
    expect(calls).toHaveLength(0);
  });
});

describe("ShopifyClient", () => {
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
  const make = (handler: (url: string, init: RequestInit) => Response | Promise<Response>, now = () => 0) => {
    const seen: { url: string; body: string }[] = [];
    const client = new ShopifyClient({ shop: "s.myshopify.com", clientId: "id", clientSecret: "sec" }, {
      now, fetch: (async (url: string, init: RequestInit) => { seen.push({ url, body: String(init.body) }); return handler(url, init); }) as typeof fetch,
    });
    return { client, seen };
  };
  const token = (n: number, exp = 86400) => json({ access_token: `tok${n}`, expires_in: exp });

  it("caches the token, refreshes it before it expires", async () => {
    let t = 0, n = 0;
    const { client, seen } = make((url) => url.endsWith("/oauth/access_token") ? token(++n, 100) : json({ data: { ok: 1 } }), () => t);
    await client.graphql("{ a }"); await client.graphql("{ b }");
    expect(seen.filter((s) => s.url.includes("oauth")).length).toBe(1);
    t = 50_000; // 100s - 60s margin = habis di 40s
    await client.graphql("{ c }");
    expect(seen.filter((s) => s.url.includes("oauth")).length).toBe(2);
  });

  it("retries once on 401 with a fresh token, then gives up as an auth error", async () => {
    let n = 0;
    const { client } = make((url) => url.includes("oauth") ? token(++n) : json({}, 401));
    await expect(client.graphql("{ a }")).rejects.toMatchObject({ errorClass: "auth" });
    expect(n).toBe(2);
  });

  it("classifies 429, THROTTLED, 5xx, GraphQL errors and userErrors", async () => {
    const run = (resp: Response) => make((url) => url.includes("oauth") ? token(1) : resp).client.graphql("{ a }");
    await expect(run(json({}, 429, { "retry-after": "7" }))).rejects.toMatchObject({ errorClass: "rate_limit", retryAfterMs: 7000 });
    await expect(run(json({ errors: [{ message: "x", extensions: { code: "THROTTLED" } }] }))).rejects.toMatchObject({ errorClass: "rate_limit" });
    await expect(run(json({}, 503))).rejects.toMatchObject({ errorClass: "transient" });
    await expect(run(json({ errors: [{ message: "Field 'zzz' doesn't exist" }] }))).rejects.toMatchObject({ errorClass: "validation" });
    const { client } = make((url) => url.includes("oauth") ? token(1) : json({ data: { inventorySetQuantities: { userErrors: [{ message: "bad qty" }] } } }));
    await expect(client.setQuantity("i", "l", -1, "k")).rejects.toMatchObject({ errorClass: "validation", message: "bad qty" });
  });

  it("a bad client secret is an auth error", async () => {
    const { client } = make(() => json({ error: "invalid_client", error_description: "Invalid client credentials" }, 400));
    await expect(client.accessToken()).rejects.toMatchObject({ errorClass: "auth", message: expect.stringContaining("Invalid client credentials") });
  });

  it("setQuantity sends an absolute set with changeFromQuantity null and an idempotency key", async () => {
    const { client, seen } = make((url) => url.includes("oauth") ? token(1) : json({ data: { inventorySetQuantities: { userErrors: [] } } }));
    await client.setQuantity("gid://item/1", "gid://loc/1", 17, "stock.push:A");
    const body = JSON.parse(seen.at(-1)!.body);
    expect(body.variables.key).toBe("stock.push:A");
    expect(body.variables.input.quantities).toEqual([{ inventoryItemId: "gid://item/1", locationId: "gid://loc/1", quantity: 17, changeFromQuantity: null }]);
    expect(body.variables.input.name).toBe("available");
    expect(body.query).toContain("@idempotent");
    expect(seen.at(-1)!.url).toContain("/admin/api/2026-10/");
  });

  it("testConnection treats write_X as covering read_X", async () => {
    const { client } = make((url) => url.includes("oauth") ? token(1) : json({ data: { shop: { name: "n", currencyCode: "USD" }, currentAppInstallation: { accessScopes: [{ handle: "write_inventory" }, { handle: "read_products" }] } } }));
    expect((await client.testConnection(["read_inventory", "write_inventory", "read_orders"])).missing).toEqual(["read_orders"]);
  });

  it("pages through variants with the cursor", async () => {
    const page = (ids: string[], next: string | null) => json({ data: { productVariants: { pageInfo: { hasNextPage: !!next, endCursor: next }, nodes: ids.map((id) => ({
      id, sku: id === "b" ? "  " : id.toUpperCase(), title: "t", product: { title: "p" }, inventoryItem: { id: "i" + id, tracked: true, inventoryLevel: { quantities: [{ name: "available", quantity: 4 }] } } })) } } });
    const afters: unknown[] = [];
    const { client } = make((url, init) => {
      if (url.includes("oauth")) return token(1);
      const after = JSON.parse(String(init.body)).variables.after; afters.push(after);
      return after === null ? page(["a", "b"], "c1") : page(["c"], null);
    });
    const out: ShopifyVariant[] = []; for await (const v of client.variants("loc")) out.push(v);
    expect(out.map((v) => v.sku)).toEqual(["A", null, "C"]);
    expect(afters).toEqual([null, "c1"]);
  });
});
