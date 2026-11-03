import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DB, type Db } from "../db/db";
import { exceptionItem, outbox } from "../db/schema";
import { ChannelError } from "./errors";
import { ENV } from "../common/tokens";
import type { Env } from "../common/env";

export type OutboxJob = { id: string; topic: string; payload: unknown; idempotencyKey: string; attempts: number };
export type Handler = (job: OutboxJob) => Promise<void>;
export const HANDLERS = Symbol("OUTBOX_HANDLERS");

export type WorkerOptions = { maxAttempts: number; baseMs: number; capMs: number; leaseMs: number; random: () => number };
const DEFAULTS: WorkerOptions = { maxAttempts: 5, baseMs: 2_000, capMs: 300_000, leaseMs: 60_000, random: Math.random };

/** Backoff eksponensial dengan full jitter: acak antara 0 dan min(cap, base * 2^(attempt-1)). */
export function backoffMs(attempt: number, o: Pick<WorkerOptions, "baseMs" | "capMs" | "random">) {
  return Math.floor(o.random() * Math.min(o.capMs, o.baseMs * 2 ** (attempt - 1)));
}

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Outbox");
  private timer?: NodeJS.Timeout;
  opts: WorkerOptions = { ...DEFAULTS };

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HANDLERS) private readonly handlers: Record<string, Handler>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (this.env.OUTBOX_POLL_MS > 0) {
      this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(e)), this.env.OUTBOX_POLL_MS);
    }
  }
  onModuleDestroy() { clearInterval(this.timer); }

  /** Klaim sampai `limit` tugas jatuh tempo (atau lease kedaluwarsa) tanpa saling menunggu antar worker. */
  async claim(now: Date, limit: number): Promise<OutboxJob[]> {
    const lease = new Date(now.getTime() + this.opts.leaseMs);
    const res = await this.db.execute<OutboxJob>(sql`
      update hub.outbox set status = 'processing', locked_until = ${lease}, attempts = attempts + 1
      where id in (
        select id from hub.outbox
        where (status = 'pending' and next_attempt_at <= ${now}) or (status = 'processing' and locked_until < ${now})
        order by next_attempt_at limit ${limit} for update skip locked)
      returning id, topic, payload, idempotency_key as "idempotencyKey", attempts`);
    return res.rows;
  }

  async tick(now = new Date(), limit = 20): Promise<{ done: number; retried: number; dead: number }> {
    const jobs = await this.claim(now, limit);
    const out = { done: 0, retried: 0, dead: 0 };
    await Promise.all(jobs.map(async (job) => {
      try {
        const h = this.handlers[job.topic];
        if (!h) throw new ChannelError(`No handler for topic ${job.topic}`, "validation");
        await h(job);
        await this.db.update(outbox).set({ status: "done", lockedUntil: null, lastError: null }).where(eq(outbox.id, job.id));
        out.done++;
      } catch (e) {
        out[await this.fail(job, e, now)]++;
      }
    }));
    return out;
  }

  private async fail(job: OutboxJob, e: unknown, now: Date): Promise<"retried" | "dead"> {
    const err = e instanceof ChannelError ? e : new ChannelError(e instanceof Error ? e.message : String(e), "transient");
    if (err.permanent || job.attempts >= this.opts.maxAttempts) {
      await this.db.transaction(async (tx) => {
        await tx.update(outbox).set({ status: "dead", lockedUntil: null, lastError: err.message }).where(eq(outbox.id, job.id));
        await tx.insert(exceptionItem).values({
          errorClass: err.errorClass, message: err.message,
          payload: { topic: job.topic, idempotencyKey: job.idempotencyKey, attempts: job.attempts, payload: job.payload },
        });
      });
      return "dead";
    }
    const wait = Math.max(backoffMs(job.attempts, this.opts), err.retryAfterMs ?? 0);
    try {
      await this.db.update(outbox)
        .set({ status: "pending", lockedUntil: null, lastError: err.message, nextAttemptAt: new Date(now.getTime() + wait) })
        .where(eq(outbox.id, job.id));
    } catch (e2) {
      // Sudah ada tugas pending baru untuk kunci yang sama: nilai terbarunya yang akan dikirim.
      if ((e2 as { code?: string; cause?: { code?: string } }).code === "23505" || (e2 as { cause?: { code?: string } }).cause?.code === "23505") {
        await this.db.update(outbox).set({ status: "superseded", lockedUntil: null, lastError: err.message })
          .where(and(eq(outbox.id, job.id), eq(outbox.status, "processing")));
      } else throw e2;
    }
    return "retried";
  }
}
