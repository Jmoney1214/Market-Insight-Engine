/**
 * Loads the repo-root .env into process.env BEFORE any module that needs it
 * (lib/db throws at import time without DATABASE_URL). Must stay the FIRST
 * import in index.ts.
 *
 * Rules: never overrides variables already set (production/Replit secrets
 * win), silently no-ops when no .env exists, zero dependencies.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function findRepoRootEnv(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".env");
    // pnpm-workspace.yaml marks the repo root; only trust .env sitting there.
    if (existsSync(join(dir, "pnpm-workspace.yaml")) && existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envPath = findRepoRootEnv(process.cwd());
if (envPath) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    if (process.env[key] !== undefined) continue; // real env always wins
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
