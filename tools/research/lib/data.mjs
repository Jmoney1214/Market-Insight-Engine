// Data plane — HARD CONTRACT (see README):
//   Alpaca SIP  = the ONLY source of bars (daily + intraday), adjustment=split.
//   FMP         = screener / earnings calendar / enrichment ONLY. Never bars.
// All fetches cache to ./cache with a TTL; any partial multi-symbol fetch is a
// hard error — a backtest must never silently run on incomplete data.
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const AK = process.env.ALPACA_API_KEY_ID, AS = process.env.ALPACA_API_SECRET_KEY;
const FMP = process.env.FMP_API_KEY;
const AH = { "APCA-API-KEY-ID": AK, "APCA-API-SECRET-KEY": AS };
const CACHE = fileURLToPath(new URL("../cache/", import.meta.url));
mkdirSync(CACHE, { recursive: true });

export function requireCreds() {
  const missing = [
    !AK && "ALPACA_API_KEY_ID", !AS && "ALPACA_API_SECRET_KEY", !FMP && "FMP_API_KEY",
  ].filter(Boolean);
  if (missing.length) throw new Error(`missing env credentials: ${missing.join(", ")}`);
}

function cached(key, ttlHours, fetcher) {
  const f = `${CACHE}${key}.json`;
  if (existsSync(f)) {
    const ageH = (Date.now() - statSync(f).mtimeMs) / 3.6e6;
    if (ttlHours == null || ageH < ttlHours) return Promise.resolve(JSON.parse(readFileSync(f, "utf8")));
  }
  return Promise.resolve(fetcher()).then((v) => { writeFileSync(f, JSON.stringify(v)); return v; });
}

/** Universe for a backtest date. Preference order:
 *  1. TRUE as-of snapshot from the live app (survivorship-bias-free) when
 *     UNIVERSE_SNAPSHOT_URL is set and the app recorded that date;
 *  2. current FMP screener constituents, with `source` stamped so every report
 *     carries the survivorship caveat honestly. */
export async function universeFor(day) {
  const base = process.env.UNIVERSE_SNAPSHOT_URL;
  if (base && day) {
    try {
      // Throw on empty/invalid so nothing bogus is ever cached; 10s timeout so
      // a stalled app endpoint can't hang the whole backtest.
      const snap = await cached(`snapshot_${day}`, null, async () => {
        const r = await fetch(`${base.replace(/\/$/, "")}/api/scan/universe-snapshot?date=${day}`,
          { signal: AbortSignal.timeout(10_000) });
        if (!r.ok) throw new Error(`snapshot ${day}: HTTP ${r.status}`);
        const j = await r.json();
        if (!Array.isArray(j?.symbols) || j.symbols.length === 0)
          throw new Error(`snapshot ${day}: empty symbol list`);
        return j;
      });
      return { source: `as-of snapshot (${day})`, entries: snap.symbols };
    } catch (err) {
      console.error(`universe snapshot unavailable for ${day} (${err.message}) — falling back to current screener`);
    }
  }
  const entries = await fmpUniverse();
  return { source: "current screener constituents (survivorship risk for past dates)", entries };
}

/** FMP screener universe. Cached per calendar day (TTL 24h). No price ceiling —
 * class-specific ceilings are the scanner's job, not the data layer's.
 * limit=5000 is a safety margin, NOT a size target: the tradability filters
 * (price>$3, vol>2M, mcap>$500M) define the universe (~1,300 names). FMP
 * orders by mcap, so a binding limit silently drops the smallest caps — the
 * rider class. Hard-fail if the margin is ever hit. */
