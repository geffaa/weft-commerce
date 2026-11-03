import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { boot, reset } from "./helpers";
import { exceptionItem, outbox } from "../src/db/schema";
import { ChannelError } from "../src/outbox/errors";
import { backoffMs } from "../src/outbox/outbox.worker";
import { stockPushHandler } from "../src/channels/stock-push.handler";

let ctx: Awaited<ReturnType<typeof boot>>;
beforeAll(async () => { ctx = await boot(); });
afterAll(async () => { await ctx.app.close(); });
beforeEach(async () => {
  await reset(ctx.db);
  ctx.worker.opts = { maxAttempts: 5, baseMs: 2_000, capMs: 300_000, leaseMs: 60_000, random: () => 1 };
  for (const k of Object.keys(ctx.handlers)) if (k !== "stock.push") delete ctx.handlers[k];
});

const T0 = new Date("2026-11-03T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const job = (key: string, topic = "test.topic", payload: object = {}) =>
  ctx.db.insert(outbox).values({ topic, payload, idempotencyKey: key, nextAttemptAt: T0 }).returning().then((r) => r[0]);
const row = (id: string) => ctx.db.select().from(outbox).where(eq(outbox.id, id)).then((r) => r[0]);

describe("backoff", () => {
  it("grows exponentially, is capped, and uses full jitter", () => {
    const o = { baseMs: 2000, capMs: 10_000, random: () => 1 };
    expect([1, 2, 3, 4, 5].map((a) => backoffMs(a, o))).toEqual([2000, 4000, 8000, 10000, 10000]);
    expect(backoffMs(3, { ...o, random: () => 0 })).toBe(0);
    expect(backoffMs(3, { ...o, random: () => 0.5 })).toBe(4000);
  });
});

describe("outbox worker", () => {
  it("delivers a due job once and marks it done", async () => {
    const calls: string[] = [];
    ctx.handlers["test.topic"] = async (j) => { calls.push(j.idempotencyKey); };
    const j = await job("k1");
    expect(await ctx.worker.tick(T0)).toEqual({ done: 1, retried: 0, dead: 0 });
    expect(await ctx.worker.tick(T0)).toEqual({ done: 0, retried: 0, dead: 0 });
    expect(calls).toEqual(["k1"]);
    expect((await row(j.id)).status).toBe("done");
  });

  it("does not run a job before next_attempt_at", async () => {
    ctx.handlers["test.topic"] = async () => {};
    await ctx.db.insert(outbox).values({ topic: "test.topic", payload: {}, idempotencyKey: "later", nextAttemptAt: at(60_000) });
    expect((await ctx.worker.tick(T0)).done).toBe(0);
    expect((await ctx.worker.tick(at(61_000))).done).toBe(1);
  });

  it("retries a transient failure with growing delay, then succeeds", async () => {
    let n = 0;
    ctx.handlers["test.topic"] = async () => { if (++n < 3) throw new Error("socket hang up"); };
    const j = await job("k2");
    expect((await ctx.worker.tick(T0)).retried).toBe(1);
    let r = await row(j.id);
    expect(r.status).toBe("pending");
    expect(r.attempts).toBe(1);
    expect(r.nextAttemptAt.getTime()).toBe(at(2000).getTime());
    expect(r.lastError).toBe("socket hang up");

    expect((await ctx.worker.tick(at(1000))).retried).toBe(0); // belum waktunya
    expect((await ctx.worker.tick(at(2000))).retried).toBe(1);
    r = await row(j.id);
    expect(r.nextAttemptAt.getTime()).toBe(at(2000 + 4000).getTime());
    expect((await ctx.worker.tick(at(6000))).done).toBe(1);
    expect((await row(j.id)).status).toBe("done");
    expect(n).toBe(3);
  });

  it("dead-letters after maxAttempts and opens an exception with the error class", async () => {
    ctx.worker.opts.maxAttempts = 3;
    ctx.handlers["test.topic"] = async () => { throw new ChannelError("Shopify 503", "transient"); };
    const j = await job("k3");
    let t = 0;
    const results = [];
    for (let i = 0; i < 4; i++) { results.push(await ctx.worker.tick(at(t))); t += 60_000; }
    expect(results.map((r) => [r.retried, r.dead])).toEqual([[1, 0], [1, 0], [0, 1], [0, 0]]);
    expect((await row(j.id)).status).toBe("dead");
    const ex = await ctx.db.select().from(exceptionItem);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ errorClass: "transient", message: "Shopify 503", state: "open" });
  });

  it("does not retry permanent errors (auth, validation)", async () => {
    ctx.handlers["test.topic"] = async () => { throw new ChannelError("Invalid access token", "auth"); };
    const j = await job("k4");
    expect(await ctx.worker.tick(T0)).toEqual({ done: 0, retried: 0, dead: 1 });
    const r = await row(j.id);
    expect([r.status, r.attempts]).toEqual(["dead", 1]);
    expect((await ctx.db.select().from(exceptionItem))[0].errorClass).toBe("auth");
  });

  it("an unknown topic is a permanent validation error, not an endless loop", async () => {
    await job("k5", "nobody.handles.this");
    expect((await ctx.worker.tick(T0)).dead).toBe(1);
  });

  it("honours Retry-After on rate limits, even beyond the backoff", async () => {
    ctx.handlers["test.topic"] = async () => { throw new ChannelError("Throttled", "rate_limit", 30_000); };
    const j = await job("k6");
    await ctx.worker.tick(T0);
    expect((await row(j.id)).nextAttemptAt.getTime()).toBe(at(30_000).getTime());
  });

  it("four workers racing on 20 jobs deliver each job exactly once", async () => {
    const seen = new Map<string, number>();
    ctx.handlers["test.topic"] = async (j) => { await new Promise((r) => setTimeout(r, 5)); seen.set(j.idempotencyKey, (seen.get(j.idempotencyKey) ?? 0) + 1); };
    for (let i = 0; i < 20; i++) await job(`race-${i}`);
    const rs = await Promise.all([1, 2, 3, 4].map(() => ctx.worker.tick(T0, 20)));
    expect(rs.reduce((n, r) => n + r.done, 0)).toBe(20);
    expect(seen.size).toBe(20);
    expect([...seen.values()].every((v) => v === 1)).toBe(true);
  });

  it("reclaims a job whose worker died (expired lease)", async () => {
    ctx.handlers["test.topic"] = async () => {};
    const j = await job("k7");
    await ctx.worker.claim(T0, 1); // worker "mati" setelah klaim
    expect((await ctx.worker.tick(at(30_000))).done).toBe(0); // lease masih berlaku
    expect((await ctx.worker.tick(at(61_000))).done).toBe(1);
    expect((await row(j.id)).attempts).toBe(2);
  });
});

