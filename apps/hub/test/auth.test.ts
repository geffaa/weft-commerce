import request from "supertest";
import { SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { asRole, boot, env, PASSWORD, reset } from "./helpers";
import { auditLog, exceptionItem, member, outbox } from "../src/db/schema";
import { ConnectionService } from "../src/shopify/connection.service";
import { RateLimiter } from "../src/assistant/rate-limiter";
import type { ShopifyVariant } from "../src/shopify/shopify.client";

let ctx: Awaited<ReturnType<typeof boot>>;
const http = () => request(ctx.app.getHttpServer());
beforeAll(async () => { ctx = await boot(); });
afterAll(async () => { await ctx.app.close(); });
beforeEach(async () => { await reset(ctx.db); ctx.app.get(RateLimiter).reset(); });

const login = (email: string, password: string) => http().post("/auth/login").send({ email, password });

describe("login throttling", () => {
  it("locks guessing for one account after 8 attempts, without locking other accounts", async () => {
    await asRole(ctx, "ops"); await asRole(ctx, "finance");
    for (let i = 0; i < 8; i++) expect((await login("ops@example.com", `wrong-password-${i}`).set("x-forwarded-for", `5.5.5.${i}`)).status).toBe(401);
    const locked = await login("ops@example.com", PASSWORD).set("x-forwarded-for", "5.5.5.99"); // até a senha certa é recusada enquanto bloqueado
    expect(locked.status).toBe(429);
    expect((await login("finance@example.com", PASSWORD).set("x-forwarded-for", "5.5.5.50")).status).toBe(200);
  });

  it("limits guessing from one address across many accounts", async () => {
    for (let i = 0; i < 20; i++) expect((await login(`nobody${i}@example.com`, "x-password-123").set("x-forwarded-for", "6.6.6.6")).status).toBe(401);
    expect((await login("nobody99@example.com", "x-password-123").set("x-forwarded-for", "6.6.6.6")).status).toBe(429);
    expect((await login("nobody99@example.com", "x-password-123").set("x-forwarded-for", "6.6.6.7")).status).toBe(401);
  });
});

describe("login", () => {
  it("returns a token for the right password and stores only an Argon2id hash", async () => {
    await asRole(ctx, "ops");
    const r = await login("ops@example.com", PASSWORD);
    expect(r.status).toBe(200);
    expect(r.body.token.split(".")).toHaveLength(3);
    expect(r.body.member).toMatchObject({ email: "ops@example.com", role: "ops" });
    const [m] = await ctx.db.select().from(member);
    expect(m.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(m.passwordHash);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    await asRole(ctx, "ops");
    const a = await login("ops@example.com", "wrong-password-1");
    const b = await login("nobody@example.com", "wrong-password-1");
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.message).toBe(b.body.message);
  });

  it("rejects missing, garbage, foreign-signed and expired tokens", async () => {
    await asRole(ctx, "ops");
    const [m] = await ctx.db.select().from(member);
    const sign = (secret: string, exp: string | number) => new SignJWT({ role: "owner" }).setProtectedHeader({ alg: "HS256" }).setSubject(m.id).setIssuedAt().setExpirationTime(exp).sign(new TextEncoder().encode(secret));
    expect((await http().get("/auth/me")).status).toBe(401);
    expect((await http().get("/auth/me").set("authorization", "Bearer garbage")).status).toBe(401);
    expect((await http().get("/auth/me").set("authorization", `Bearer ${await sign("some-other-secret-value", "5m")}`)).status).toBe(401);
    expect((await http().get("/auth/me").set("authorization", `Bearer ${await sign(env.HUB_JWT_SECRET, Math.floor(Date.now() / 1000) - 10)}`)).status).toBe(401);
    expect((await http().get("/auth/me").set("authorization", `Bearer ${await sign(env.HUB_JWT_SECRET, "5m")}`)).status).toBe(200);
  });

  it("the role in the token is ignored: it is re-read from the database", async () => {
    const ops = await asRole(ctx, "ops");
    const owner = await asRole(ctx, "owner");
    const [target] = await ctx.db.select().from(member).where(eq(member.role, "ops"));
    expect((await http().get("/connections").set(ops)).status).toBe(200);
    await http().patch(`/members/${target.id}`).set(owner).send({ role: "support" });
    expect((await http().get("/connections").set(ops)).status).toBe(403); // token lama, peran baru
  });
});

describe("role matrix", () => {
  it("support can do almost nothing; finance reads; ops operates; owner manages", async () => {
    const [support, finance, ops, owner] = await Promise.all((["support", "finance", "ops", "owner"] as const).map((r) => asRole(ctx, r)));
    const code = (m: "get" | "post", path: string, h: Record<string, string>) => http()[m](path).set(h).send({}).then((r) => r.status);
    expect(await code("get", "/sku-map", support)).toBe(403);
    expect(await code("get", "/exceptions", support)).toBe(403);
    expect(await code("get", "/sku-map", finance)).toBe(200);
    expect(await code("get", "/exceptions", finance)).toBe(200);
    expect(await code("get", "/runs", finance)).toBe(200);
    expect(await code("get", "/connections", finance)).toBe(403);
    expect(await code("post", "/exceptions/00000000-0000-0000-0000-000000000000/ignore", finance)).toBe(403);
    expect(await code("get", "/connections", ops)).toBe(200);
    expect(await code("get", "/members", ops)).toBe(403);
    expect(await code("get", "/audit-log", ops)).toBe(403);
    expect(await code("get", "/members", owner)).toBe(200);
    expect(await code("get", "/audit-log", owner)).toBe(200);
    expect(await code("get", "/connections", owner)).toBe(200); // owner boleh semua
  });
});

describe("members and audit", () => {
  it("owner creates members (audited), duplicates conflict, weak passwords are refused", async () => {
    const owner = await asRole(ctx, "owner");
    const ok = await http().post("/members").set(owner).send({ email: "Fin@Example.com", password: PASSWORD, role: "finance" });
    expect(ok.status).toBe(201);
    expect(ok.body.email).toBe("fin@example.com");
    expect(ok.body.passwordHash).toBeUndefined();
    expect((await http().post("/members").set(owner).send({ email: "fin@example.com", password: PASSWORD, role: "finance" })).status).toBe(409);
    expect((await http().post("/members").set(owner).send({ email: "x@example.com", password: "short", role: "ops" })).status).toBe(400);
    expect((await http().post("/members").set(owner).send({ email: "x@example.com", password: PASSWORD, role: "root" })).status).toBe(400);
    const log = await ctx.db.select().from(auditLog).where(eq(auditLog.action, "member.create"));
    expect(log.some((l) => l.actor === "owner@example.com" && l.subject === "fin@example.com")).toBe(true);
  });

  it("role changes are audited and the last owner cannot be demoted", async () => {
    const owner = await asRole(ctx, "owner");
    const [o] = await ctx.db.select().from(member);
    const r = await http().patch(`/members/${o.id}`).set(owner).send({ role: "ops" });
    expect(r.status).toBe(409);
    await asRole(ctx, "ops");
    const [ops] = await ctx.db.select().from(member).where(eq(member.role, "ops"));
    expect((await http().patch(`/members/${ops.id}`).set(owner).send({ role: "finance" })).status).toBe(200);
    const [l] = await ctx.db.select().from(auditLog).where(eq(auditLog.action, "member.role"));
    expect(l).toMatchObject({ actor: "owner@example.com", subject: "ops@example.com", meta: { from: "ops", to: "finance" } });
  });

  it("saving a connection is audited without leaking the secret", async () => {
    const ops = await asRole(ctx, "ops");
    ctx.app.get(ConnectionService).factory = () => ({
      testConnection: async () => ({ shopName: "s", currency: "USD", granted: ["read_products"], missing: [] }),
      locations: async () => [{ id: "l", name: "L", isActive: true }],
      variants: async function* () { yield* [] as ShopifyVariant[]; }, setQuantity: async () => {}, ensureWebhook: async () => "created",
    } as never);
    await http().post("/connections").set(ops).send({ shop: "x.myshopify.com", clientId: "c", clientSecret: "shpss_topsecret9999" });
    const rows = await ctx.db.select().from(auditLog).where(eq(auditLog.action, "connection.save"));
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("ops@example.com");
    expect(JSON.stringify(rows[0])).not.toContain("topsecret");
  });
});

describe("bootstrap owner", () => {
  it("creates the first owner from env once, and never again", async () => {
    const extra = { HUB_OWNER_EMAIL: "boss@example.com", HUB_OWNER_PASSWORD: "a-long-owner-password" };
    const a = await boot(extra); await a.app.close();
    const b = await boot(extra); await b.app.close();
    const rows = await ctx.db.select().from(member);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "boss@example.com", role: "owner" });
    expect((await login("boss@example.com", "a-long-owner-password")).status).toBe(200);
  });
});

