import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export const DB = Symbol("DB");

export function createDb(url: string) {
  const pool = new Pool({ connectionString: url, max: 20 });
  return { db: drizzle(pool, { schema }), pool };
}
