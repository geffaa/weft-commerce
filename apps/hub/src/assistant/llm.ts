import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";

export type Usage = { prompt: number; completion: number };
export type JsonRequest = { model: "fast" | "main"; system: string; user: string; maxTokens?: number };
export interface Llm {
  /** Minta objek JSON; hasil divalidasi skema. Gagal parse = satu percobaan ulang. */
  json<T>(req: JsonRequest, schema: z.ZodType<T>): Promise<{ value: T; usage: Usage }>;
}
export const LLM = Symbol("LLM");

export class LlmError extends Error {
  constructor(message: string, public readonly kind: "unavailable" | "rate_limited" | "invalid") { super(message); }
}

/** Groq (API kompatibel OpenAI). Dipakai juga oleh proyek Telusur; model sama (gpt-oss). */
@Injectable()
export class GroqLlm implements Llm {
  private readonly log = new Logger("Groq");
  constructor(private readonly opts: { apiKey?: string; model: string; fastModel: string; fetch?: typeof fetch }) {}

  private async call(model: string, system: string, user: string, maxTokens: number, attempt = 0): Promise<{ text: string; usage: Usage }> {
    if (!this.opts.apiKey) throw new LlmError("GROQ_API_KEY is not configured", "unavailable");
    const res = await (this.opts.fetch ?? fetch)("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${this.opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: maxTokens, response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        // gpt-oss menalar dulu; usaha rendah menjaga token (batas tier gratis kecil) dan latensi.
        reasoning_effort: "low",
      }),
    });
    if (res.status === 429) {
      const wait = Math.min(30, Number(res.headers.get("retry-after") ?? 8));
      if (attempt < 3) { this.log.warn(`rate limited, waiting ${wait}s`); await new Promise((r) => setTimeout(r, wait * 1000)); return this.call(model, system, user, maxTokens, attempt + 1); }
      throw new LlmError("The language model is rate limited", "rate_limited");
    }
    if (res.status >= 500 && attempt < 2) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); return this.call(model, system, user, maxTokens, attempt + 1); }
    const body = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number }; error?: { message: string } };
    if (!res.ok) throw new LlmError(body.error?.message ?? `HTTP ${res.status}`, "unavailable");
    return { text: body.choices?.[0]?.message?.content ?? "", usage: { prompt: body.usage?.prompt_tokens ?? 0, completion: body.usage?.completion_tokens ?? 0 } };
  }

  async json<T>(req: JsonRequest, schema: z.ZodType<T>) {
    const model = req.model === "fast" ? this.opts.fastModel : this.opts.model;
    const maxTokens = req.maxTokens ?? 700;
    let usage: Usage = { prompt: 0, completion: 0 };
    for (let i = 0; i < 2; i++) {
      const r = await this.call(model, req.system, req.user, maxTokens);
      usage = { prompt: usage.prompt + r.usage.prompt, completion: usage.completion + r.usage.completion };
      try { return { value: schema.parse(JSON.parse(r.text)), usage }; } catch { /* coba sekali lagi */ }
    }
    throw new LlmError("The model did not return valid JSON", "invalid");
  }
}
