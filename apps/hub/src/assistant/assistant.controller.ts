import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AuthService } from "../auth/auth.service";
import { Roles, RolesGuard, type AuthedRequest } from "../auth/roles.guard";
import { EVAL_CATEGORIES } from "../db/schema";
import { AssistantService } from "./assistant.service";
import { EvalService } from "./eval.service";
import { KnowledgeService } from "./knowledge.service";

const chatBody = z.object({ conversationId: z.string().uuid().optional(), message: z.string(), region: z.enum(["UK", "US", "EU", "AU"]).optional() });
const evalBody = z.object({ set: z.enum(["main", "holdout"]).optional() }).default({});
const flagBody = z.object({ category: z.enum(EVAL_CATEGORIES), facts: z.array(z.string()).default([]) });

@Controller()
export class AssistantController {
  constructor(
    @Inject(AssistantService) private readonly assistant: AssistantService,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(EvalService) private readonly evals: EvalService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** Publik (widget storefront), dibatasi laju per IP dan per percakapan. */
  @Post("assistant/chat") @HttpCode(200)
  chat(@Body() body: unknown, @Req() req: Request) {
    const p = chatBody.safeParse(body);
    if (!p.success) throw new BadRequestException("message is required; region must be UK, US, EU or AU");
    return this.assistant.chat({ ...p.data, ip: req.ip ?? "unknown" });
  }

  @Get("assistant/conversations") @UseGuards(RolesGuard) @Roles("support", "ops")
  list() { return this.assistant.list(); }

  @Get("assistant/conversations/:id") @UseGuards(RolesGuard) @Roles("support", "ops")
  one(@Param("id") id: string) { return this.assistant.get(id); }

  @Post("assistant/conversations/:id/takeover") @HttpCode(200) @UseGuards(RolesGuard) @Roles("support", "ops")
  async takeover(@Param("id") id: string, @Req() req: AuthedRequest) {
    const r = await this.assistant.takeover(id);
    await this.auth.audit(req.session!.email, "assistant.takeover", id);
    return r;
  }

  @Post("assistant/messages/:id/flag") @HttpCode(200) @UseGuards(RolesGuard) @Roles("support", "ops")
  async flag(@Param("id") id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const p = flagBody.safeParse(body ?? {});
    if (!p.success) throw new BadRequestException("category must be one of " + EVAL_CATEGORIES.join(", "));
    const r = await this.assistant.flag(id, p.data.category, p.data.facts);
    await this.auth.audit(req.session!.email, "assistant.flag", id, r);
    return r;
  }

  @Get("knowledge/docs") @UseGuards(RolesGuard) @Roles()
  docs() { return this.knowledge.list(); }

  @Post("knowledge/reindex") @HttpCode(200) @UseGuards(RolesGuard) @Roles()
  async reindex(@Req() req: AuthedRequest) {
    const r = await this.knowledge.reindex();
    await this.auth.audit(req.session!.email, "knowledge.reindex", "all", r);
    return r;
  }

  @Post("evals/run") @HttpCode(200) @UseGuards(RolesGuard) @Roles()
  async runEvals(@Body() body: unknown, @Req() req: AuthedRequest) {
    const p = evalBody.safeParse(body ?? {});
    if (!p.success) throw new BadRequestException("set must be main or holdout");
    const r = await this.evals.start({ pacingMs: Number(process.env.EVAL_PACING_MS ?? 0) || undefined, set: p.data.set });
    await this.auth.audit(req.session!.email, "evals.run", r.runId, { set: p.data.set ?? "main" });
    return r;
  }

  @Get("evals/runs") @UseGuards(RolesGuard) @Roles()
  evalRuns() { return this.evals.runs(); }

  @Get("evals/runs/:id") @UseGuards(RolesGuard) @Roles()
  evalRun(@Param("id") id: string) { return this.evals.runDetail(id); }
}
