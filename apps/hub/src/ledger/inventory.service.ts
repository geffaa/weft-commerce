import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DB, type Db } from "../db/db";
import { inventoryEntry, outbox, sku } from "../db/schema";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

@Injectable()
export class InventoryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async stock(skuCode: string, tx: Tx | Db = this.db): Promise<number> {
    const [row] = await tx
      .select({ qty: sql<number>`coalesce(sum(${inventoryEntry.delta}), 0)::int` })
      .from(inventoryEntry)
      .where(eq(inventoryEntry.sku, skuCode));
    return row.qty;
  }

  /** Apakah buku besar sudah punya satu pun peristiwa stok untuk SKU ini. */
  async hasHistory(skuCode: string): Promise<boolean> {
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(inventoryEntry).where(eq(inventoryEntry.sku, skuCode));
    return r.n > 0;
  }

  /** Menambah baris stok; peristiwa yang sama (sourceEventId) tidak pernah dihitung dua kali. */
  async adjust(skuCode: string, delta: number, reason: string, sourceEventId: string, tx?: Tx): Promise<boolean> {
    const run = async (t: Tx) => {
      await t.insert(sku).values({ sku: skuCode }).onConflictDoNothing();
      const ins = await t.insert(inventoryEntry)
        .values({ sku: skuCode, delta, reason, sourceEventId })
        .onConflictDoNothing()
        .returning({ id: inventoryEntry.id });
      if (!ins.length) return false;
      await this.enqueueStockPush(t, skuCode);
      return true;
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  /**
   * Dorong stok sebagai kuantitas ABSOLUT. Tugas pending untuk SKU yang sama digabung
   * (nilai terakhir menang), sehingga badai webhook tidak menumpuk panggilan ke kanal.
   */
  async enqueueStockPush(tx: Tx, skuCode: string) {
    const quantity = await this.stock(skuCode, tx);
    await tx.insert(outbox)
      .values({ topic: "stock.push", payload: { sku: skuCode, quantity }, idempotencyKey: `stock.push:${skuCode}` })
      .onConflictDoUpdate({
        target: outbox.idempotencyKey,
        targetWhere: sql`status = 'pending'`,
        set: { payload: { sku: skuCode, quantity } },
      });
  }
}
