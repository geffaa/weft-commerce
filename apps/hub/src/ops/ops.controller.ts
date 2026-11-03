import { ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { AuthService } from "../auth/auth.service";
import { Roles, RolesGuard, type AuthedRequest } from "../auth/roles.guard";
import { DB, type Db } from "../db/db";
import { auditLog, exceptionItem, outbox, run } from "../db/schema";

@Controller()
@UseGuards(RolesGuard)
export class OpsController {
  constructor(@Inject(DB) private readonly db: Db, @Inject(AuthService) private readonly auth: AuthService) {}

  @Get("runs") @Roles("ops", "finance")
  runs() { return this.db.select().from(run).orderBy(desc(run.startedAt)).limit(100); }

  @Get("runs/:id") @Roles("ops", "finance")
  async runOne(@Param("id") id: string) {
    const [r] = await this.db.select().from(run).where(eq(run.id, id));
    if (!r) throw new NotFoundException();
    return r;
  }

  @Get("exceptions") @Roles("ops", "finance")
  exceptions(@Query("state") state = "open") {
    return this.db.select().from(exceptionItem).where(eq(exceptionItem.state, state)).orderBy(desc(exceptionItem.createdAt)).limit(200);
  }

  /** Coba lagi hanya untuk kegagalan kanal (ada topik outbox); keputusan stok perlu orang, bukan retry. */
  @Post("exceptions/:id/retry") @HttpCode(200) @Roles("ops")
  async retry(@Param("id") id: string, @Req() req: AuthedRequest) {
    const [ex] = await this.db.select().from(exceptionItem).where(eq(exceptionItem.id, id));
    if (!ex) throw new NotFoundException();
    const p = ex.payload as { topic?: string; payload?: unknown; idempotencyKey?: string } | null;
    if (ex.state !== "open" || !p?.topic) throw new ConflictException("Only open channel failures can be retried");
    await this.db.transaction(async (tx) => {
      await tx.insert(outbox).values({ topic: p.topic!, payload: p.payload ?? {}, idempotencyKey: p.idempotencyKey ?? `retry:${id}` })
        .onConflictDoNothing();
      await tx.update(exceptionItem).set({ state: "resolved", resolvedBy: req.session!.email }).where(eq(exceptionItem.id, id));
    });
    await this.auth.audit(req.session!.email, "exception.retry", id, { topic: p.topic });
    return { state: "resolved", requeued: p.topic };
  }

  @Post("exceptions/:id/ignore") @HttpCode(200) @Roles("ops")
  async ignore(@Param("id") id: string, @Req() req: AuthedRequest) {
    const r = await this.db.update(exceptionItem).set({ state: "ignored", resolvedBy: req.session!.email })
      .where(eq(exceptionItem.id, id)).returning({ id: exceptionItem.id });
    if (!r.length) throw new NotFoundException();
    await this.auth.audit(req.session!.email, "exception.ignore", id);
    return { state: "ignored" };
  }

  @Get("audit-log") @Roles()
  audit() { return this.db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(200); }
}
