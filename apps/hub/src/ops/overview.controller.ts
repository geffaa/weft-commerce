import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { desc, eq, sql } from "drizzle-orm";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { DB, type Db } from "../db/db";
import { connection, exceptionItem, ledgerOrder, outbox, reconciliationReport, run, skuMap } from "../db/schema";

const BUCKET_MS = 30 * 60 * 1000;
export type Tick = "ok" | "warn" | "bad" | "";

@Controller()
@UseGuards(RolesGuard)
export class OverviewController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Satu panggilan untuk halaman Overview: status tiap jalur, hitungan, dan pita 24 jam (48 x 30 menit). */
  @Get("overview")
  async overview() {
    const now = Date.now();
    const start = Math.floor(now / BUCKET_MS) * BUCKET_MS - 47 * BUCKET_MS;
    const since = new Date(start);
    const [runs, excs, retried, conns, openEx, lastStock, lastXero, unmapped] = await Promise.all([
      this.db.select({ at: run.startedAt, status: run.status, kind: run.kind }).from(run).where(sql`${run.startedAt} >= ${since}`),
      this.db.select({ at: exceptionItem.createdAt }).from(exceptionItem).where(sql`${exceptionItem.createdAt} >= ${since}`),
      this.db.select({ at: outbox.createdAt }).from(outbox).where(sql`${outbox.createdAt} >= ${since} and ${outbox.status} = 'done' and ${outbox.attempts} > 1`),
      this.db.select().from(connection),
      this.db.select({ n: sql<number>`count(*)::int`, cls: exceptionItem.errorClass, topic: sql<string | null>`${exceptionItem.payload}->>'topic'` }).from(exceptionItem).where(eq(exceptionItem.state, "open")).groupBy(exceptionItem.errorClass, sql`${exceptionItem.payload}->>'topic'`),
      this.db.select().from(reconciliationReport).where(eq(reconciliationReport.kind, "stock")).orderBy(desc(reconciliationReport.generatedAt)).limit(1),
      this.db.select().from(reconciliationReport).where(eq(reconciliationReport.kind, "xero")).orderBy(desc(reconciliationReport.generatedAt)).limit(1),
      this.db.select({ n: sql<number>`count(*)::int` }).from(skuMap).where(sql`${skuMap.state} <> 'mapped'`),
    ]);

    const tape: Tick[] = Array.from({ length: 48 }, () => "");
    const idx = (d: Date) => Math.floor((d.getTime() - start) / BUCKET_MS);
    const mark = (d: Date, t: Tick) => { const i = idx(d); if (i < 0 || i > 47) return; const rank = { "": 0, ok: 1, warn: 2, bad: 3 } as const; if (rank[t] > rank[tape[i]]) tape[i] = t; };
    for (const r of runs) mark(r.at, r.status === "failed" ? "bad" : "ok");
    for (const r of retried) mark(r.at, "warn");
    for (const e of excs) mark(e.at, "bad");

    const lanes = (kind: string, topics: string[]) => {
      const c = conns.find((x) => x.kind === kind);
      const open = openEx.filter((e) => (e.topic ? topics.includes(e.topic) : false)).reduce((n, e) => n + e.n, 0);
      return c
        ? { kind, connected: true, name: c.shop, env: c.env, status: c.status, lastCheckedAt: c.lastCheckedAt, openExceptions: open }
        : { kind, connected: false, name: null, env: null, status: "none", lastCheckedAt: null, openExceptions: open };
    };
    return {
      env: conns.some((c) => c.env === "live") ? "live" : "sandbox",
      lanes: [lanes("shopify", ["stock.push"]), lanes("xero", ["xero.invoice"])],
      openExceptions: openEx.reduce((n, e) => n + e.n, 0),
      stock: lastStock[0] ? { reportId: lastStock[0].id, at: lastStock[0].generatedAt, ...(lastStock[0].summary as object) } : null,
      xero: lastXero[0] ? { reportId: lastXero[0].id, at: lastXero[0].generatedAt, ...(lastXero[0].summary as object) } : null,
      unmappedSkus: unmapped[0].n,
      tape,
    };
  }

  @Get("orders") @Roles("ops", "finance")
  async orders(@Query("limit") limit = "100") {
    const n = Math.min(500, Math.max(1, Number(limit) || 100));
    const rows = await this.db.select({
      id: ledgerOrder.id, source: ledgerOrder.source, sourceRef: ledgerOrder.sourceRef, currency: ledgerOrder.currency,
      totalMinor: ledgerOrder.totalMinor, status: ledgerOrder.status, paidAt: ledgerOrder.paidAt, createdAt: ledgerOrder.createdAt,
      customerEmail: ledgerOrder.customerEmail, xeroInvoiceId: ledgerOrder.xeroInvoiceId,
      // Kualifikasi eksplisit: Drizzle merender kolom tanpa nama tabel di subquery, sehingga `id` salah tertaut.
      lines: sql<number>`(select count(*)::int from hub.ledger_line l where l.order_id = hub.ledger_order.id)`,
    }).from(ledgerOrder).orderBy(desc(ledgerOrder.createdAt)).limit(n);
    return rows;
  }
}
