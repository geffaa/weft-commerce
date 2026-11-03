import { Inject, Injectable, UnprocessableEntityException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DB, type Db } from "../db/db";
import { connection } from "../db/schema";
import { ENV } from "../common/tokens";
import type { Env } from "../common/env";
import { decrypt, encrypt } from "../common/crypto";
import { ChannelError } from "../outbox/errors";
import { ShopifyClient, type ShopifyCreds } from "./shopify.client";

export const REQUIRED_SCOPES = ["read_products", "read_inventory", "write_inventory", "read_orders", "read_locations"];
export type ClientFactory = (c: ShopifyCreds) => Pick<ShopifyClient, "testConnection" | "locations" | "variants" | "setQuantity" | "ensureWebhook">;
export type ConnectionRow = typeof connection.$inferSelect;
export const publicConnection = ({ secretEnc: _s, ...rest }: ConnectionRow) => rest;

@Injectable()
export class ConnectionService {
  /** Dapat diganti (tes memakai tiruan). */
  factory: ClientFactory = (c) => new ShopifyClient(c);
  private readonly cache = new Map<string, ReturnType<ClientFactory>>();

  constructor(@Inject(DB) private readonly db: Db, @Inject(ENV) private readonly env: Env) {}

  /** Uji dulu, simpan hanya jika lolos: token yang salah atau kurang scope tidak pernah tersimpan. */
  async create(input: { shop: string; clientId: string; clientSecret: string; locationName?: string }) {
    const shop = input.shop.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new UnprocessableEntityException("shop must look like name.myshopify.com");
    const client = this.factory({ shop, clientId: input.clientId, clientSecret: input.clientSecret });
    let test;
    try { test = await client.testConnection(REQUIRED_SCOPES); }
    catch (e) {
      if (e instanceof ChannelError) throw new UnprocessableEntityException(e.message);
      throw e;
    }
    if (test.missing.length) throw new UnprocessableEntityException(`Missing scopes: ${test.missing.join(", ")}. Add them to the app version in the Dev Dashboard, release it, and reinstall.`);
    const locations = await client.locations();
    const loc = input.locationName ? locations.find((l) => l.name === input.locationName) : locations[0];
    if (!loc) throw new UnprocessableEntityException(`Location not found. Available: ${locations.map((l) => l.name).join(", ")}`);
    const values = {
      kind: "shopify", shop, clientId: input.clientId, secretEnc: encrypt(input.clientSecret, this.env.HUB_ENCRYPTION_KEY),
      secretHint: "…" + input.clientSecret.slice(-4), scopes: test.granted, locationId: loc.id, locationName: loc.name,
      status: "ok", lastCheckedAt: new Date(),
    };
    const [row] = await this.db.insert(connection).values(values)
      .onConflictDoUpdate({ target: [connection.kind, connection.shop], set: values }).returning();
    this.cache.delete(row.id);
    return { row, shopName: test.shopName };
  }

  list() { return this.db.select().from(connection); }

  async get(id: string) {
    const [row] = await this.db.select().from(connection).where(eq(connection.id, id));
    if (!row) throw new NotFoundException("Connection not found");
    return row;
  }

  clientFor(row: ConnectionRow) {
    let c = this.cache.get(row.id);
    if (!c) {
      c = this.factory({ shop: row.shop, clientId: row.clientId, clientSecret: decrypt(row.secretEnc, this.env.HUB_ENCRYPTION_KEY) });
      this.cache.set(row.id, c);
    }
    return c;
  }

  async test(id: string) {
    const row = await this.get(id);
    try {
      const t = await this.clientFor(row).testConnection(REQUIRED_SCOPES);
      const ok = t.missing.length === 0;
      await this.db.update(connection).set({ status: ok ? "ok" : "failing", scopes: t.granted, lastCheckedAt: new Date() }).where(eq(connection.id, id));
      return { ok, shopName: t.shopName, missing: t.missing };
    } catch (e) {
      await this.db.update(connection).set({ status: "failing", lastCheckedAt: new Date() }).where(eq(connection.id, id));
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async registerWebhooks(id: string, publicUrl: string) {
    const row = await this.get(id);
    const callback = publicUrl.replace(/\/+$/, "") + "/webhooks/shopify";
    try { return { topic: "orders/paid", callbackUrl: callback, result: await this.clientFor(row).ensureWebhook("ORDERS_PAID", callback) }; }
    catch (e) { if (e instanceof ChannelError) throw new UnprocessableEntityException(e.message); throw e; }
  }

  async shopify(): Promise<{ row: ConnectionRow; client: ReturnType<ClientFactory> }> {
    const [row] = await this.db.select().from(connection).where(eq(connection.kind, "shopify"));
    if (!row) throw new ChannelError("No Shopify connection is configured", "validation");
    return { row, client: this.clientFor(row) };
  }
}
