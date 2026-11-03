import { Injectable, Logger } from "@nestjs/common";

export interface Embedder {
  embed(texts: string[], kind: "passage" | "query"): Promise<number[][]>;
}
export const EMBEDDER = Symbol("EMBEDDER");

// bge-small-en-v1.5 (384 dimensi): gratis, lokal, tak ada data keluar server. Pencarian memakai awalan instruksi bge.
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
const MODEL = "Xenova/bge-small-en-v1.5";

@Injectable()
export class LocalEmbedder implements Embedder {
  private readonly log = new Logger("Embedder");
  private pipe?: Promise<(t: string[], o: object) => Promise<{ tolist(): number[][] }>>;

  private load() {
    this.pipe ??= (async () => {
      const t0 = Date.now();
      const { pipeline } = await import("@huggingface/transformers");
      const p = await pipeline("feature-extraction", MODEL, { dtype: "fp32" });
      this.log.log(`embedding model ready in ${Date.now() - t0} ms`);
      return p as unknown as (t: string[], o: object) => Promise<{ tolist(): number[][] }>;
    })();
    return this.pipe;
  }

  async embed(texts: string[], kind: "passage" | "query") {
    if (!texts.length) return [];
    const p = await this.load();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16).map((t) => (kind === "query" ? QUERY_PREFIX + t : t));
      out.push(...(await p(batch, { pooling: "cls", normalize: true })).tolist());
    }
    return out;
  }
}
