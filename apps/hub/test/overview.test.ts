import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asRole, boot, reset } from "./helpers";
import { connection, exceptionItem, run } from "../src/db/schema";

let ctx: Awaited<ReturnType<typeof boot>>;
const http = () => request(ctx.app.getHttpServer());
beforeAll(async () => { ctx = await boot(); });
afterAll(async () => { await ctx.app.close(); });
beforeEach(async () => { await reset(ctx.db); });

describe("overview and orders", () => {
  it("summarises lanes, open exceptions and the 24h tape", async () => {
    const ops = await asRole(ctx, "ops");
    await ctx.db.insert(connection).values({ kind: "xero", shop: "Demo Company", clientId: "c", secretEnc: "x", secretHint: "…1", env: "sandbox", status: "ok" });
    await ctx.db.insert(run).values([{ kind: "import", trigger: "t", status: "done" }, { kind: "reconcile.stock", trigger: "t", status: "failed" }]);
    await ctx.db.insert(exceptionItem).values([
      { errorClass: "validation", message: "m", payload: { topic: "xero.invoice" } },
      { errorClass: "stock", message: "s", payload: {} },
    ]);
    const r = await http().get("/overview").set(ops);
    expect(r.status).toBe(200);
    expect(r.body.env).toBe("sandbox");
    expect(r.body.openExceptions).toBe(2);
    expect(r.body.lanes.find((l: { kind: string }) => l.kind === "xero")).toMatchObject({ connected: true, name: "Demo Company", openExceptions: 1 });
    expect(r.body.lanes.find((l: { kind: string }) => l.kind === "shopify")).toMatchObject({ connected: false });
    expect(r.body.tape).toHaveLength(48);
    expect(r.body.tape[47]).toBe("bad"); // run gagal + exception di bucket terakhir: yang terburuk menang
  });

  it("any signed-in role sees the overview, but orders are for ops and finance", async () => {
    const sup = await asRole(ctx, "support"); const fin = await asRole(ctx, "finance");
    expect((await http().get("/overview").set(sup)).status).toBe(200);
    expect((await http().get("/orders").set(sup)).status).toBe(403);
    expect((await http().get("/orders").set(fin)).status).toBe(200);
    expect((await http().get("/overview")).status).toBe(401);
  });

  it("lists orders newest first with line counts", async () => {
    const fin = await asRole(ctx, "finance");
    await ctx.inventory.adjust("A", 10, "seed", "seed:a");
    await ctx.ledger.ingestOrder({ source: "shopify", sourceRef: "o1", currency: "USD", totalMinor: 500, lines: [{ sku: "A", qty: 1, unitMinor: 300 }, { sku: "A", qty: 1, unitMinor: 200 }] });
    await ctx.ledger.ingestOrder({ source: "shopify", sourceRef: "o2", currency: "USD", totalMinor: 100, lines: [{ sku: "A", qty: 1, unitMinor: 100 }] });
    const r = await http().get("/orders?limit=10").set(fin);
    expect(r.body.map((o: { sourceRef: string }) => o.sourceRef)).toEqual(["o2", "o1"]);
    expect(r.body[1]).toMatchObject({ lines: 2, status: "accepted" });
  });
});
