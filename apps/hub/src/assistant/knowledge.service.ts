import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { eq, inArray, sql } from "drizzle-orm";
import { DB, type Db } from "../db/db";
import { chunk, doc } from "../db/schema";
import { ENV } from "../common/tokens";
import type { Env } from "../common/env";
import { chunkMarkdown } from "./chunker";
import { EMBEDDER, type Embedder } from "./embedder";

export type Passage = { chunkId: string; docId: string; title: string; kind: string; sourceKey?: string; text: string; score: number };
type Source = { key: string; title: string; kind: "policy" | "catalog"; body: string };
const POLICY_DIR = new URL("../../knowledge/policies/", import.meta.url);
const vec = (v: number[]) => `[${v.join(",")}]`;

@Injectable()
export class KnowledgeService {
  private readonly log = new Logger("Knowledge");
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Berkas kebijakan di repo + katalog dari Medusa (tanpa harga/stok: angka itu hanya boleh datang dari alat). */
  async sources(): Promise<Source[]> {
    const out: Source[] = [];
    for (const f of (await readdir(POLICY_DIR)).filter((x) => x.endsWith(".md")).sort()) {
      const body = await readFile(new URL(f, POLICY_DIR), "utf8");
      out.push({ key: `policy:${f}`, title: (body.match(/^#\s+(.+)$/m)?.[1] ?? f).trim(), kind: "policy", body });
    }
    out.push(...(await this.catalogSources()));
    return out;
  }

  private async catalogSources(): Promise<Source[]> {
    if (!this.env.MEDUSA_URL || !this.env.MEDUSA_PUBLISHABLE_KEY) return [];
    const h = { "x-publishable-api-key": this.env.MEDUSA_PUBLISHABLE_KEY };
    const get = async <T>(p: string) => (await (await fetch(this.env.MEDUSA_URL + p, { headers: h })).json()) as T;
    const [{ products }, fit] = await Promise.all([
      get<{ products: { title: string; handle: string; metadata?: { spec?: string; position?: string | null } | null; categories?: { name: string }[]; variants?: { sku: string }[] }[] }>("/store/products?limit=200&fields=title,handle,metadata,*categories,*variants"),
      get<{ parts: Record<string, { make: string; model: string; year_from: number; year_to: number }[]> }>("/store/fitment-catalog"),
    ]);
    return products.flatMap((p) => {
      const sku = p.variants?.[0]?.sku;
      if (!sku) return [];
      const bikes = fit.parts[sku];
      const fits = bikes?.length ? `Fits: ${bikes.map((b) => `${b.make} ${b.model} ${b.year_from} to ${b.year_to}`).join("; ")}.` : "Fitment: no fitment data, so customers must check fitment with a person before ordering.";
      const body = `# ${p.title} (${sku})\n\n## Part details\n${p.title}, part number ${sku}. Category: ${p.categories?.[0]?.name ?? "Parts"}.${p.metadata?.position ? ` Position: ${p.metadata.position}.` : ""}${p.metadata?.spec ? ` ${p.metadata.spec}.` : ""}\n\n## Fitment\n${fits}`;
      return [{ key: `catalog:${sku}`, title: `${p.title} (${sku})`, kind: "catalog" as const, body }];
    });
  }

  /** Idempoten: hanya dokumen yang isinya berubah yang diembed ulang; sumber yang hilang ikut dihapus. */
  async reindex() {
    const sources = await this.sources();
    const existing = await this.db.select({ id: doc.id, key: doc.sourceKey, hash: doc.sourceHash }).from(doc);
    const byKey = new Map(existing.map((d) => [d.key, d]));
    let added = 0, updated = 0, unchanged = 0, chunks = 0;
    for (const s of sources) {
      const hash = createHash("sha256").update(s.body).digest("hex");
      const prev = byKey.get(s.key);
      if (prev?.hash === hash) { unchanged++; continue; }
      const pieces = chunkMarkdown(s.body);
      const vectors = await this.embedder.embed(pieces.map((p) => p.text), "passage");
      await this.db.transaction(async (tx) => {
        let id = prev?.id;
        if (id) {
          await tx.update(doc).set({ title: s.title, sourceHash: hash, body: s.body, updatedAt: new Date() }).where(eq(doc.id, id));
          await tx.delete(chunk).where(eq(chunk.docId, id));
        } else {
          [{ id }] = await tx.insert(doc).values({ title: s.title, kind: s.kind, sourceKey: s.key, sourceHash: hash, body: s.body }).returning({ id: doc.id });
        }
        await tx.insert(chunk).values(pieces.map((p, i) => ({ docId: id!, ord: p.ord, text: p.text, embedding: vectors[i], metadata: { key: s.key } })));
      });
      prev ? updated++ : added++;
      chunks += pieces.length;
    }
    const live = new Set(sources.map((s) => s.key));
    const gone = existing.filter((d) => !live.has(d.key)).map((d) => d.id);
    if (gone.length) await this.db.delete(doc).where(inArray(doc.id, gone));
    this.log.log(`reindex: +${added} ~${updated} =${unchanged} -${gone.length} (${chunks} chunks)`);
    return { added, updated, unchanged, removed: gone.length, chunks };
  }

  /** Pencarian vektor (cosine). score = 1 - jarak; makin tinggi makin mirip. */
  async search(query: string, k = 4, kinds?: ("policy" | "catalog")[]): Promise<Passage[]> {
    const [q] = await this.embedder.embed([query], "query");
    const rows = await this.db.execute<{ chunkId: string; docId: string; title: string; kind: string; sourceKey: string; text: string; score: number }>(sql`
      select c.id as "chunkId", c.doc_id as "docId", d.title, d.kind, d.source_key as "sourceKey", c.text, 1 - (c.embedding <=> ${vec(q)}::vector) as score
      from hub.chunk c join hub.doc d on d.id = c.doc_id
      ${kinds?.length ? sql`where d.kind in (${sql.join(kinds.map((x) => sql`${x}`), sql`, `)})` : sql``}
      order by c.embedding <=> ${vec(q)}::vector limit ${k}`);
    return rows.rows.map((r) => ({ ...r, score: Number(r.score) }));
  }

  async list() {
    return this.db.select({ id: doc.id, title: doc.title, kind: doc.kind, sourceKey: doc.sourceKey, updatedAt: doc.updatedAt, chunks: sql<number>`(select count(*)::int from hub.chunk c where c.doc_id = hub.doc.id)` }).from(doc);
  }
}
