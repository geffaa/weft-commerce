// Menyiapkan database hub_e2e yang bersih, memigrasinya, lalu menjalankan hub di port 3101 untuk tes E2E.
import { spawn, spawnSync } from "node:child_process";
import pg from "pg";

const ADMIN = process.env.PG_ADMIN_URL ?? "postgres://weft:weft@localhost:54330/postgres";
const URL_E2E = "postgres://weft:weft@localhost:54330/hub_e2e";

const admin = new pg.Client({ connectionString: ADMIN });
await admin.connect();
await admin.query("DROP DATABASE IF EXISTS hub_e2e WITH (FORCE)");
await admin.query("CREATE DATABASE hub_e2e");
await admin.end();
const db = new pg.Client({ connectionString: URL_E2E });
await db.connect(); await db.query("CREATE EXTENSION IF NOT EXISTS vector"); await db.end();

const env = {
  ...process.env, DATABASE_URL_HUB: URL_E2E, PORT: "3101", OUTBOX_POLL_MS: "0",
  HUB_OWNER_EMAIL: "owner@example.com", HUB_OWNER_PASSWORD: "owner-password-123",
  HUB_JWT_SECRET: "e2e-jwt-secret-for-tests-only", HUB_JWT_TTL_SECONDS: "3600",
};
const m = spawnSync("pnpm", ["--filter", "@weft/hub", "db:migrate"], { env, stdio: "inherit" });
if (m.status !== 0) process.exit(m.status ?? 1);
const hub = spawn("pnpm", ["--filter", "@weft/hub", "start"], { env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { hub.kill(sig); process.exit(0); });
hub.on("exit", (c) => process.exit(c ?? 0));
