// WATCH — one-shot live status for an OPEN discretionary position (default FMFC).
// Survives Claude's session dying: Jay runs it anytime for price + P&L + decision levels
// + reverse-split guard + latest news, all in one shot. Backbone of the "constant-check"
// watch (see docs/superpowers/specs/2026-07-31-fmfc-watch-design.md). Scoped: retire Monday open.
//   node --env-file=.env tools/router/watch_fmfc.mjs            (defaults to FMFC)
//   node --env-file=.env tools/router/watch_fmfc.mjs FMFC       (explicit)
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const AK = process.env.ALPACA_API_KEY_ID, AS = process.env.ALPACA_API_SECRET_KEY;
const FEED = process.env.ALPACA_FEED || "sip";
if (!AK || !AS) { console.error("missing ALPACA creds (run with --env-file=.env)"); process.exit(1); }
const H = { "APCA-API-KEY-ID": AK, "APCA-API-SECRET-KEY": AS };

const SYM = (process.argv[2] || "FMFC").toUpperCase();
// decision levels per symbol (approved 2026-07-31): break DOWN = heading to base, reclaim UP = real bounce
const LEVELS = { FMFC: { down: 0.30, up: 0.41, base: 0.23, presplitMax: 1.50, splitRatio: 16 } };
const L = LEVELS[SYM] || { down: null, up: null, base: null, presplitMax: null, splitRatio: null };

const posFile = fileURLToPath(new URL("./scans/open_positions.jsonl", import.meta.url));
const positions = existsSync(posFile)
  ? readFileSync(posFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((p) => p.status === "OPEN" && p.ticker === SYM)
  : [];

async function snapshot(sym) {
  const r = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${sym}&feed=${FEED}`, { headers: H });
  if (!r.ok) return null;
  const j = await r.json();
  const v = (j.snapshots || j)[sym] || j[sym]; if (!v) return null;
  return { last: v.latestTrade?.p ?? v.minuteBar?.c ?? v.dailyBar?.c, dayC: v.dailyBar?.c, dayV: v.dailyBar?.v,
    prevC: v.prevDailyBar?.c, bid: v.latestQuote?.bp, ask: v.latestQuote?.ap, t: v.latestTrade?.t ?? v.minuteBar?.t };
}
async function news(sym) {
  try { const r = await fetch(`https://data.alpaca.markets/v1beta1/news?symbols=${sym}&limit=5&sort=desc`, { headers: H });
    if (!r.ok) return []; return (await r.json()).news || []; } catch { return []; }
}
const etNow = () => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date());
const usd = (x) => `${x < 0 ? "-$" : "$"}${Math.abs(x).toFixed(2)}`;
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

const snap = await snapshot(SYM);
console.log(`\n=== WATCH ${SYM} · ${etNow()} ET · feed=${FEED} ===`);
if (!snap || !(snap.last > 0)) { console.log("  no live price (market may be closed / no post-market prints). Try again or check broker."); process.exit(0); }
const px = snap.last;
console.log(`  LAST ${usd(px)}${snap.dayV ? `  dayVol ${(snap.dayV / 1e6).toFixed(1)}M` : ""}`);
if (snap.bid && snap.ask) { const spr = (snap.ask - snap.bid) / snap.ask; console.log(`  BID ${usd(snap.bid)} / ASK ${usd(snap.ask)}  (spread ${(spr * 100).toFixed(1)}% — your real exit cost)`); }

// reverse-split guard: a ~16x jump over the weekend is the 1-for-16 consolidation, NOT a recovery
let splitFlag = false;
if (L.presplitMax && px > L.presplitMax) {
  splitFlag = true;
  console.log(`\n  🔁 LIKELY 1-for-${L.splitRatio} REVERSE SPLIT (price > $${L.presplitMax}). This is NOT a recovery —`);
  console.log(`     your ${L.splitRatio}x-fewer shares are worth the same dollars. Verify share count in broker.`);
}

for (const p of positions) {
  // if a split is live, dollar P&L math is unchanged; show it split-adjusted so it isn't misread
  const effShares = splitFlag ? p.shares / L.splitRatio : p.shares;
  const effEntry = splitFlag ? p.entry * L.splitRatio : p.entry;
  const pnl = (px - effEntry) * effShares, ret = (px - effEntry) / effEntry;
  console.log(`\n  POSITION ${p.ticker} · ${p.shares} sh @ ${usd(p.entry)} (cost ${usd(p.cost)})`);
  console.log(`    P&L: ${usd(pnl)}  (${pct(ret)})  ·  value now ${usd(px * effShares)}`);
}
if (!positions.length) console.log(`\n  (no OPEN ${SYM} position in open_positions.jsonl)`);

// decision levels
if (L.down != null && !splitFlag) {
  console.log(`\n  LEVELS:`);
  const dd = (px - L.down) / L.down, du = (L.up - px) / px;
  console.log(`    ⬇ breakdown $${L.down.toFixed(2)} — ${px <= L.down ? "🔴 TRIGGERED (heading to base ~$" + L.base.toFixed(2) + ")" : `${(dd * 100).toFixed(1)}% above (${usd(px - L.down)} of room)`}`);
  console.log(`    ⬆ bounce    $${L.up.toFixed(2)} — ${px >= L.up ? "🟢 TRIGGERED (real reclaim)" : `${(du * 100).toFixed(1)}% below (needs +${usd(L.up - px)})`}`);
  console.log(`    base target $${L.base.toFixed(2)} (pre-pump floor)`);
}

const nz = await news(SYM);
console.log(`\n  NEWS (latest ${nz.length}):`);
if (!nz.length) console.log(`    (none via Alpaca) — check filings manually: https://www.stocktitan.net/sec-filings/${SYM}/  ·  SEC EDGAR CIK 2024656`);
for (const n of nz.slice(0, 5)) {
  const t = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(n.created_at));
  console.log(`    • ${t} — ${n.headline}${n.source ? ` [${n.source}]` : ""}`);
}
console.log(`\n  ⚠️  Watch for: reverse-split 6-K, new convertible-note draw, or dilution 424B (all bearish overhangs).`);
console.log(`  Retire this watch at Monday's open once the decision is made.\n`);