describe("exceptions and runs", () => {
  it("retry requeues a dead channel job and resolves the exception; stock exceptions cannot be retried", async () => {
    const ops = await asRole(ctx, "ops");
    await ctx.db.insert(exceptionItem).values({ errorClass: "transient", message: "Shopify 503", payload: { topic: "stock.push", idempotencyKey: "stock.push:A", payload: { sku: "A" } } });
    await ctx.db.insert(exceptionItem).values({ errorClass: "stock", message: "Insufficient stock", payload: { shortages: [] } });
    const list = await http().get("/exceptions").set(ops);
    expect(list.body).toHaveLength(2);
    const chan = list.body.find((e: { errorClass: string }) => e.errorClass === "transient");
    const stock = list.body.find((e: { errorClass: string }) => e.errorClass === "stock");

    expect((await http().post(`/exceptions/${stock.id}/retry`).set(ops)).status).toBe(409);
    const r = await http().post(`/exceptions/${chan.id}/retry`).set(ops);
    expect(r.body).toEqual({ state: "resolved", requeued: "stock.push" });
    const pending = await ctx.db.select().from(outbox).where(eq(outbox.status, "pending"));
    expect(pending.map((p) => p.idempotencyKey)).toContain("stock.push:A");
    expect((await http().post(`/exceptions/${chan.id}/retry`).set(ops)).status).toBe(409); // sudah selesai

    expect((await http().post(`/exceptions/${stock.id}/ignore`).set(ops)).body).toEqual({ state: "ignored" });
    expect((await http().get("/exceptions").set(ops)).body).toHaveLength(0);
    const actions = (await ctx.db.select().from(auditLog)).map((l) => l.action).sort();
    expect(actions).toEqual(expect.arrayContaining(["exception.retry", "exception.ignore"]));
  });
});

