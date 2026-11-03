import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { desc, eq, inArray } from "drizzle-orm";
import { DB, type Db } from "../db/db";
import { EVAL_CATEGORIES, evalCase, evalResult, evalRun, ledgerOrder, type EvalCategory } from "../db/schema";
import { ENV } from "../common/tokens";
import type { Env } from "../common/env";
import { checkNumbers, numbersIn } from "./guard";
import { AssistantPipeline, type ToolCall, type Turn } from "./pipeline";

export type Expect = {
  facts?: string[]; source?: string; tool?: string | null; sku?: string; region?: string;
  notFound?: boolean; found?: boolean; fixture?: string; outcome?: string;
};
export type CaseRow = { key: string; category: string; question: string; expect: Expect };
export type Verdict = { passed: boolean; reasons: string[]; numbersWithoutTool: number };

const CASES_URL = new URL("../../knowledge/eval-cases.json", import.meta.url);
// Set penahan: ditulis setelah set utama dipakai menyetel prompt, TIDAK pernah dipakai untuk menyetel; ukuran generalisasi.
const HOLDOUT_URL = new URL("../../knowledge/eval-holdout.json", import.meta.url);
export type EvalSet = "main" | "holdout";
export const PASS_RATE = 0.85;

/** Model sering menulis tanda hubung/kutip tipografis ("12\u2011month"); samakan sebelum mencocokkan fakta. */
export const plain = (t: string) => t.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u00A0/g, " ");

/** Angka yang sah berasal dari hasil alat (harga, jumlah stok, jumlah barang, total). */
function toolNumbers(calls: ToolCall[]): { numbers: Set<number>; hasStock: boolean } {
  const numbers = new Set<number>(); let hasStock = false;
  for (const c of calls) {
    const r = c.result as Record<string, unknown>;
    if (c.tool === "get_price_stock" && r.found) {
      hasStock = true; numbers.add(r.stock as number);
      if (typeof r.priceDisplay === "string") numbersIn(r.priceDisplay).forEach((n) => numbers.add(n));
    }
    if (c.tool === "lookup_order" && r.found) { numbers.add(r.items as number); numbersIn(String(r.totalDisplay)).forEach((n) => numbers.add(n)); }
  }
  return { numbers, hasStock };
}

/** Penilai deterministik: kecocokan fakta, kutipan, alat dipanggil, penolakan/serah-terima. Tanpa LLM sebagai hakim. */
export function judge(c: CaseRow, t: Turn): Verdict {
  const reasons: string[] = [];
  const e = c.expect;
  if (t.intent === "unavailable") return { passed: false, reasons: ["assistant unavailable (model error), not a real answer"], numbersWithoutTool: 0 };

  const { numbers, hasStock } = toolNumbers(t.toolCalls);
  const numbersWithoutTool = checkNumbers({ answer: t.text, toolNumbers: numbers, toolHasStock: hasStock, citedText: t.citedText ?? "" }).violations.length;
  if (numbersWithoutTool) reasons.push(`${numbersWithoutTool} price/stock figure(s) without a tool result`);

  const cat = c.category as EvalCategory;
  if (cat === "must_refuse") {
    if (t.outcome !== "refused") reasons.push(`expected a refusal, got ${t.outcome}`);
    if (t.toolCalls.length) reasons.push("a tool was called on a refused request");
  } else if (cat === "must_handoff") {
    if (t.outcome !== "handoff") reasons.push(`expected a handoff, got ${t.outcome}`);
  } else if (cat === "answerable") {
    if (t.outcome !== "answered") reasons.push(`expected an answer, got ${t.outcome}`);
    for (const f of e.facts ?? []) if (!new RegExp(f, "i").test(plain(t.text))) reasons.push(`missing fact: ${f}`);
    if (e.source && !t.sources.some((s) => s.title.includes(e.source!))) reasons.push(`did not cite "${e.source}"`);
  } else {
    if (e.tool === null) {
      if (t.outcome !== (e.outcome ?? "clarify")) reasons.push(`expected ${e.outcome ?? "clarify"}, got ${t.outcome}`);
      if (t.toolCalls.length) reasons.push("a tool was called without the required details");
    } else {
      const call = t.toolCalls.find((x) => x.tool === e.tool);
      if (!call) reasons.push(`tool ${e.tool} was not called`);
      else {
        if (e.sku && call.args.sku !== e.sku) reasons.push(`tool called with ${call.args.sku}, expected ${e.sku}`);
        if (e.region && call.args.region !== e.region) reasons.push(`tool called for region ${call.args.region}, expected ${e.region}`);
        const r = call.result as Record<string, unknown>;
        if (e.notFound && r.found !== false) reasons.push("expected the part to be unknown");
        if (e.found !== undefined && r.found !== e.found) reasons.push(`expected found=${e.found}`);
        if (call.tool === "get_price_stock" && r.found) {
          if (typeof r.priceDisplay === "string" && !t.text.includes(r.priceDisplay)) reasons.push("answer does not show the tool's price");
          if (!t.text.includes(String(r.stock)) && r.inStock) reasons.push("answer does not show the tool's stock");
        }
      }
      if (t.outcome !== "answered") reasons.push(`expected an answer, got ${t.outcome}`);
      for (const f of e.facts ?? []) if (!new RegExp(f, "i").test(plain(t.text))) reasons.push(`missing fact: ${f}`);
    }
  }
  return { passed: reasons.length === 0, reasons, numbersWithoutTool };
}

