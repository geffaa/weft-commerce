import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DB, type Db } from "../db/db";
import { run, skuMap } from "../db/schema";
import { InventoryService } from "../ledger/inventory.service";
import { ConnectionService } from "./connection.service";
import type { ShopifyVariant } from "./shopify.client";

export type Classified = ShopifyVariant & { state: "mapped" | "conflict" | "missing"; conflictReason: string | null };

/**
 * Aturan: tanpa SKU -> missing. SKU kembar (tanpa membedakan huruf besar/kecil, spasi dipangkas)
 * di antara varian kanal -> semuanya conflict, karena tak bisa ditebak mana yang dimaksud.
 */
export function classify(variants: ShopifyVariant[]): Classified[] {
  const norm = (v: ShopifyVariant) => v.sku?.trim() || null;
  const count = new Map<string, number>();
  for (const v of variants) { const k = norm(v)?.toLowerCase(); if (k) count.set(k, (count.get(k) ?? 0) + 1); }
  return variants.map((v): Classified => {
    const sku = norm(v);
    if (!sku) return { ...v, sku: null, state: "missing", conflictReason: "Variant has no SKU" };
    const n = count.get(sku.toLowerCase()) ?? 0;
    if (n > 1) return { ...v, sku, state: "conflict", conflictReason: `SKU "${sku}" is used by ${n} variants` };
    return { ...v, sku, state: "mapped", conflictReason: null };
  });
}

@Injectable()
export class ImportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ConnectionService) private readonly connections: ConnectionService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  /**
   * Impor produk/varian/stok awal. Stok awal hanya dari varian "mapped" dan dihitung sekali per varian
   * (source_event_id), sehingga impor ulang tidak menimpa stok Weft, yang adalah sumber kebenaran.
   */
  async run(connectionId: string, trigger = "manual") {
    const { row, client } = await this.connections.get(connectionId).then(async (r) => ({ row: r, client: this.connections.clientFor(r) }));
    const [r] = await this.db.insert(run).values({ kind: "import", trigger }).returning();
    try {
      const all: ShopifyVariant[] = [];
      for await (const v of client.variants(row.locationId!)) all.push(v);
      const classified = classify(all);
      let stockImported = 0;
      for (const v of classified) {
        const values = {
          channel: "shopify", channelVariantId: v.variantId, inventoryItemId: v.inventoryItemId, weftSku: v.sku,
          productTitle: v.productTitle, variantTitle: v.variantTitle, state: v.state, conflictReason: v.conflictReason, updatedAt: new Date(),
        };
        await this.db.insert(skuMap).values(values).onConflictDoUpdate({ target: [skuMap.channel, skuMap.channelVariantId], set: values });
        // Stok awal hanya untuk SKU yang belum punya riwayat di buku besar: Weft adalah sumber kebenaran,
        // jadi SKU yang sudah dikenal tidak ditambah lagi (menghindari stok terhitung dua kali).
        if (v.state === "mapped" && v.tracked && v.available !== null && v.available > 0 && !(await this.inventory.hasHistory(v.sku!))) {
          if (await this.inventory.adjust(v.sku!, v.available, "import:shopify", `import:shopify:${v.variantId}`)) stockImported++;
        }
      }
      const stats = {
        variants: classified.length,
        mapped: classified.filter((v) => v.state === "mapped").length,
        missing: classified.filter((v) => v.state === "missing").length,
        conflict: classified.filter((v) => v.state === "conflict").length,
        stockImported,
      };
      await this.db.update(run).set({ status: "done", finishedAt: new Date(), stats }).where(eq(run.id, r.id));
      return { runId: r.id, ...stats };
    } catch (e) {
      await this.db.update(run).set({ status: "failed", finishedAt: new Date(), stats: { error: e instanceof Error ? e.message : String(e) } }).where(eq(run.id, r.id));
      throw e;
    }
  }

  list(state?: string) {
    return state ? this.db.select().from(skuMap).where(and(eq(skuMap.channel, "shopify"), eq(skuMap.state, state))) : this.db.select().from(skuMap).where(eq(skuMap.channel, "shopify"));
  }
}
