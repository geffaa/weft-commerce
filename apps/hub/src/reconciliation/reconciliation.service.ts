import { Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { DB, type Db } from "../db/db";
import { outbox, reconciliationReport, run, skuMap } from "../db/schema";
import { ENV } from "../common/tokens";
import type { Env } from "../common/env";
import { InventoryService } from "../ledger/inventory.service";
import { ConnectionService } from "../shopify/connection.service";
import type { ShopifyVariant } from "../shopify/shopify.client";

export type StockDiff = {
  sku: string; variantId: string; productTitle: string;
  weft: number; channel: number | null; difference: number;
  /** Ada dorongan stok yang masih menunggu/sedang jalan: selisih ini mungkin sementara. */
  pendingPush: boolean;
  kind: "mismatch" | "missing_in_channel";
};

/** Milidetik sampai jam UTC `hour` berikutnya (selalu di masa depan). */
export function msUntilNext(hour: number, now: Date): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Reconciliation");
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(ConnectionService) private readonly connections: ConnectionService,
  ) {}

  onModuleInit() { if (this.env.RECON_AT_UTC_HOUR !== undefined) this.schedule(); }
  onModuleDestroy() { clearTimeout(this.timer); }

  private schedule() {
    this.timer = setTimeout(async () => {
      try { await this.runStock("nightly"); } catch (e) { this.log.error(e); }
      this.schedule();
    }, msUntilNext(this.env.RECON_AT_UTC_HOUR!, new Date()));
    this.timer.unref();
  }

  /** Bandingkan stok Shopify (di lokasi terhubung) dengan buku besar untuk semua varian terpetakan. */
  async runStock(trigger: string) {
    const { row, client } = await this.connections.shopify();
    const [r] = await this.db.insert(run).values({ kind: "reconcile.stock", trigger }).returning();
    try {
      const channel = new Map<string, ShopifyVariant>();
      for await (const v of client.variants(row.locationId!)) channel.set(v.variantId, v);
      const mapped = await this.db.select().from(skuMap).where(sql`${skuMap.channel} = 'shopify' and ${skuMap.state} = 'mapped'`);

      const diffs: StockDiff[] = [];
      let checked = 0; // yang benar-benar dibandingkan (varian tanpa pelacakan stok tidak dihitung)
      for (const m of mapped) {
        const sku = m.weftSku!;
        const weft = await this.inventory.stock(sku);
        const v = channel.get(m.channelVariantId);
        if (!v) { diffs.push({ sku, variantId: m.channelVariantId, productTitle: m.productTitle, weft, channel: null, difference: 0, pendingPush: false, kind: "missing_in_channel" }); continue; }
        if (!v.tracked || v.available === null) continue; // Shopify tidak melacak stok varian ini
        checked++;
        if (v.available !== weft) diffs.push({ sku, variantId: m.channelVariantId, productTitle: m.productTitle, weft, channel: v.available, difference: v.available - weft, pendingPush: false, kind: "mismatch" });
      }
      if (diffs.length) {
        const pend = await this.db.select({ payload: outbox.payload }).from(outbox)
          .where(sql`${outbox.topic} = 'stock.push' and ${outbox.status} in ('pending','processing')`);
        const inFlight = new Set(pend.map((p) => (p.payload as { sku: string }).sku));
        for (const d of diffs) d.pendingPush = inFlight.has(d.sku);
      }
      const summary = { checked, mismatches: diffs.filter((d) => d.kind === "mismatch").length, missingInChannel: diffs.filter((d) => d.kind === "missing_in_channel").length };
      const [report] = await this.db.insert(reconciliationReport).values({ kind: "stock", runId: r.id, diffs, summary }).returning();
      await this.db.update(run).set({ status: "done", finishedAt: new Date(), stats: summary }).where(eq(run.id, r.id));
      return { runId: r.id, reportId: report.id, summary, diffs };
    } catch (e) {
      await this.db.update(run).set({ status: "failed", finishedAt: new Date(), stats: { error: e instanceof Error ? e.message : String(e) } }).where(eq(run.id, r.id));
      throw e;
    }
  }

  list() { return this.db.select().from(reconciliationReport).orderBy(desc(reconciliationReport.generatedAt)).limit(50); }

  async get(id: string) {
    const [x] = await this.db.select().from(reconciliationReport).where(eq(reconciliationReport.id, id));
    if (!x) throw new NotFoundException("Report not found");
    return x;
  }

  /**
   * "Set ulang dari Weft": run baru (anak dari run laporan) yang mengantrekan dorongan stok absolut untuk
   * SKU yang bedanya masih ada. Weft adalah sumber kebenaran, jadi hanya sisi kanal yang ditulis ulang.
   */
  async fix(reportId: string, only?: string[], actor = "system") {
    const report = await this.get(reportId);
    if (report.kind !== "stock") throw new NotFoundException("Only stock reports can be fixed this way");
    const all = (report.diffs as StockDiff[]).filter((d) => d.kind === "mismatch");
    const targets = only?.length ? all.filter((d) => only.includes(d.sku)) : all;
    const [r] = await this.db.insert(run).values({ kind: "reconcile.fix", trigger: actor, parentId: report.runId }).returning();
    await this.db.transaction(async (tx) => { for (const d of targets) await this.inventory.enqueueStockPush(tx, d.sku); });
    const stats = { queued: targets.length, skus: targets.map((d) => d.sku) };
    await this.db.update(run).set({ status: "done", finishedAt: new Date(), stats }).where(eq(run.id, r.id));
    return { runId: r.id, ...stats };
  }
}
