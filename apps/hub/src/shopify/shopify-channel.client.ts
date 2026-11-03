import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DB, type Db } from "../db/db";
import { skuMap } from "../db/schema";
import { ChannelError } from "../outbox/errors";
import type { ChannelClient } from "../channels/channel";
import { ConnectionService } from "./connection.service";

/** Jembatan worker outbox -> Shopify. SKU yang tak terpetakan adalah kesalahan permanen yang butuh orang. */
@Injectable()
export class ShopifyChannelClient implements ChannelClient {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ConnectionService) private readonly connections: ConnectionService,
  ) {}

  async setQuantity(sku: string, quantity: number, idempotencyKey: string) {
    const [m] = await this.db.select().from(skuMap)
      .where(and(eq(skuMap.channel, "shopify"), eq(skuMap.weftSku, sku), eq(skuMap.state, "mapped")));
    if (!m) throw new ChannelError(`SKU ${sku} is not mapped to a Shopify variant`, "validation");
    const { row, client } = await this.connections.shopify();
    await client.setQuantity(m.inventoryItemId, row.locationId!, quantity, idempotencyKey);
  }
}
