// DISCRETIONARY TRADE LOG — the one thing a backtest can't measure: does Jay's LIVE read
// beat the machine? Log EVERY real trade (wins AND losses, no cherry-picking) and it tracks
// whether your judgment clears the bar the mechanical tests never could.
//   add:   node disc_log.mjs add TICKER ENTRY EXIT SHARES [STOP] "reason / setup"
//   stats: node disc_log.mjs            (or:  node disc_log.mjs stats)
//   undo:  node disc_log.mjs undo       (removes the last entry)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const F = fileURLToPath(new URL("./scans/discretionary_log.jsonl", import.meta.url));
const BEST_MACHINE = -0.0065;  // best any mechanical penny variant got (IGNITE, holdout) ~ -0.65%/trade
const read = () => existsSync(F) ? readFileSync(F, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const write = (rows) => writeFileSync(F, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
const etDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const mode = process.argv[2] || "stats";

if (mode === "add") {
  const a = process.argv.slice(3);
  const ticker = (a[0] || "").toUpperCase(), entry = +a[1], exit = +a[2], shares = +a[3];
  if (!ticker || !(entry > 0) || !(exit > 0) || !(shares > 0)) { console.log('usage: add TICKER ENTRY EXIT SHARES [STOP] "reason"'); process.exit(1); }
  let stop = null, reason = "";
  const rest = a.slice(4);
  if (rest.length && !isNaN(+rest[0]) && rest[0].match(/^[0-9.]+$/)) { stop = +rest[0]; reason = rest.slice(1).join(" "); }
  else reason = rest.join(" ");
  const retPct = (exit - entry) / entry, pnl = (exit - entry) * shares;
  const R = stop && entry - stop > 0 ? (exit - entry) / (entry - stop) : null;
  const rec = { date: etDate(), ticker, dir: "long", entry, exit, shares, stop, reason, retPct: +(retPct * 100).toFixed(3), pnl: +pnl.toFixed(2), R: R == null ? null : +R.toFixed(2), ts: new Date().toISOString() };
  const rows = read(); rows.push(rec); write(rows);
  console.log(`logged: ${ticker} ${entry}->${exit} x${shares} = ${rec.retPct >= 0 ? "+" : ""}${rec.retPct}% ($${rec.pnl})${R != null ? " " + rec.R + "R" : ""}  "${reason}"\n`);
} else if (mode === "undo") {
  const rows = read(); const last = rows.pop(); write(rows);
  console.log(last ? `removed: ${last.ticker} ${last.retPct}%` : "log empty"); process.exit(0);
}

const rows = read();
const rets = rows.map((r) => r.retPct / 100);
const pnl = rows.reduce((s, r) => s + r.pnl, 0);
const Rs = rows.filter((r) => r.R != null).map((r) => r.R);
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const wins = rows.filter((r) => r.retPct > 0).length;
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
console.log(`=== DISCRETIONARY LOG · ${rows.length} trade(s) ===`);
if (!rows.length) {
  console.log(`  empty. Log your first real trade:`);
  console.log(`  node tools/router/disc_log.mjs add CYCU 1.50 1.65 1000 1.42 "VWAP reclaim, held trend"`);
} else {
  console.log(`  avg/trade ${pct(mean(rets))} · median ${pct(rets.slice().sort((a, b) => a - b)[Math.floor(rets.length / 2)])} · win ${(100 * wins / rows.length).toFixed(0)}%${Rs.length ? ` · avg ${mean(Rs).toFixed(2)}R` : ""}`);
  console.log(`  total P&L: $${pnl.toFixed(2)}  (sum of returns ${pct(rets.reduce((s, x) => s + x, 0))})`);
  const avg = mean(rets);
  console.log(`\n  THE BAR:  break-even 0.00%  |  best machine ${pct(BEST_MACHINE)}/trade (holdout)`);
  console.log(`  YOUR READ: ${pct(avg)}/trade  ->  ${avg > 0 ? "NET POSITIVE (beats every machine version)" : avg > BEST_MACHINE ? "still red, but beating the machine" : "at/below the machine's base rate"}`);
  if (rows.length < 20) console.log(`\n  ⚠️  n=${rows.length} — too few to trust (need ~20-30). This is NOISE so far. Keep logging every trade.`);
  else console.log(`\n  n=${rows.length} — a real sample. ${avg > 0.002 ? "Evidence your read adds edge the machine couldn't find." : avg > BEST_MACHINE ? "Marginal — your read helps but isn't clearly +EV yet." : "Your discretionary read is NOT beating the −EV base rate."}`);
}
console.log("");
