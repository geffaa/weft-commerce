import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "../auth/auth.service";
import { Roles, RolesGuard, type AuthedRequest } from "../auth/roles.guard";
import { ConnectionService, publicConnection } from "./connection.service";
import { ImportService } from "./import.service";

const createSchema = z.object({ shop: z.string(), clientId: z.string().min(1), clientSecret: z.string().min(1), locationName: z.string().optional() });
const webhookSchema = z.object({ publicUrl: z.string().url().refine((u) => u.startsWith("https://"), "must be https") });

@Controller()
@UseGuards(RolesGuard)
export class ConnectionsController {
  constructor(
    @Inject(ConnectionService) private readonly connections: ConnectionService,
    @Inject(ImportService) private readonly imports: ImportService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Post("connections") @Roles("ops")
  async create(@Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("shop, clientId and clientSecret are required");
    const { row, shopName } = await this.connections.create(parsed.data);
    await this.auth.audit(req.session!.email, "connection.save", row.shop, { kind: row.kind, scopes: row.scopes });
    return { ...publicConnection(row), shopName };
  }

  @Get("connections") @Roles("ops")
  async list() { return (await this.connections.list()).map(publicConnection); }

  @Post("connections/:id/test") @HttpCode(200) @Roles("ops")
  test(@Param("id") id: string) { return this.connections.test(id); }

  @Post("connections/:id/import") @HttpCode(200) @Roles("ops")
  async import(@Param("id") id: string, @Req() req: AuthedRequest) {
    const r = await this.imports.run(id, req.session!.email);
    await this.auth.audit(req.session!.email, "connection.import", id, r);
    return r;
  }

  @Post("connections/:id/webhooks") @HttpCode(200) @Roles("ops")
  async webhooks(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const p = webhookSchema.safeParse(body);
    if (!p.success) throw new BadRequestException("publicUrl must be an https URL");
    const r = await this.connections.registerWebhooks(id, p.data.publicUrl);
    await this.auth.audit(req.session!.email, "connection.webhooks", id, r);
    return r;
  }

  @Get("sku-map") @Roles("ops", "finance")
  skuMap(@Query("state") state?: string) { return this.imports.list(state); }
}
