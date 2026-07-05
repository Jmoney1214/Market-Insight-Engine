// Cross-source data verification — the "multi-check" rule: before trusting a
// backtest over a date range, the bars behind it are independently verified
// against a second paid provider. Alpaca SIP stays the ONLY engine input
// (data-plane hard contract); FMP here is a VERIFIER, never a bar source.
// Both sides fetch LIVE on purpose — a verifier that reads the harness cache
// verifies nothing.
//   node crosscheck.mjs --from 2025-07-21 [--to 2025-07-25]
//     [--symbols HIMS,COIN,...] [--sample 10] [--intraday HIMS[,COIN...]]
// Exit 0 = providers agree within tolerance. Exit 1 = drift — do not trust a
// backtest over this range until the discrepancy is explained.
import { tradingDays, etWindow, etHm } from "./lib/dates.mjs";
import { requireCreds, universeFor } from "./lib/data.mjs";

const TOL = { dailyClosePct: 0.1, dailyVolPct: 5, intradayOhlcPct: 0.25 };
const AH = {
  "APCA-API-KEY-ID": process.env.ALPACA_API_KEY_ID,
  "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET_KEY,
};
const FMP = process.env.FMP_API_KEY;

function args(argv) {
  const get = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const from = get("--from"), to = get("--to") ?? from;
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    throw new Error("usage: node crosscheck.mjs --from YYYY-MM-DD [--to YYYY-MM-DD] [--symbols A,B] [--sample N] [--intraday A,B]");
  return { from, to, symbols: get("--symbols")?.split(",").filter(Boolean),
    sample: Number(get("--sample") ?? 10), intraday: get("--intraday")?.split(",").filter(Boolean) ?? [] };
}

async function alpaca(params) {
  const out = {};
  let token;
  for (;;) {
    const u = new URL("https://data.alpaca.markets/v2/stocks/bars");
    Object.entries({ ...params, limit: "10000", adjustment: "split", feed: "sip" })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    if (token) u.searchParams.set("page_token", token);
    const r = await fetch(u, { headers: AH });
    if (!r.ok) throw new Error(`Alpaca ${r.status} ${await r.text().catch(() => "")}`);
    const j = await r.json();
    for (const [sym, bars] of Object.entries(j.bars ?? {})) out[sym] = (out[sym] ?? []).concat(bars);
    token = j.next_page_token;
    if (!token) break;
  }
  return out;
}

