import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["hub"],
  dbCredentials: { url: process.env.DATABASE_URL_HUB ?? "postgres://weft:weft@localhost:54330/hub" },
});