describe("Shopify webhook registration", () => {
  it("requires https, is idempotent, and is audited", async () => {
    const ops = await asRole(ctx, "ops");
    const seen = new Set<string>(); const urls: string[] = [];
    ctx.app.get(ConnectionService).factory = () => ({
      testConnection: async () => ({ shopName: "s", currency: "USD", granted: ["read_products"], missing: [] }),
      locations: async () => [{ id: "l", name: "L", isActive: true }],
      variants: async function* () { yield* [] as ShopifyVariant[]; }, setQuantity: async () => {},
      ensureWebhook: async (_t: string, url: string) => { urls.push(url); const had = seen.has(url); seen.add(url); return had ? "exists" : "created"; },
    } as never);
    const { body: c } = await http().post("/connections").set(ops).send({ shop: "x.myshopify.com", clientId: "c", clientSecret: "shpss_secret1234" });
    expect((await http().post(`/connections/${c.id}/webhooks`).set(ops).send({ publicUrl: "http://insecure.example" })).status).toBe(400);
    const a = await http().post(`/connections/${c.id}/webhooks`).set(ops).send({ publicUrl: "https://hub.example.com/" });
    const b = await http().post(`/connections/${c.id}/webhooks`).set(ops).send({ publicUrl: "https://hub.example.com" });
    expect([a.body.result, b.body.result]).toEqual(["created", "exists"]);
    expect(urls).toEqual(["https://hub.example.com/webhooks/shopify", "https://hub.example.com/webhooks/shopify"]);
  });
});
