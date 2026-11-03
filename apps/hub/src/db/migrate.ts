import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./db";
import { loadEnv } from "../common/env";

export async function runMigrations(url = loadEnv().DATABASE_URL_HUB) {
  const { db, pool } = createDb(url);
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  await pool.end();
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations().then(() => console.log("hub migrations applied"));
}
