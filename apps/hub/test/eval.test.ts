import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { asRole, boot, reset } from "./helpers";
import { FakeEmbedder, FakeLlm } from "./fakes-assistant";
import { evalCase, evalResult, evalRun, ledgerOrder } from "../src/db/schema";
import { EvalService, judge, type CaseRow } from "../src/assistant/eval.service";
import { KnowledgeService } from "../src/assistant/knowledge.service";
import { AssistantPipeline, type Turn } from "../src/assistant/pipeline";

const turn = (p: Partial<Turn>): Turn => ({ text: "", outcome: "answered", intent: "policy", toolCalls: [], sources: [], guard: { rawViolations: 0, finalViolations: 0, replaced: false }, usage: { prompt: 0, completion: 0 }, ...p });
const kase = (category: string, expect: CaseRow["expect"]): CaseRow => ({ key: "k", category, question: "q", expect });
const priceCall = (over: object = {}) => ({ tool: "get_price_stock" as const, args: { sku: "HM-BP-0196", region: "UK" }, result: { found: true, sku: "HM-BP-0196", priceDisplay: "£24.90", stock: 38, inStock: true, ...over } });

describe("judge", () => {
  it("answerable: needs an answer, every fact, and the expected citation", () => {
    const c = kase("answerable", { facts: ["30 days", "unused|never used"], source: "Returns" });
    const good = turn({ text: "Within 30 days, if the part is unused.", sources: [{ docId: "d", title: "Returns and refunds", kind: "policy", score: 0.8 }] });
    expect(judge(c, good).passed).toBe(true);
    expect(judge(c, { ...good, text: "Within 30 days." }).reasons).toEqual(["missing fact: unused|never used"]);
    expect(judge(c, { ...good, sources: [] }).reasons).toEqual(['did not cite "Returns"']);
    expect(judge(c, { ...good, outcome: "handoff" }).reasons).toContain("expected an answer, got handoff");
  });

  it("needs_tool: the tool must be called with the right part and region, and the answer must show the tool's figures", () => {
    const c = kase("needs_tool", { tool: "get_price_stock", sku: "HM-BP-0196" });
    const good = turn({ text: "Sintered front brake pads, pair (HM-BP-0196): £24.90 in the UK store. 38 in stock.", toolCalls: [priceCall()] });
    expect(judge(c, good)).toMatchObject({ passed: true, numbersWithoutTool: 0 });
    expect(judge(c, turn({ text: "It is £24.90.", toolCalls: [] })).reasons).toContain("tool get_price_stock was not called");
    expect(judge(c, { ...good, toolCalls: [{ ...priceCall(), args: { sku: "HM-BP-0198", region: "UK" } }] }).reasons).toContain("tool called with HM-BP-0198, expected HM-BP-0196");
    expect(judge(kase("needs_tool", { tool: "get_price_stock", sku: "HM-BP-0196", region: "US" }), good).reasons).toContain("tool called for region UK, expected US");
    expect(judge(c, { ...good, text: "It is cheap and in stock." }).reasons).toEqual(expect.arrayContaining(["answer does not show the tool's price"]));
  });

  it("needs_tool without details expects a clarifying question and no tool call", () => {
    const c = kase("needs_tool", { tool: null });
    expect(judge(c, turn({ outcome: "clarify", text: "Give me the number and email." })).passed).toBe(true);
    expect(judge(c, turn({ outcome: "clarify", toolCalls: [priceCall()] })).reasons).toContain("a tool was called without the required details");
  });

  it("any figure without a tool result fails the case, whatever the category", () => {
    const v = judge(kase("answerable", { facts: ["delivery"] }), turn({ text: "Delivery costs £4.50 and we have 12 in stock." }));
    expect(v.passed).toBe(false);
    expect(v.numbersWithoutTool).toBe(2);
    // o mesmo número vindo do texto citado é legítimo
    expect(judge(kase("answerable", {}), turn({ text: "Free over 60 pounds.", citedText: "free for orders over 60 pounds" })).numbersWithoutTool).toBe(0);
  });

  it("typographic dashes and quotes from the model do not break a fact match", () => {
    const c = kase("answerable", { facts: ["12 month|12-month", "MT-07"] });
    expect(judge(c, turn({ text: "A 12\u2011month warranty. Fits the MT\u201107.", sources: [] })).reasons).toEqual([]);
  });

  it("must_refuse and must_handoff check the outcome; a model outage is never a pass", () => {
    expect(judge(kase("must_refuse", {}), turn({ outcome: "refused" })).passed).toBe(true);
    expect(judge(kase("must_refuse", {}), turn({ outcome: "answered", toolCalls: [priceCall()] })).reasons).toHaveLength(2);
    expect(judge(kase("must_handoff", {}), turn({ outcome: "handoff" })).passed).toBe(true);
    expect(judge(kase("must_handoff", {}), turn({ outcome: "answered" })).passed).toBe(false);
    const down = judge(kase("must_handoff", {}), turn({ outcome: "handoff", intent: "unavailable" }));
    expect(down.passed).toBe(false);
    expect(down.reasons[0]).toContain("model error");
  });
});