describe("stock push", () => {
  it("sends the CURRENT absolute stock, not the stale value in the payload", async () => {
    const sent: [string, number][] = [];
    ctx.handlers["stock.push"] = stockPushHandler(ctx.inventory, { setQuantity: async (s, q) => { sent.push([s, q]); } });
    await ctx.inventory.adjust("A", 10, "seed", "seed:a");
    await ctx.db.update(outbox).set({ payload: { sku: "A", quantity: 999 }, nextAttemptAt: T0 });
    await ctx.worker.tick(T0);
    expect(sent).toEqual([["A", 10]]);
  });

  it("a stock change during an in-flight push queues a fresh job; nothing is lost or duplicated", async () => {
    const sent: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    ctx.handlers["stock.push"] = async (j) => {
      const q = await ctx.inventory.stock((j.payload as { sku: string }).sku);
      sent.push(q);
      if (sent.length === 1) await gate; // kanal lambat
    };
    await ctx.inventory.adjust("A", 10, "seed", "seed:a");
    await ctx.db.update(outbox).set({ nextAttemptAt: T0 });
    const first = ctx.worker.tick(T0);
    await new Promise((r) => setTimeout(r, 50));
    await ctx.inventory.adjust("A", -3, "sale", "sale:1"); // tidak boleh menunggu push yang sedang jalan
    release();
    await first;
    await ctx.db.update(outbox).set({ nextAttemptAt: T0 }).where(sql`status = 'pending'`);
    await ctx.worker.tick(T0);
    expect(sent).toEqual([10, 7]);
    const rows = await ctx.db.select().from(outbox);
    expect(rows.map((r) => r.status).sort()).toEqual(["done", "done"]);
  });

  it("a failed push superseded by a newer pending job is dropped instead of piling up", async () => {
    let n = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    ctx.handlers["stock.push"] = async () => { if (++n === 1) { await gate; throw new Error("boom"); } };
    await ctx.inventory.adjust("A", 10, "seed", "seed:a");
    await ctx.db.update(outbox).set({ nextAttemptAt: T0 });
    const first = ctx.worker.tick(T0);
    await new Promise((r) => setTimeout(r, 50));
    await ctx.inventory.adjust("A", -1, "sale", "sale:1");
    release();
    expect((await first).retried).toBe(1);
    const rows = await ctx.db.select().from(outbox);
    expect(rows.map((r) => r.status).sort()).toEqual(["pending", "superseded"]);
  });
});
