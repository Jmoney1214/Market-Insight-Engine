// Storage sinks.
//   JSON  = always-on source of truth.
//   Supabase = opt-in (--db). An ISOLATED `router_scan` table (CREATE IF NOT EXISTS,
//   upsert) — deliberately NOT wired into the Drizzle migrations so it can't disturb
//   the existing findesk schema. pg is resolved from lib/db (pnpm isolates it there).
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const DIR = fileURLToPath(new URL("./scans/", import.meta.url));

export function writeScan(scan) {
  mkdirSync(DIR, { recursive: true });
  const f = `${DIR}router-${scan.date}.json`;
  writeFileSync(f, JSON.stringify(scan, null, 2));
  return f;
}

const DDL = `CREATE TABLE IF NOT EXISTS router_scan (
  scan_date       date              NOT NULL,
  symbol          text              NOT NULL,
  strategy        text              NOT NULL,
  code            integer           NOT NULL,
  status          text              NOT NULL,
  signal          text,
  reason          text,
  pct_vs_20d_high double precision,
  adx             double precision,
  atr_pct         double precision,
  dollar_vol_m    double precision,
  pm_lane         text,
  pm_gap_pct      double precision,
  pm_status       text,
  metrics         jsonb,
  updated_at      timestamptz       NOT NULL DEFAULT now(),
  PRIMARY KEY (scan_date, symbol)
);
ALTER TABLE router_scan ADD COLUMN IF NOT EXISTS pm_lane text;
ALTER TABLE router_scan ADD COLUMN IF NOT EXISTS pm_gap_pct double precision;
ALTER TABLE router_scan ADD COLUMN IF NOT EXISTS pm_status text;`;

export async function pushSupabase(scan) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const require = createRequire(new URL("../../lib/db/package.json", import.meta.url));
  const { Pool } = require("pg");
  // Match lib/db/src/index.ts — same Supabase pooler, same plain connectionString,
  // no ssl override. `rejectUnauthorized: false` disabled cert validation (MITM risk).
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(DDL);
    const ok = scan.rows.filter((r) => !r.error);
    const errRows = scan.rows.filter((r) => r.error);
    if (errRows.length)
      console.error(`pushSupabase: ${errRows.length} error row(s) (missing from the swing board) persisted as strategy=Error: ${errRows.map((r) => r.sym).join(", ")}`);
    const allRows = [...ok, ...errRows];
    if (!allRows.length) return 0;
    const cols = ["scan_date", "symbol", "strategy", "code", "status", "signal", "reason",
      "pct_vs_20d_high", "adx", "atr_pct", "dollar_vol_m", "pm_lane", "pm_gap_pct", "pm_status", "metrics"];
    const params = [], tuples = [];
    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i], b = i * cols.length;
      if (r.error) {
        params.push(scan.date, r.sym, "Error", -1, "ERROR", null, r.error,
          null, null, null, null, null, null, null, null);
      } else {
        const m = r.metrics, pm = r.premarket;
        params.push(scan.date, r.sym, r.strategy, r.code, r.status, r.signal, r.reason,
          m.pctVs20dHigh, m.adx, m.atrPct, m.dollarVolM,
          pm?.lane ?? null, pm?.gapPct ?? null, pm?.status ?? null, JSON.stringify(m));
      }
      tuples.push(`(${cols.map((_, k) => `$${b + k + 1}`).join(",")})`);
    }
    const upd = cols.slice(2).map((c) => `${c}=EXCLUDED.${c}`).join(", ");
    await pool.query(
      `INSERT INTO router_scan (${cols.join(",")}) VALUES ${tuples.join(",")}
       ON CONFLICT (scan_date, symbol) DO UPDATE SET ${upd}, updated_at=now()`,
      params,
    );
    return allRows.length;
  } finally {
    await pool.end();
  }
}
