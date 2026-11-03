import { Inject, Injectable } from "@nestjs/common";
import { eq, inArray, sql } from "drizzle-orm";
import { DB, type Db } from "../db/db";
import { exceptionItem, ledgerLine, ledgerOrder, sku } from "../db/schema";
import { InventoryService } from "./inventory.service";

export type OrderInput = {
  source: "storefront" | "shopify";
  sourceRef: string;
  currency: string;
  totalMinor: number;
  paidAt?: Date;
  lines: { sku: string; qty: number; unitMinor: number }[];
};
export type IngestResult =
  | { outcome: "duplicate" }
  | { outcome: "accepted"; orderId: string }
  | { outcome: "cannot_fulfil"; orderId: string; shortages: { sku: string; available: number; requested: number }[] };

@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(InventoryService) private readonly inventory: InventoryService) {}

  /**
   * Satu transaksi: catat order (unik per source+ref), kunci baris SKU berurutan (anti-deadlock),
   * cek stok, lalu kurangi semua atau tidak sama sekali. Order yang tak bisa dipenuhi tidak
   * mengurangi stok dan menjadi exception untuk diputuskan orang.
   */
  async ingestOrder(input: OrderInput): Promise<IngestResult> {
    return this.db.transaction(async (tx) => {
      const ins = await tx.insert(ledgerOrder).values({
        source: input.source, sourceRef: input.sourceRef, currency: input.currency,
        totalMinor: input.totalMinor, paidAt: input.paidAt ?? new Date(), status: "accepted",
      }).onConflictDoNothing().returning({ id: ledgerOrder.id });
      if (!ins.length) return { outcome: "duplicate" as const };
      const orderId = ins[0].id;

      if (input.lines.length) await tx.insert(ledgerLine).values(input.lines.map((l) => ({ orderId, ...l })));

      const need = new Map<string, number>();
      for (const l of input.lines) need.set(l.sku, (need.get(l.sku) ?? 0) + l.qty);
      const skus = [...need.keys()].sort();
      if (skus.length) {
        await tx.insert(sku).values(skus.map((s) => ({ sku: s }))).onConflictDoNothing();
        // Kunci berurutan agar dua order dengan SKU berbeda urutan tidak saling menunggu.
        await tx.execute(sql`select sku from ${sku} where ${inArray(sku.sku, skus)} order by sku for update`);
      }

      const shortages: { sku: string; available: number; requested: number }[] = [];
      for (const s of skus) {
        const available = await this.inventory.stock(s, tx);
        if (available < need.get(s)!) shortages.push({ sku: s, available, requested: need.get(s)! });
      }
      if (shortages.length) {
        await tx.update(ledgerOrder).set({ status: "cannot_fulfil" }).where(eq(ledgerOrder.id, orderId));
        await tx.insert(exceptionItem).values({
          orderId, errorClass: "stock",
          message: "Insufficient stock: " + shortages.map((x) => `${x.sku} ${x.available} left, ${x.requested} requested`).join("; "),
          payload: { source: input.source, sourceRef: input.sourceRef, shortages },
        });
        return { outcome: "cannot_fulfil" as const, orderId, shortages };
      }

      for (const s of skus) {
        await this.inventory.adjust(s, -need.get(s)!, `order:${input.source}`, `order:${input.source}:${input.sourceRef}:${s}`, tx);
      }
      return { outcome: "accepted" as const, orderId };
    });
  }
}
