// Today's $20-and-under movers across sources: FMP biggest-gainers + most-actives,
// cross-referenced with Alpaca snapshots for live price/volume. Prints candidates to
// then check for catalysts. Read-only.
const FMP = process.env.FMP_API_KEY, AK = process.env.ALPACA_API_KEY_ID, AS = process.env.ALPACA_API_SECRET_KEY;
const MAXP = 20, MINP = 1;
const num = (v) => { const n = parseFloat(String(v).replace("%", "")); return Number.isFinite(n) ? n : null; };

async function fmp(path) { try { const r = await fetch(`https://financialmodelingprep.com/stable/${path}?apikey=${FMP}`); return r.ok ? await r.json() : null; } catch { return null; } }

const gainers = await fmp("biggest-gainers");
const actives = await fmp("most-actives");

function clean(arr, label) {
  if (!Array.isArray(arr)) { console.log(`${label}: unavailable`); return []; }
  const out = arr.map((x) => ({ s: x.symbol, price: num(x.price), pct: num(x.changesPercentage), name: (x.name || "").slice(0, 34), exch: x.exchange || "" }))
    .filter((x) => x.price != null && x.price >= MINP && x.price <= MAXP && /^[A-Z]{1,5}$/.test(x.s));
  return out;
}
const g = clean(gainers, "gainers").filter((x) => x.pct == null || x.pct >= 5).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
const a = clean(actives, "actives");

// live snapshot (price + today vol) for the union, via Alpaca
const syms = [...new Set([...g, ...a].map((x) => x.s))].slice(0, 60);
let snap = {};
try {
  const r = await fetch(`https://data.alpaca.markets/v1beta1/stocks/snapshots?symbols=${syms.join(",")}`, { headers: { "APCA-API-KEY-ID": AK, "APCA-API-SECRET-KEY": AS } });
  if (r.ok) { const j = await r.json(); for (const [s, v] of Object.entries(j.snapshots || j || {})) { const day = v.dailyBar, min = v.minuteBar, pc = v.prevDailyBar; snap[s] = { last: (min?.c ?? day?.c), vol: day?.v, dvol: (day?.c ?? 0) * (day?.v ?? 0), pc: pc?.c }; } }
} catch {}

const fmtV = (v) => v == null ? "   ?" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : (v / 1e3).toFixed(0) + "K";
console.log(`\n=== TODAY'S $${MINP}-$${MAXP} MOVERS (FMP gainers, live) ===`);
console.log(`  ${"sym".padEnd(6)} ${"price".padStart(7)}  ${"chg%".padStart(7)}  ${"$vol".padStart(7)}  name`);
for (const x of g.slice(0, 25)) {
  const sn = snap[x.s];
  console.log(`  ${x.s.padEnd(6)} ${("$" + (x.price ?? 0).toFixed(2)).padStart(7)}  ${((x.pct >= 0 ? "+" : "") + (x.pct ?? 0).toFixed(1) + "%").padStart(7)}  ${(sn?.dvol != null ? "$" + (sn.dvol / 1e6).toFixed(0) + "M" : "?").padStart(7)}  ${x.name}`);
}
console.log(`\n=== MOST-ACTIVE $${MINP}-$${MAXP} (by volume) ===`);
for (const x of a.slice(0, 15)) console.log(`  ${x.s.padEnd(6)} ${("$" + (x.price ?? 0).toFixed(2)).padStart(7)}  ${x.name}`);
console.log("");