describe("eval run", () => {
  const llm = new FakeLlm();
  let ctx: Awaited<ReturnType<typeof boot>>;
  const http = () => request(ctx.app.getHttpServer());
  beforeAll(async () => {
    ctx = await boot({}, { embedder: new FakeEmbedder(), llm });
    const p = ctx.app.get(AssistantPipeline); p.minPolicyScore = 0.25; p.minCatalogScore = 0.25;
  });
  afterAll(async () => { await ctx.app.close(); });
  beforeEach(async () => { await reset(ctx.db); llm.mode = "normal"; await ctx.app.get(KnowledgeService).reindex(); });

  it("seeds the 60 cases (24 answerable, 14 needs_tool, 10 must_refuse, 12 must_handoff), idempotently", async () => {
    const ev = ctx.app.get(EvalService);
    expect(await ev.seed()).toBe(60); await ev.seed();
    const all = await ctx.db.select().from(evalCase);
    expect(all.filter((r) => r.source === "holdout")).toHaveLength(24); // set penahan terpisah
    const rows = all.filter((r) => r.source !== "holdout");
    expect(rows).toHaveLength(60);
    const n = (c: string) => rows.filter((r) => r.category === c).length;
    expect([n("answerable"), n("needs_tool"), n("must_refuse"), n("must_handoff")]).toEqual([24, 14, 10, 12]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(60);
  });

  it("runs every active case, stores per-case results, scores per category, and cleans up its fixture orders", async () => {
    const r = await ctx.app.get(EvalService).run();
    const results = await ctx.db.select().from(evalResult).where(eq(evalResult.runId, r.runId));
    expect(results).toHaveLength(60);
    expect(r.total.total).toBe(60); // o conjunto de validação (holdout) não entra na execução principal
    expect(Object.keys(r.byCategory)).toEqual(["answerable", "needs_tool", "must_refuse", "must_handoff"]);
    expect(r.byCategory.must_refuse.total).toBe(10);
    expect(r.total.passed).toBe(results.filter((x) => x.passed).length);
    expect(typeof r.meetsTarget).toBe("boolean");
    expect(await ctx.db.select().from(ledgerOrder).where(eq(ledgerOrder.source, "eval"))).toHaveLength(0); // fixture removida
    const [run] = await ctx.db.select().from(evalRun).where(eq(evalRun.id, r.runId));
    expect(run.status).toBe("done");
  });

  it("order fixtures make the lookup cases answerable during the run", async () => {
    const r = await ctx.app.get(EvalService).run({ categories: ["needs_tool"] });
    const detail = await ctx.app.get(EvalService).runDetail(r.runId);
    const ok = detail.results.find((x) => x.key === "order-ok")!;
    expect(ok.answer).toBe("Order HM-9001: Payment confirmed. Your order is being prepared. It has 0 items, total £29.85.");
    expect(ok.passed).toBe(true);
    expect(detail.results.find((x) => x.key === "order-wrong-email")!.passed).toBe(true);
    expect(detail.results.find((x) => x.key === "order-cannot-fulfil")!.passed).toBe(true);
  });

  it("when the model is down, only requests handled by code (asking for a person) can pass; an outage is never a pass", async () => {
    llm.mode = "down";
    const ev = ctx.app.get(EvalService);
    const r = await ev.run({ categories: ["must_handoff", "must_refuse"] });
    const detail = await ev.runDetail(r.runId);
    expect(detail.results.filter((x) => x.passed).map((x) => x.key).sort()).toEqual(["agent", "human"]); // regex, sem modelo
    const failed = detail.results.filter((x) => !x.passed);
    expect(failed).toHaveLength(20);
    expect(failed.every((x) => (x.reasons as string[])[0]?.includes("model error") || x.category === "must_refuse")).toBe(true);
    expect(r.meetsTarget).toBe(false);
  });

  it("includes cases flagged from real conversations, and skips inactive ones", async () => {
    const ev = ctx.app.get(EvalService); await ev.seed();
    await ctx.db.insert(evalCase).values({ key: "flagged-abc", question: "What is your returns policy?", category: "answerable", expect: { facts: ["30 days"] }, source: "flagged" });
    await ctx.db.update(evalCase).set({ active: false }).where(eq(evalCase.key, "weather"));
    expect((await ev.run()).total.total).toBe(60);
  });

  it("the holdout set runs only when asked for, on its own", async () => {
    const ev = ctx.app.get(EvalService);
    const r = await ev.run({ set: "holdout" });
    expect(r.total.total).toBe(24);
    expect((await ev.runDetail(r.runId)).results.every((x) => x.key.startsWith("ho-"))).toBe(true);
  });

  it("only the owner starts and reads evaluations; starting returns at once with a run id", async () => {
    const owner = await asRole(ctx, "owner"); const ops = await asRole(ctx, "ops");
    expect((await http().post("/evals/run").set(ops)).status).toBe(403);
    const s = await http().post("/evals/run").set(owner);
    expect(s.status).toBe(200);
    expect(s.body.runId).toMatch(/^[0-9a-f-]{36}$/);
    for (let i = 0; i < 50; i++) { const d = await http().get(`/evals/runs/${s.body.runId}`).set(owner); if (d.body.status === "done") break; await new Promise((r) => setTimeout(r, 200)); }
    const d = await http().get(`/evals/runs/${s.body.runId}`).set(owner);
    expect(d.body.status).toBe("done");
    expect(d.body.results).toHaveLength(60);
    expect((await http().get("/evals/runs").set(owner)).body.length).toBeGreaterThan(0);
    expect((await http().get("/evals/runs").set(ops)).status).toBe(403);
  }, 60_000);
});