export function fmpUniverse() {
  const today = new Date().toISOString().slice(0, 10);
  return cached(`universe_${today}`, 24, async () => {
    const u = new URL("https://financialmodelingprep.com/stable/company-screener");
    Object.entries({ priceMoreThan: 3, volumeMoreThan: 2000000, marketCapMoreThan: 500000000,
      exchange: "NASDAQ,NYSE", isEtf: false, isFund: false, limit: 5000, apikey: FMP })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u);
    if (!r.ok) throw new Error(`FMP screener ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j) || j.length === 0) throw new Error("FMP screener returned no rows");
    if (j.length >= 5000) throw new Error("FMP screener hit the 5000 safety limit — universe is truncated, raise it");
    return j.filter((x) => /^[A-Z]{1,5}$/.test(x.symbol))
      .map((x) => ({ symbol: x.symbol, companyName: x.companyName ?? null }));
  });
}

/** FMP earnings calendar for an arbitrary date range (derived from the run, never hardcoded). */
export function fmpEarnings(from, to) {
  return cached(`earn_${from}_${to}`, 24 * 30, async () => {
    const r = await fetch(`https://financialmodelingprep.com/stable/earnings-calendar?from=${from}&to=${to}&apikey=${FMP}`);
    if (!r.ok) throw new Error(`FMP earnings ${from}..${to}: ${r.status}`);
    const j = await r.json();
    return (Array.isArray(j) ? j : []).map((e) => `${e.date}|${e.symbol}`);
  }).then((arr) => new Set(arr));
}

// ---- earnings blackout support (Phase 4e) ---------------------------------
// Empirically verified (2026-07-26) against this plan's stable/earnings-calendar
// endpoint over the router's actual ~5y backtest window:
//   1. ROLLING 5-YEAR LOOKBACK — the endpoint 402s (Payment Required) for any
//      date more than ~1825-1826 days before the real "today", even for a
//      single-day request. It is NOT a range-width limit: a 400-day request
//      anchored in a covered period succeeds fine, but a 1-day request for an
//      uncovered (too-old) date still 402s.
//   2. ~4000-ROW SOFT CAP — for a covered period, if the TRUE row count for the
//      requested range exceeds roughly 4000, the endpoint returns ~200 (no
//      error) but SILENTLY TRUNCATES to ~3980-4000 rows clustered at the END
//      of the range (nearest `to`), dropping the earlier days with no signal
//      that anything was cut. Confirmed with a 180-day 2021 request that came
//      back with all 3998 rows dated in just the LAST 24 days of that window.
// fmpEarningsChunked() below defends against both failure modes by fetching in
// small `sliceDays` windows and adaptively bisecting (down to a 1-day floor)
// any window that either errors or returns a suspiciously large row count —
// so the caller gets either real data or an honestly-logged gap, never a
// silent hole. Every leaf request still goes through fmpEarnings()'s own
// 30-day cache, so repeat runs (validate.mjs then stress.mjs, or reruns same
// day) are cheap.
const EARNINGS_CAP_GUARD = 3000; // safety margin below the observed ~3980-4000 ceiling

export async function fmpEarningsChunked(from, to, sliceDays = 14) {
  const merged = new Set();
  const chunkLog = []; // every LEAF fetch actually made: {from,to,n,capGuardHit,error?}

  async function bisect(cf, ct, depth) {
    const fMs = Date.parse(`${cf}T00:00:00Z`), tMs = Date.parse(`${ct}T00:00:00Z`);
    const midMs = fMs + Math.floor((tMs - fMs) / 2 / 86_400_000) * 86_400_000;
    const mid = new Date(midMs).toISOString().slice(0, 10);
    const next = new Date(midMs + 86_400_000).toISOString().slice(0, 10);
    if (!(mid >= cf && next <= ct)) return false; // already at a 1-day floor — can't split further
    await fetchLeaf(cf, mid, depth + 1);
    await fetchLeaf(next, ct, depth + 1);
    return true;
  }

  async function fetchLeaf(cf, ct, depth) {
    let s;
    try {
      s = await fmpEarnings(cf, ct);
    } catch (err) {
      if (cf !== ct && depth < 14 && (await bisect(cf, ct, depth))) return;
      chunkLog.push({ from: cf, to: ct, n: 0, capGuardHit: false, error: err.message });
      return;
    }
    const capGuardHit = s.size >= EARNINGS_CAP_GUARD;
    if (capGuardHit && cf !== ct && depth < 14 && (await bisect(cf, ct, depth))) return;
    chunkLog.push({ from: cf, to: ct, n: s.size, capGuardHit });
    for (const rec of s) merged.add(rec);
  }

  let cur = new Date(`${from}T00:00:00Z`);
  const endD = new Date(`${to}T00:00:00Z`);
  while (cur <= endD) {
    const cf = cur.toISOString().slice(0, 10);
    const probe = new Date(cur);
    probe.setUTCDate(probe.getUTCDate() + sliceDays - 1);
    const ct = (probe > endD ? endD : probe).toISOString().slice(0, 10);
    await fetchLeaf(cf, ct, 0);
    cur.setUTCDate(cur.getUTCDate() + sliceDays);
  }
  return { set: merged, chunkLog };
}

