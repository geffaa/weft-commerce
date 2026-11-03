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
import { OpsController } from "./ops/ops.controller";
import { ConnectionService } from "./shopify/connection.service";
import { ConnectionsController } from "./shopify/connections.controller";
import { ImportService } from "./shopify/import.service";
import { ShopifyChannelClient } from "./shopify/shopify-channel.client";
import { stockPushHandler } from "./channels/stock-push.handler";
import { HANDLERS, OutboxWorker } from "./outbox/outbox.worker";
import { WebhooksController } from "./webhooks/webhooks.controller";

export function appModule(env: Env = loadEnv()) {
  const { db, pool } = createDb(env.DATABASE_URL_HUB);
  // Tutup pool saat aplikasi berhenti; tanpa ini tiap app.close() meninggalkan koneksi menggantung.
  class PoolCloser implements OnModuleDestroy { async onModuleDestroy() { await pool.end(); } }
  @Module({
    controllers: [WebhooksController, ConnectionsController, AuthController, OpsController],
    providers: [
      { provide: ENV, useValue: env },
      { provide: DB, useValue: db },
      PoolCloser,
      InventoryService,
      LedgerService,
      AuthService,
      RolesGuard,
      ConnectionService,
      ImportService,
      ShopifyChannelClient,
      { provide: CHANNEL, useExisting: ShopifyChannelClient },
      {
        provide: HANDLERS,
        inject: [InventoryService, CHANNEL],
        useFactory: (inv: InventoryService, ch: ShopifyChannelClient) => ({ "stock.push": stockPushHandler(inv, ch) }),
      },
      OutboxWorker,
    ],
    exports: [DB, InventoryService, LedgerService, OutboxWorker, CHANNEL, HANDLERS, ConnectionService, ImportService, AuthService],
  })
  class AppModule {}
  return AppModule;
}
