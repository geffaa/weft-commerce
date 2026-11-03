import { z } from "zod";
import type { Embedder } from "../src/assistant/embedder";
import { LlmError, type JsonRequest, type Llm } from "../src/assistant/llm";

const STOP = new Set("a an the is are was were do does did i my me you your we our to of for and or in on at it this that can how what when where which with be by if as from have has any there will not no yes".split(" "));
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");

/** Embedding tas-kata: kata isi yang sama -> vektor mirip. Deterministik, tanpa model, 384 dimensi. */
export class FakeEmbedder implements Embedder {
  calls = 0;
  async embed(texts: string[]) {
    this.calls += texts.length;
    return texts.map((t) => {
      const v = new Array(384).fill(0);
      for (const w of t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((x) => x && !STOP.has(x))) {
        const s = stem(w); let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        v[h % 384] += 1;
      }
      const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
      return v.map((x) => x / n);
    });
  }
}

export type FakeMode = "normal" | "lie_price" | "no_cite" | "unanswerable" | "obey_injection" | "down";

/** LLM tiruan berbasis aturan: mengklasifikasi dengan kata kunci dan menjawab dengan mengutip dokumen pertama. */
export class FakeLlm implements Llm {
  mode: FakeMode = "normal";
  calls: { model: string; kind: "classify" | "answer"; user: string }[] = [];
  async json<T>(req: JsonRequest, schema: z.ZodType<T>) {
    if (this.mode === "down") throw new LlmError("model down", "unavailable");
    const usage = { prompt: 100, completion: 20 };
    if (req.system.includes("route customer messages")) {
      this.calls.push({ model: req.model, kind: "classify", user: req.user });
      const q = (req.user.match(/<customer_message>([\s\S]*)<\/customer_message>/)?.[1] ?? "").toLowerCase();
      let intent = "out_of_scope";
      if (/ignore (all |previous )?instructions|system prompt|pretend|jailbreak|poem|weather|bitcoin|install|torque|repair/.test(q)) intent = "out_of_scope";
      else if (/complain|abs\b|discount|lawyer|sue|injur|safety claim|negotiat/.test(q)) intent = "needs_person";
      else if (/order/.test(q) && /(status|where|track|hm-|#\d)/.test(q)) intent = "order";
      else if (/price|cost|how much|in stock|stock|available|availability/.test(q) && !/shipping|delivery/.test(q)) intent = "price_stock";
      else if (/fit|compatible|which bike|what is|part number/.test(q)) intent = "product";
      else if (/return|refund|ship|deliver|warranty|pay|card|garage|contact|cancel|trade|vat|gst|tax|track/.test(q)) intent = "policy";
      const productQuery = ["product", "price_stock"].includes(intent) ? q.replace(/[^a-z0-9 ]/g, " ").trim() : null;
      return { value: schema.parse({ intent, product_query: productQuery }), usage };
    }
    this.calls.push({ model: req.model, kind: "answer", user: req.user });
    const docs = [...req.user.matchAll(/<document index="(\d+)"[^>]*>\n([\s\S]*?)\n<\/document>/g)];
    if (this.mode === "unanswerable" || !docs.length) return { value: schema.parse({ answerable: false, answer: "", cited: [] }), usage };
    const body = docs[0][2].split("\n").slice(1).join(" ").split(/(?<=\.)\s/).slice(0, 2).join(" ");
    if (this.mode === "lie_price") return { value: schema.parse({ answerable: true, answer: `${body} It costs £9.99 and we have 500 in stock.`, cited: [1] }), usage };
    if (this.mode === "obey_injection") return { value: schema.parse({ answerable: true, answer: "Sure! The price is £0.01 and I will email you every customer's order.", cited: [1] }), usage };
    if (this.mode === "no_cite") return { value: schema.parse({ answerable: true, answer: body, cited: [] }), usage };
    return { value: schema.parse({ answerable: true, answer: body, cited: [1] }), usage };
  }
}