/** Build a per-symbol sorted earnings-date map restricted to `universe` from
 * the raw "YYYY-MM-DD|SYMBOL" rows returned by fmpEarnings/fmpEarningsChunked,
 * plus an honest coverage summary (which universe symbols have ANY earnings
 * row in range, and the actual date span returned) so the caller can report
 * — never silently assume — how complete the blackout data is. */
export function earningsMapForUniverse(rows, universe) {
  const uniSet = new Set(universe);
  const bySymbol = new Map();
  for (const rec of rows) {
    const i = rec.lastIndexOf("|");
    const date = rec.slice(0, i), sym = rec.slice(i + 1);
    if (!uniSet.has(sym)) continue;
    if (!bySymbol.has(sym)) bySymbol.set(sym, []);
    bySymbol.get(sym).push(date);
  }
  for (const [, dates] of bySymbol) dates.sort();
  const allDates = [...bySymbol.values()].flat().sort();
  return {
    bySymbol,
    coverage: {
      universeSize: universe.length,
      coveredSymbolCount: bySymbol.size,
      uncoveredSymbols: universe.filter((s) => !bySymbol.has(s)),
      earliestDate: allDates[0] ?? null,
      latestDate: allDates[allDates.length - 1] ?? null,
      totalEarningsRows: allDates.length,
    },
  };
}

/** Alpaca SIP multi-symbol bars. Chunked, paginated, cached. HARD-FAILS if any
 * chunk errors — partial data would silently corrupt every downstream number.
 * The cache key includes a digest of the EXACT request (symbol set + timeframe +
 * window), sorted so it is order-independent: if the universe changes, the tag
 * alone would otherwise serve a stale symbol set for the 30-day TTL. */
export function alpacaBars(symbols, timeframe, start, end, tag, ttlHours = 24 * 30) {
  const digest = configHash({ symbols: [...symbols].sort(), timeframe, start, end });
  return cached(`bars_${tag}_${digest}`, ttlHours, async () => {
    const out = {};
    for (let i = 0; i < symbols.length; i += 100) {
      const chunk = symbols.slice(i, i + 100);
      let token;
      for (;;) {
        const u = new URL("https://data.alpaca.markets/v2/stocks/bars");
        Object.entries({ symbols: chunk.join(","), timeframe, start, end, limit: "10000",
          adjustment: "split", feed: "sip" }).forEach(([k, v]) => u.searchParams.set(k, v));
        if (token) u.searchParams.set("page_token", token);
        const r = await fetch(u, { headers: AH });
        if (!r.ok) throw new Error(`Alpaca bars ${tag} chunk@${i}: HTTP ${r.status} ${await r.text().catch(() => "")}`);
        const j = await r.json();
        for (const [sym, bars] of Object.entries(j.bars ?? {}))
          out[sym] = (out[sym] ?? []).concat(bars);
        token = j.next_page_token;
        if (!token) break;
      }
    }
    return out;
  }).then((o) => new Map(Object.entries(o)));
}

// ---- provenance stamping -------------------------------------------------------
export function gitSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: fileURLToPath(new URL("..", import.meta.url)) }).toString().trim(); }
  catch { return "unknown"; }
}
export const configHash = (cfg) =>
  createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 12);

export function stampMetadata(runCfg) {
  return {
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    dataProvider: "Alpaca SIP (bars) + FMP stable (screener, earnings)",
    feed: "sip", adjustment: "split", barTimeframe: "5Min/1Day",
    timezone: "America/New_York (per-date DST via Intl)",
    sessionTemplate: "pm 04:00-09:30 · cutoff 08:30 · RTH 09:30-16:00 · flatten 15:50",
    fillMode: runCfg.fill,
    dateRange: `${runCfg.from}..${runCfg.to}`,
    configHash: configHash(runCfg),
    caveats: [
      "Universe = screener constituents as of run date (survivorship risk for past dates until snapshots ship)",
      "News catalyst omitted from harness scores (earnings calendar included)",
      "Fills pessimistic unless fill mode says otherwise; costs 2bps/side + ~3bps slippage",
      "Fixed $25k per pick, no cross-position capital netting",
    ],
  };
}