async function fmp(path) {
  const r = await fetch(`https://financialmodelingprep.com/stable/${path}&apikey=${FMP}`);
  if (!r.ok) throw new Error(`FMP ${path.split("?")[0]}: ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

const pctDiff = (a, b) => (b ? Math.abs(a - b) / Math.abs(b) * 100 : a ? Infinity : 0);
const cfg = args(process.argv.slice(2));
requireCreds();
const days = tradingDays(cfg.from, cfg.to);
const issues = [];

let syms = cfg.symbols;
if (!syms) {
  // Deterministic evenly-spaced sample across the universe — no RNG, so two
  // runs over the same universe check the same names.
  const { entries } = await universeFor(cfg.from);
  const all = entries.map((e) => e.symbol).sort();
  syms = Array.from({ length: Math.min(cfg.sample, all.length) },
    (_, i) => all[Math.floor((i * all.length) / Math.min(cfg.sample, all.length))]);
}
console.error(`crosscheck: ${cfg.from}..${cfg.to} · ${syms.length} symbols (${syms.join(",")})` +
  (cfg.intraday.length ? ` · intraday: ${cfg.intraday.join(",")}` : ""));

// ---- daily bars: Alpaca SIP close/volume vs FMP EOD -----------------------------
const aDaily = await alpaca({ symbols: syms.join(","), timeframe: "1Day",
  start: `${cfg.from}T00:00:00Z`, end: `${cfg.to}T23:59:59Z` });
let dayChecks = 0;
for (const sym of syms) {
  const fRows = new Map((await fmp(`historical-price-eod/full?symbol=${sym}&from=${cfg.from}&to=${cfg.to}`))
    .map((r) => [r.date, r]));
  const aRows = new Map((aDaily[sym] ?? []).map((b) => [b.t.slice(0, 10), b]));
  let worstC = 0, worstV = 0, n = 0;
  for (const day of days) {
    const a = aRows.get(day), f = fRows.get(day);
    if (!a && !f) continue; // holiday — both providers agree there was no session
    if (!a || !f) { issues.push(`${sym} ${day}: session mismatch — ${a ? "FMP" : "Alpaca"} has no bar`); continue; }
    n++; dayChecks++;
    const dc = pctDiff(a.c, f.close), dv = pctDiff(a.v, f.volume);
    worstC = Math.max(worstC, dc); worstV = Math.max(worstV, dv);
    if (dc > TOL.dailyClosePct) {
      // Alpaca is split-adjusted; FMP `close` is raw. A post-range split shows
      // up here as an exact factor — FMP adjClose agreeing means factor, not error.
      const adj = f.adjClose != null && pctDiff(a.c, f.adjClose) <= TOL.dailyClosePct;
      issues.push(`${sym} ${day}: close drift ${dc.toFixed(3)}% (alpaca=${a.c} fmp=${f.close})` +
        (adj ? " — matches FMP adjClose (split/dividend adjustment, verify factor)" : ""));
    }
    if (dv > TOL.dailyVolPct)
      issues.push(`${sym} ${day}: volume drift ${dv.toFixed(1)}% (alpaca=${a.v} fmp=${f.volume})`);
  }
  console.error(`  ${sym}: ${n} day(s) · worst Δclose ${worstC.toFixed(3)}% · worst Δvol ${worstV.toFixed(2)}%`);
}

// ---- intraday 5m bars (the bars the engine actually trades on) ------------------
// FMP intraday is RTH-only, so only bars both providers publish are compared.
// Disputed highs/lows are adjudicated against Alpaca's own 1-minute SIP tape:
// if the finer tape confirms the 5m extreme and FMP's range is merely NARROWER,
// FMP's feed missed prints — noted, not failed. FMP showing a WIDER range than
// SIP (prints Alpaca lacks) is a real issue.
let barChecks = 0;
async function adjudicateExtreme(sym, day, hm, bar, field) {
  const [h, m] = hm.split(":").map(Number);
  const end = `${String(Math.floor((h * 60 + m + 5) / 60)).padStart(2, "0")}:${String((m + 5) % 60).padStart(2, "0")}`;
  const w = etWindow(day, hm, end);
  // Alpaca's `end` is inclusive — drop the hm+5 bar, it belongs to the NEXT 5m interval.
  const m1 = ((await alpaca({ symbols: sym, timeframe: "1Min", start: w.start, end: w.end }))[sym] ?? [])
    .filter((b) => { const t = etHm(b.t); return t >= hm && t < end; });
  if (!m1.length) return false;
  const tape = field === "h" ? Math.max(...m1.map((b) => b.h)) : Math.min(...m1.map((b) => b.l));
  return pctDiff(bar[field], tape) <= 0.02; // 5m extreme reproduced on the 1m tape
}
for (const sym of cfg.intraday) {
  for (const day of days) {
    const w = etWindow(day, "09:30", "16:00");
    const a = ((await alpaca({ symbols: sym, timeframe: "5Min", start: w.start, end: w.end }))[sym] ?? [])
      .filter((b) => { const t = etHm(b.t); return t >= "09:30" && t < "16:00"; }); // inclusive end may return the 16:00 bar
    const f = await fmp(`historical-chart/5min?symbol=${sym}&from=${day}&to=${day}`);
    if (!a.length && !f.length) continue; // both agree: no session
    if (!a.length || !f.length) {
      issues.push(`${sym} ${day}: intraday session mismatch — ${a.length ? "Alpaca" : "FMP"} has ${a.length || f.length} bars, ${a.length ? "FMP" : "Alpaca"} has none`);
      continue;
    }
    const aMap = new Map(a.map((b) => [etHm(b.t), b]));
    let n = 0, worst = 0, miss = 0, notes = 0;
    const disputes = [];
    for (const r of f) {
      const hm = r.date.slice(11, 16), b = aMap.get(hm);
      if (!b) { miss++; continue; }
      n++; barChecks++;
      for (const [ak, fk] of [["o", "open"], ["h", "high"], ["l", "low"], ["c", "close"]]) {
        const d = pctDiff(b[ak], r[fk]);
        worst = Math.max(worst, d);
        if (d > TOL.intradayOhlcPct) disputes.push({ hm, b, ak, fk, d, fv: r[fk] });
      }
    }
    for (const { hm, b, ak, fk, d, fv } of disputes) {
      const isExtreme = ak === "h" || ak === "l";
      const fmpNarrower = (ak === "h" && fv < b.h) || (ak === "l" && fv > b.l);
      if (isExtreme && fmpNarrower && await adjudicateExtreme(sym, day, hm, b, ak)) {
        notes++; // Alpaca extreme confirmed by its own 1m tape; FMP feed is coarser
        console.error(`  note: ${sym} ${day} ${hm} ${fk} Δ${d.toFixed(3)}% — SIP extreme confirmed by 1-min tape; FMP missed prints`);
      } else {
        issues.push(`${sym} ${day} ${hm}: intraday ${fk} drift ${d.toFixed(3)}% (alpaca=${b[ak]} fmp=${fv}) — NOT explained by tape granularity`);
      }
    }
    const aMiss = a.length - n; // symmetric: Alpaca RTH bars FMP never published
    if (miss > 2)
      issues.push(`${sym} ${day}: ${miss} FMP bars missing from Alpaca RTH set`);
    if (aMiss > 2)
      issues.push(`${sym} ${day}: ${aMiss} Alpaca RTH bars missing from FMP set`);
    console.error(`  ${sym} ${day} intraday: ${n} bars · worst ΔOHLC ${worst.toFixed(3)}%` +
      `${miss || aMiss ? ` · ${miss + aMiss} unmatched` : ""}${notes ? ` · ${notes} adjudicated (SIP finer)` : ""}`);
  }
}

if (issues.length) {
  console.error(`\nCROSSCHECK DRIFT — ${issues.length} issue(s):`);
  for (const i of issues) console.error(`  ✗ ${i}`);
  console.error("Do not trust backtests over this range until each issue is explained.");
  process.exit(1);
}
console.error(`\nCROSSCHECK OK — Alpaca SIP and FMP agree: ${dayChecks} symbol-days` +
  (barChecks ? ` + ${barChecks} intraday bars` : "") + " within tolerance " +
  `(close ≤${TOL.dailyClosePct}%, vol ≤${TOL.dailyVolPct}%, intraday OHLC ≤${TOL.intradayOhlcPct}%).`);
