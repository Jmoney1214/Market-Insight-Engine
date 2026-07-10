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
  // Safety: these tables are written by OTHER systems (the findings/analysis agents and the
  // quant-research run logger) and are intentionally NOT modeled in Drizzle. Without this filter,
  // `drizzle-kit push --force` treats them as "not in schema" and DROPS them. Exclude them so a
  // push can never destroy live data it doesn't own.
  tablesFilter: ["!agent_findings", "!finding_grades", "!research_runs"],
});
