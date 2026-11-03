import { Module, type OnModuleDestroy } from "@nestjs/common";
import { createDb, DB } from "./db/db";
import { loadEnv, type Env } from "./common/env";
import { ENV } from "./common/tokens";
import { InventoryService } from "./ledger/inventory.service";
import { LedgerService } from "./ledger/ledger.service";
import { CHANNEL } from "./channels/channel";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { RolesGuard } from "./auth/roles.guard";
import { ReconciliationController } from "./reconciliation/reconciliation.controller";
import { ReconciliationService } from "./reconciliation/reconciliation.service";
import { OpsController } from "./ops/ops.controller";
import { OverviewController } from "./ops/overview.controller";
import { ConnectionService } from "./shopify/connection.service";
import { ConnectionsController } from "./shopify/connections.controller";
import { ImportService } from "./shopify/import.service";
import { XeroService } from "./xero/xero.service";
import { ShopifyChannelClient } from "./shopify/shopify-channel.client";
import { stockPushHandler } from "./channels/stock-push.handler";
import { HANDLERS, OutboxWorker } from "./outbox/outbox.worker";
import { WebhooksController } from "./webhooks/webhooks.controller";

export function appModule(env: Env = loadEnv()) {
  const { db, pool } = createDb(env.DATABASE_URL_HUB);
  // Tutup pool saat aplikasi berhenti; tanpa ini tiap app.close() meninggalkan koneksi menggantung.
  class PoolCloser implements OnModuleDestroy { async onModuleDestroy() { await pool.end(); } }
  @Module({
    controllers: [WebhooksController, ConnectionsController, AuthController, OpsController, OverviewController, ReconciliationController],
    providers: [
      { provide: ENV, useValue: env },
      { provide: DB, useValue: db },
      PoolCloser,
      InventoryService,
      LedgerService,
      AuthService,
      RolesGuard,
      ConnectionService,
      ReconciliationService,
      XeroService,
      ImportService,
      ShopifyChannelClient,
      { provide: CHANNEL, useExisting: ShopifyChannelClient },
      {
        provide: HANDLERS,
        inject: [InventoryService, CHANNEL, XeroService],
        useFactory: (inv: InventoryService, ch: ShopifyChannelClient, xero: XeroService) => ({
          "stock.push": stockPushHandler(inv, ch),
          "xero.invoice": xero.handler(),
        }),
      },
      OutboxWorker,
    ],
    exports: [DB, InventoryService, LedgerService, OutboxWorker, CHANNEL, HANDLERS, ConnectionService, ImportService, AuthService, ReconciliationService, XeroService],
  })
  class AppModule {}
  return AppModule;
}
