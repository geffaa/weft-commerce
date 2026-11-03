import {
  BadRequestException, Body, Controller, Headers, HttpCode, Inject, Post, Req, UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { DB, type Db } from "../db/db";
import { webhookReceipt } from "../db/schema";
import { verifyHmac } from "../common/hmac";
import { ENV } from "../common/tokens";
import type { Env } from "../common/env";
import { LedgerService, type OrderInput } from "../ledger/ledger.service";
import { parseMedusaOrder, parseShopifyOrder } from "./parsers";

@Controller("webhooks")
export class WebhooksController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  @Post("shopify") @HttpCode(200)
  async shopify(
    @Req() req: RawBodyRequest<Request>, @Body() body: unknown,
    @Headers("x-shopify-hmac-sha256") sig?: string, @Headers("x-shopify-webhook-id") id?: string,
    @Headers("x-shopify-topic") topic?: string,
  ) {
    if (!verifyHmac(req.rawBody ?? Buffer.alloc(0), this.env.SHOPIFY_WEBHOOK_SECRET, sig, "base64")) throw new UnauthorizedException("Bad signature");
    if (topic !== "orders/paid") return { status: "ignored", topic };
    return this.receive("shopify", id, () => parseShopifyOrder(body));
  }

  @Post("medusa") @HttpCode(200)
  async medusa(
    @Req() req: RawBodyRequest<Request>, @Body() body: unknown,
    @Headers("x-weft-signature") sig?: string, @Headers("x-weft-event-id") id?: string,
  ) {
    if (!verifyHmac(req.rawBody ?? Buffer.alloc(0), this.env.MEDUSA_WEBHOOK_SECRET, sig, "hex")) throw new UnauthorizedException("Bad signature");
    return this.receive("medusa", id, () => parseMedusaOrder(body));
  }

  /** Receipt unik per (source, external_id). Bila pemrosesan gagal, receipt dibuang agar kiriman ulang diproses. */
  private async receive(source: string, externalId: string | undefined, parse: () => OrderInput) {
    if (!externalId) throw new BadRequestException("Missing webhook id");
    let input: OrderInput;
    try { input = parse(); } catch (e) {
      throw new BadRequestException(e instanceof ZodError ? "Invalid payload" : (e as Error).message);
    }
    const ins = await this.db.insert(webhookReceipt).values({ source, externalId }).onConflictDoNothing().returning();
    if (!ins.length) return { status: "duplicate" };
    try {
      const r = await this.ledger.ingestOrder(input);
      return { status: r.outcome };
    } catch (e) {
      await this.db.delete(webhookReceipt).where(and(eq(webhookReceipt.source, source), eq(webhookReceipt.externalId, externalId)));
      throw e;
    }
  }
}
