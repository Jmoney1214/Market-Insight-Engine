import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const databaseUrl = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(databaseUrl.hostname)) {
  throw new Error(
    "Drizzle push is local-only; governance and operations schemas are owned by Supabase SQL migrations",
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Supabase SQL migrations exclusively own all private application schemas.
  // Drizzle is restricted to public/local development and must never push private DDL.
  schemaFilter: ["public"],
  // Safety: these tables are written by OTHER systems (the findings/analysis agents and the
  // quant-research run logger) and are intentionally NOT modeled in Drizzle. Keep excluding them
  // until a live catalog audit explicitly adopts or renames the existing research_runs authority.
  tablesFilter: ["!agent_findings", "!finding_grades", "!research_runs"],
});
