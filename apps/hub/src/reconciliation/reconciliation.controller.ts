import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "../auth/auth.service";
import { Roles, RolesGuard, type AuthedRequest } from "../auth/roles.guard";
import { ReconciliationService } from "./reconciliation.service";

const fixBody = z.object({ skus: z.array(z.string()).optional() }).default({});

@Controller("reconciliation")
@UseGuards(RolesGuard)
export class ReconciliationController {
  constructor(
    @Inject(ReconciliationService) private readonly recon: ReconciliationService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get() @Roles("ops", "finance")
  list() { return this.recon.list(); }

  @Get(":id") @Roles("ops", "finance")
  one(@Param("id") id: string) { return this.recon.get(id); }

  @Post("run") @HttpCode(200) @Roles("ops")
  async run(@Req() req: AuthedRequest) {
    const r = await this.recon.runStock(req.session!.email);
    await this.auth.audit(req.session!.email, "reconciliation.run", r.reportId, r.summary);
    return r;
  }

  @Post(":id/fix") @HttpCode(200) @Roles("ops")
  async fix(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const p = fixBody.safeParse(body ?? {});
    if (!p.success) throw new BadRequestException("skus must be an array of strings");
    const r = await this.recon.fix(id, p.data.skus, req.session!.email);
    await this.auth.audit(req.session!.email, "reconciliation.fix", id, r);
    return r;
  }
}
