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
  metrics         jsonb,
  updated_at      timestamptz       NOT NULL DEFAULT now(),
  PRIMARY KEY (scan_date, symbol)
);`;

export async function pushSupabase(scan) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const require = createRequire(new URL("../../lib/db/package.json", import.meta.url));
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(DDL);
    const rows = scan.rows.filter((r) => !r.error);
    if (!rows.length) return 0;
    const cols = ["scan_date", "symbol", "strategy", "code", "status", "signal", "reason",
      "pct_vs_20d_high", "adx", "atr_pct", "dollar_vol_m", "metrics"];
    const params = [], tuples = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], m = r.metrics, b = i * cols.length;
      params.push(scan.date, r.sym, r.strategy, r.code, r.status, r.signal, r.reason,
        m.pctVs20dHigh, m.adx, m.atrPct, m.dollarVolM, JSON.stringify(m));
      tuples.push(`(${cols.map((_, k) => `$${b + k + 1}`).join(",")})`);
    }
    const upd = cols.slice(2).map((c) => `${c}=EXCLUDED.${c}`).join(", ");
    await pool.query(
      `INSERT INTO router_scan (${cols.join(",")}) VALUES ${tuples.join(",")}
       ON CONFLICT (scan_date, symbol) DO UPDATE SET ${upd}, updated_at=now()`,
      params,
    );
    return rows.length;
  } finally {
    await pool.end();
  }
}