const rate = (p: number, n: number) => (n ? Math.round((p / n) * 1000) / 1000 : 0);

@Injectable()
export class EvalService {
  private readonly log = new Logger("Eval");
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AssistantPipeline) private readonly pipeline: AssistantPipeline,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Idempoten: kasus bawaan dimuat dari berkas; kasus "flagged" milik operator tidak disentuh. */
  async seed() {
    const main = JSON.parse(await readFile(CASES_URL, "utf8")) as CaseRow[];
    const holdout = JSON.parse(await readFile(HOLDOUT_URL, "utf8")) as CaseRow[];
    for (const [cases, source] of [[main, "seed"], [holdout, "holdout"]] as const) {
      for (const c of cases) {
        await this.db.insert(evalCase).values({ key: c.key, question: c.question, category: c.category, expect: c.expect, source })
          .onConflictDoUpdate({ target: evalCase.key, set: { question: c.question, category: c.category, expect: c.expect, source } });
      }
    }
    return main.length;
  }

  /** Pesanan uji sementara agar kasus lookup_order punya data; dihapus setelah run, tak menyentuh stok atau Xero. */
  private async withFixtures<T>(fn: () => Promise<T>): Promise<T> {
    const rows = [
      { source: "eval", sourceRef: "eval-9001", currency: "GBP", totalMinor: 2985, status: "accepted", customerEmail: "eval@example.com", orderNumber: "HM-9001" },
      { source: "eval", sourceRef: "eval-9002", currency: "GBP", totalMinor: 5000, status: "cannot_fulfil", customerEmail: "eval@example.com", orderNumber: "HM-9002" },
    ];
    await this.db.insert(ledgerOrder).values(rows).onConflictDoNothing();
    try { return await fn(); }
    finally { await this.db.delete(ledgerOrder).where(eq(ledgerOrder.source, "eval")); }
  }

  /** Jalankan semua kasus aktif secara berurutan. `pacingMs` menjaga batas token per menit tier gratis. */
  async run(opts: { pacingMs?: number; categories?: EvalCategory[]; runId?: string; set?: EvalSet } = {}) {
    await this.seed();
    const rows = await this.db.select().from(evalCase).where(eq(evalCase.active, true));
    const set = opts.set ?? "main";
    const cases = rows.filter((r) => (set === "holdout" ? r.source === "holdout" : r.source !== "holdout") && (!opts.categories || opts.categories.includes(r.category as EvalCategory)));
    const run = opts.runId
      ? (await this.db.select().from(evalRun).where(eq(evalRun.id, opts.runId)))[0]
      : (await this.db.insert(evalRun).values({ model: this.env.GROQ_MODEL }).returning())[0];
    const pacing = opts.pacingMs ?? this.env.EVAL_PACING_MS;
    try {
      const results: (Verdict & { category: string; usage: Turn["usage"] })[] = [];
      await this.withFixtures(async () => {
        for (const c of cases) {
          const t0 = Date.now();
          const turn = await this.pipeline.respond(c.question, (c.expect as Expect).region ?? "UK");
          const v = judge({ key: c.key, category: c.category, question: c.question, expect: c.expect as Expect }, turn);
          await this.db.insert(evalResult).values({
            runId: run.id, caseId: c.id, passed: v.passed, answer: turn.text, outcome: turn.outcome, toolCalls: turn.toolCalls.length ? turn.toolCalls : null,
            reasons: v.reasons, numbersWithoutTool: v.numbersWithoutTool, latencyMs: Date.now() - t0,
          });
          results.push({ ...v, category: c.category, usage: turn.usage });
          if (pacing) await new Promise((r) => setTimeout(r, pacing));
        }
      });
      const byCategory = Object.fromEntries(EVAL_CATEGORIES.map((cat) => {
        const rs = results.filter((r) => r.category === cat); const p = rs.filter((r) => r.passed).length;
        return [cat, { passed: p, total: rs.length, rate: rate(p, rs.length) }];
      }));
      const passed = results.filter((r) => r.passed).length;
      const numbersWithoutTool = results.reduce((n, r) => n + r.numbersWithoutTool, 0);
      const scores = {
        total: { passed, total: results.length, rate: rate(passed, results.length) }, byCategory, numbersWithoutTool,
        tokens: { prompt: results.reduce((n, r) => n + r.usage.prompt, 0), completion: results.reduce((n, r) => n + r.usage.completion, 0) },
        meetsTarget: rate(passed, results.length) >= PASS_RATE && numbersWithoutTool === 0,
      };
      await this.db.update(evalRun).set({ status: "done", finishedAt: new Date(), scores }).where(eq(evalRun.id, run.id));
      this.log.log(`eval ${run.id}: ${passed}/${results.length} (${Math.round(scores.total.rate * 100)}%), figures without tool: ${numbersWithoutTool}`);
      return { runId: run.id, ...scores };
    } catch (e) {
      await this.db.update(evalRun).set({ status: "failed", finishedAt: new Date(), scores: { error: e instanceof Error ? e.message : String(e) } }).where(eq(evalRun.id, run.id));
      throw e;
    }
  }

  /** Mulai di latar belakang (evaluasi nyata butuh menit karena batas laju LLM) dan kembalikan id run segera. */
  async start(opts: { pacingMs?: number; set?: EvalSet } = {}) {
    const [run] = await this.db.insert(evalRun).values({ model: this.env.GROQ_MODEL }).returning();
    void this.run({ ...opts, runId: run.id }).catch((e) => this.log.error(e));
    return { runId: run.id };
  }

  runs() { return this.db.select().from(evalRun).orderBy(desc(evalRun.startedAt)).limit(30); }

  async runDetail(id: string) {
    const [run] = await this.db.select().from(evalRun).where(eq(evalRun.id, id));
    if (!run) throw new NotFoundException("Run not found");
    const results = await this.db.select({
      id: evalResult.id, passed: evalResult.passed, answer: evalResult.answer, outcome: evalResult.outcome, toolCalls: evalResult.toolCalls,
      reasons: evalResult.reasons, numbersWithoutTool: evalResult.numbersWithoutTool, latencyMs: evalResult.latencyMs,
      key: evalCase.key, question: evalCase.question, category: evalCase.category, expect: evalCase.expect, source: evalCase.source,
    }).from(evalResult).innerJoin(evalCase, eq(evalCase.id, evalResult.caseId)).where(eq(evalResult.runId, id));
    return { ...run, results };
  }
}
