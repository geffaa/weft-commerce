import { Inject, Injectable, Logger, UnauthorizedException, type OnModuleInit } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { hash, verify } from "@node-rs/argon2";
import { SignJWT, jwtVerify } from "jose";
import { DB, type Db } from "../db/db";
import { auditLog, member, type Role } from "../db/schema";
import { ENV } from "../common/tokens";
import type { Env } from "../common/env";

export type Session = { sub: string; email: string; role: Role };

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger("Auth");
  // Hash nyata agar login untuk email tak dikenal memakan waktu sama (tidak membocorkan keberadaan akun).
  private dummy?: Promise<string>;
  constructor(@Inject(DB) private readonly db: Db, @Inject(ENV) private readonly env: Env) {}

  async onModuleInit() {
    const { HUB_OWNER_EMAIL: email, HUB_OWNER_PASSWORD: pw } = this.env;
    if (!email || !pw) return;
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(member);
    if (n > 0) return;
    await this.createMember(email, pw, "owner", "system");
    this.log.log(`Created first owner ${email}`);
  }

  private get key() { return new TextEncoder().encode(this.env.HUB_JWT_SECRET); }

  async createMember(email: string, password: string, role: Role, actor: string) {
    const [row] = await this.db.insert(member).values({ email: email.toLowerCase().trim(), passwordHash: await hash(password), role }).returning();
    await this.audit(actor, "member.create", row.email, { role });
    return row;
  }

  async login(email: string, password: string) {
    const [m] = await this.db.select().from(member).where(eq(member.email, email.toLowerCase().trim()));
    this.dummy ??= hash("not-a-real-password");
    const ok = await verify(m?.passwordHash ?? (await this.dummy), password).catch(() => false);
    if (!m || !ok) throw new UnauthorizedException("Invalid email or password");
    const token = await new SignJWT({ email: m.email, role: m.role })
      .setProtectedHeader({ alg: "HS256" }).setSubject(m.id).setIssuedAt()
      .setExpirationTime(`${this.env.HUB_JWT_TTL_SECONDS}s`).sign(this.key);
    return { token, expiresIn: this.env.HUB_JWT_TTL_SECONDS, member: { id: m.id, email: m.email, role: m.role } };
  }

  /** Peran dibaca ulang dari database, bukan dari token: pencabutan/ubah peran berlaku segera. */
  async verifyToken(token: string): Promise<Session> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      const [m] = await this.db.select().from(member).where(eq(member.id, String(payload.sub)));
      if (!m) throw new Error("member gone");
      return { sub: m.id, email: m.email, role: m.role as Role };
    } catch { throw new UnauthorizedException(); }
  }

  audit(actor: string, action: string, subject: string, meta?: unknown) {
    return this.db.insert(auditLog).values({ actor, action, subject, meta: meta ?? null });
  }
}
