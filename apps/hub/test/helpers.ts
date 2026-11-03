import "reflect-metadata";
import { createHmac } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { appModule } from "../src/app.module";
import { DB, type Db } from "../src/db/db";
import { loadEnv } from "../src/common/env";
import { InventoryService } from "../src/ledger/inventory.service";
import { LedgerService } from "../src/ledger/ledger.service";
import { OutboxWorker, HANDLERS, type Handler } from "../src/outbox/outbox.worker";
import { AuthService } from "../src/auth/auth.service";
import type { Role } from "../src/db/schema";

const envSrc = {
  DATABASE_URL_HUB: process.env.DATABASE_URL_HUB_TEST ?? "postgres://weft:weft@localhost:54330/hub_test",
  SHOPIFY_WEBHOOK_SECRET: "shop-secret",
  MEDUSA_WEBHOOK_SECRET: "medusa-secret",
  OUTBOX_POLL_MS: "0",
};
export const env = loadEnv(envSrc as NodeJS.ProcessEnv);

export async function boot(extra: Partial<NodeJS.ProcessEnv> = {}) {
  const e = Object.keys(extra).length ? loadEnv({ ...envSrc, ...extra } as NodeJS.ProcessEnv) : env;
  const app: INestApplication = await NestFactory.create(appModule(e), { rawBody: true, logger: false });
  await app.init();
  return {
    app, db: app.get<Db>(DB), inventory: app.get(InventoryService), ledger: app.get(LedgerService),
    worker: app.get(OutboxWorker), handlers: app.get<Record<string, Handler>>(HANDLERS),
  };
}

export async function reset(db: Db) {
  await db.execute(sql`truncate hub.ledger_line, hub.ledger_order, hub.inventory_entry, hub.outbox, hub.webhook_receipt, hub.exception_item, hub.run, hub.sku, hub.sku_map, hub.connection, hub.member, hub.audit_log, hub.reconciliation_report cascade`);
}

export const shopifySig = (raw: string) => createHmac("sha256", env.SHOPIFY_WEBHOOK_SECRET).update(raw).digest("base64");
export const medusaSig = (raw: string) => createHmac("sha256", env.MEDUSA_WEBHOOK_SECRET).update(raw).digest("hex");

export const shopifyOrder = (id: number, sku: string, quantity: number) => ({
  id, currency: "GBP", total_price: (24.9 * quantity).toFixed(2),
  line_items: [{ sku, quantity, price: "24.90" }],
});

export const PASSWORD = "correct horse battery";
/** Buat anggota berperan tertentu lalu login lewat service; kembalikan header Authorization. */
export async function asRole(ctx: { app: INestApplication }, role: Role, email = `${role}@example.com`) {
  const auth = ctx.app.get(AuthService);
  await auth.createMember(email, PASSWORD, role, "test");
  const r = await auth.login(email, PASSWORD);
  return { authorization: `Bearer ${r.token}` };
}
