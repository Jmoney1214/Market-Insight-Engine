import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Safety: these tables are (co-)written by OTHER systems — the findings/analysis agents and
  // the quant-research run logger. finding_grades is now MODELED in Drizzle for reads/writes
  // (unified judge + outcome grade ledger) but stays excluded from push OWNERSHIP alongside the
  // others: schema changes to them go through explicit Supabase migrations only, so a
  // `drizzle-kit push --force` can never drop or reshape live data it doesn't own.
  tablesFilter: ["!agent_findings", "!finding_grades", "!research_runs"],
});
