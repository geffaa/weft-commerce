import type { Request } from "express";
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, UseGuards, ConflictException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { DB, type Db } from "../db/db";
import { member, ROLES } from "../db/schema";
import { AuthService } from "./auth.service";
import { RateLimiter } from "../assistant/rate-limiter";
import { ENV } from "../common/tokens";
import type { Env } from "../common/env";
import { Roles, RolesGuard, type AuthedRequest } from "./roles.guard";

const login = z.object({ email: z.string().email(), password: z.string().min(1) });
const create = z.object({ email: z.string().email(), password: z.string().min(12), role: z.enum(ROLES) });
const patch = z.object({ role: z.enum(ROLES) });
const pub = ({ passwordHash: _p, ...m }: typeof member.$inferSelect) => m;

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DB) private readonly db: Db,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post("auth/login") @HttpCode(200)
  login(@Body() body: unknown, @Req() req: Request) {
    const p = login.safeParse(body);
    if (!p.success) throw new BadRequestException("email and password are required");
    // Batas tebakan sandi: per IP dan per email (menahan serangan dari satu IP maupun terhadap satu akun).
    this.limiter.hit(`login-ip:${req.ip}`, this.env.LOGIN_MAX_PER_IP, 15 * 60_000);
    this.limiter.hit(`login-email:${p.data.email.toLowerCase()}`, this.env.LOGIN_MAX_PER_EMAIL, 15 * 60_000);
    return this.auth.login(p.data.email, p.data.password);
  }

  @Get("auth/me") @UseGuards(RolesGuard)
  me(@Req() req: AuthedRequest) { return req.session; }

  @Get("members") @UseGuards(RolesGuard) @Roles()
  async members() { return (await this.db.select().from(member)).map(pub); }

  @Post("members") @UseGuards(RolesGuard) @Roles()
  async createMember(@Body() body: unknown, @Req() req: AuthedRequest) {
    const p = create.safeParse(body);
    if (!p.success) throw new BadRequestException("email, role and a password of at least 12 characters are required");
    try { return pub(await this.auth.createMember(p.data.email, p.data.password, p.data.role, req.session!.email)); }
    catch (e) { if ((e as { cause?: { code?: string } }).cause?.code === "23505") throw new ConflictException("Member already exists"); throw e; }
  }

  @Patch("members/:id") @UseGuards(RolesGuard) @Roles()
  async setRole(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const p = patch.safeParse(body);
    if (!p.success) throw new BadRequestException("role must be one of " + ROLES.join(", "));
    const [before] = await this.db.select().from(member).where(eq(member.id, id));
    if (!before) throw new BadRequestException("Member not found");
    if (before.role === "owner" && p.data.role !== "owner") {
      const owners = (await this.db.select().from(member).where(eq(member.role, "owner"))).length;
      if (owners <= 1) throw new ConflictException("Cannot demote the last owner");
    }
    const [row] = await this.db.update(member).set({ role: p.data.role }).where(eq(member.id, id)).returning();
    await this.auth.audit(req.session!.email, "member.role", row.email, { from: before.role, to: row.role });
    return pub(row);
  }
}
