import { HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { asc, desc, eq, sql } from "drizzle-orm";
import { DB, type Db } from "../db/db";
import { conversation, evalCase, message } from "../db/schema";
import { AssistantPipeline, DISCLOSURE, type Turn } from "./pipeline";
import { RateLimiter } from "./rate-limiter";

export const MAX_MESSAGE_CHARS = 500;
export const MAX_VISITOR_MESSAGES = 30;
const WAITING = "A person has this conversation and will reply by email. Is there anything else I can look up for you in the meantime?";
const TAKEN = "A person has taken over this conversation. They will reply to you directly.";

@Injectable()
export class AssistantService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AssistantPipeline) private readonly pipeline: AssistantPipeline,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  /** Satu giliran percakapan publik. Pengungkapan AI dibuat server di awal, bukan oleh model. */
  async chat(input: { conversationId?: string; message: string; region?: string; ip: string }) {
    const text = input.message.trim();
    if (!text) throw new HttpException("Message is empty", 400);
    if (text.length > MAX_MESSAGE_CHARS) throw new HttpException(`Message is too long (max ${MAX_MESSAGE_CHARS} characters)`, 400);
    this.limiter.hit(`ip:${input.ip}`, 20, 10 * 60_000);

    let conv: typeof conversation.$inferSelect | undefined;
    let disclosure: string | undefined;
    if (input.conversationId) {
      [conv] = await this.db.select().from(conversation).where(eq(conversation.id, input.conversationId));
      if (!conv) throw new NotFoundException("Conversation not found");
    } else {
      [conv] = await this.db.insert(conversation).values({ anonId: `anon-${Math.random().toString(36).slice(2, 10)}`, region: input.region ?? "UK" }).returning();
      await this.db.insert(message).values({ conversationId: conv.id, role: "assistant", text: DISCLOSURE, outcome: "disclosure" });
      disclosure = DISCLOSURE;
    }
    this.limiter.hit(`conv:${conv.id}`, MAX_VISITOR_MESSAGES, 60 * 60_000);

    await this.db.insert(message).values({ conversationId: conv.id, role: "visitor", text });
    let turn: Pick<Turn, "text" | "outcome" | "toolCalls" | "sources"> & Partial<Turn>;
    if (conv.handoffState !== "none") {
      turn = { text: conv.handoffState === "taken" ? TAKEN : WAITING, outcome: "handoff", toolCalls: [], sources: [] };
    } else {
      turn = await this.pipeline.respond(text, input.region ?? conv.region ?? "UK");
      if (turn.outcome === "handoff") {
        const summary = `Visitor asked: "${text.slice(0, 200)}". Reason: ${turn.handoffReason ?? "needs a person"}.`;
        await this.db.update(conversation).set({ handoffState: "requested", handoffSummary: summary }).where(eq(conversation.id, conv.id));
      }
    }
    const [reply] = await this.db.insert(message).values({
      conversationId: conv.id, role: "assistant", text: turn.text, outcome: turn.outcome,
      toolCalls: turn.toolCalls.length ? turn.toolCalls : null, sources: turn.sources.length ? turn.sources : null,
    }).returning();
    await this.db.update(conversation).set({ lastMessageAt: new Date() }).where(eq(conversation.id, conv.id));
    return {
      conversationId: conv.id, disclosure,
      reply: { id: reply.id, text: reply.text, outcome: turn.outcome, sources: turn.sources.map((s) => ({ title: s.title, kind: s.kind })) },
    };
  }

  /** Daftar percakapan untuk Support: status dijawab AI / dialihkan / ditandai. */
  async list() {
    return this.db.select({
      id: conversation.id, createdAt: conversation.createdAt, lastMessageAt: conversation.lastMessageAt, handoffState: conversation.handoffState, handoffSummary: conversation.handoffSummary,
      first: sql<string | null>`(select text from hub.message m where m.conversation_id = hub.conversation.id and m.role = 'visitor' order by m.created_at limit 1)`,
      messages: sql<number>`(select count(*)::int from hub.message m where m.conversation_id = hub.conversation.id and m.role = 'visitor')`,
      flagged: sql<number>`(select count(*)::int from hub.message m where m.conversation_id = hub.conversation.id and m.flagged)`,
    }).from(conversation).orderBy(desc(conversation.lastMessageAt)).limit(100);
  }

  async get(id: string) {
    const [conv] = await this.db.select().from(conversation).where(eq(conversation.id, id));
    if (!conv) throw new NotFoundException("Conversation not found");
    const messages = await this.db.select().from(message).where(eq(message.conversationId, id)).orderBy(asc(message.createdAt));
    return { ...conv, messages };
  }

  async takeover(id: string) {
    const r = await this.db.update(conversation).set({ handoffState: "taken" }).where(eq(conversation.id, id)).returning({ id: conversation.id });
    if (!r.length) throw new NotFoundException("Conversation not found");
    return { handoffState: "taken" };
  }

  /** "Tandai salah": pertanyaan visitor jadi kasus evaluasi, agar kesalahan yang sama tak terulang diam-diam. */
  async flag(messageId: string, category: string, facts: string[]) {
    const [m] = await this.db.select().from(message).where(eq(message.id, messageId));
    if (!m || m.role !== "assistant") throw new NotFoundException("Assistant message not found");
    const [q] = await this.db.select().from(message).where(sql`${message.conversationId} = ${m.conversationId} and ${message.role} = 'visitor' and ${message.createdAt} <= ${m.createdAt}`).orderBy(desc(message.createdAt)).limit(1);
    await this.db.update(message).set({ flagged: true }).where(eq(message.id, messageId));
    const key = `flagged-${messageId.slice(0, 8)}`;
    await this.db.insert(evalCase).values({ key, question: q?.text ?? "", category, expect: { facts }, source: "flagged" }).onConflictDoNothing();
    return { caseKey: key };
  }
}
