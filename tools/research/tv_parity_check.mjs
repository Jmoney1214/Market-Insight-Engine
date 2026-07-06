// Pine <-> Node parity checker driven by TradingView MCP trades (no CSV export).
//   node tv_parity_check.mjs --trades <mcp_dump.json> --symbol HIMS \
//     --from 2026-07-21 --to 2026-07-25 [--class rider] [--fill tv_ohlc_path]
//
// The MCP `data_get_trades` payload has NO timestamps, so TV vs Node trades are
// matched by chronological SEQUENCE (trade N vs trade N), not by time. Alpaca
// SIP stays the only bar source; TradingView supplies only the trades to verify.
import { readFileSync } from "node:fs";
import { etWindow, etHm, daysBefore, tradingDays } from "./lib/dates.mjs";
import { requireCreds, alpacaBars } from "./lib/data.mjs";
import { runEngine } from "./lib/engine.mjs";
import { normalizeMcpTrades } from "./lib/tradingview_mcp_adapter.mjs";
import { matchBySequence, tally, hardFail } from "./lib/parity.mjs";

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const get = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };
const tradesPath = get("--trades"), symbol = get("--symbol");
const from = get("--from"), to = get("--to") ?? from;
const cls = get("--class") ?? "rider";
const fill = get("--fill") ?? "tv_ohlc_path";
if (!tradesPath || !symbol || !from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  console.error("usage: node tv_parity_check.mjs --trades <mcp_dump.json> --symbol SYM --from YYYY-MM-DD --to YYYY-MM-DD [--class rider|scalper] [--fill tv_ohlc_path]");
  process.exit(2);
}
requireCreds();

// TradingView side: normalize the MCP order dump into chronological trades.
const payload = JSON.parse(readFileSync(tradesPath, "utf8"));
const tvTrades = normalizeMcpTrades(payload);

// Node side: run the harness engine over the SAME date range, collecting every
// trade across all days into one chronological list (Alpaca SIP bars only).
const nodeTrades = [];
for (const day of tradingDays(from, to)) {
  const daily = await alpacaBars([symbol], "1Day", `${daysBefore(day, 30)}T00:00:00Z`, `${day}T23:59:59Z`, `tvpk_d_${symbol}_${day}`);
  const hist = (daily.get(symbol) ?? []).filter((b) => b.t.slice(0, 10) < day);
  const w = etWindow(day, "04:00", "20:00");
  const full = await alpacaBars([symbol], "5Min", w.start, w.end, `tvpk_f_${symbol}_${day}`);
  const bars = (full.get(symbol) ?? []).map((b) => ({ ...b, hm: etHm(b.t) }));
  const res = runEngine(cls, bars, hist.at(-1)?.c, fill);
  for (const t of (res.trades ?? []))
    nodeTrades.push({ ...t, day, side: "long", gross: round((t.exit - t.entry) * t.qty) });
}
console.error(`TV MCP: ${tvTrades.length} trade(s) vs Node: ${nodeTrades.length} trade(s) for ${symbol} (class ${cls}, fill ${fill}, ${from}..${to})`);

const results = matchBySequence(tvTrades, nodeTrades);
const { counts, drift } = tally(results);
const hf = hardFail(results, { tvCount: tvTrades.length, nodeCount: nodeTrades.length });

// Readable mismatch report — one line per non-MATCH pair.
for (const r of results) {
  if (r.verdict === "MATCH") continue;
  const tvStr = r.tvEntry != null ? `${r.tvEntry}→${r.tvExit} ($${r.pnlTv})` : "—";
  const nodeStr = r.nodeEntry != null ? `${r.nodeEntry}→${r.nodeExit} ($${r.pnlNode})` : "—";
  console.error(`seq ${r.seq} | ${r.verdict} | ${r.side ?? "-"} | tv ${tvStr} vs node ${nodeStr} | qty ${r.qtyTv ?? "-"}/${r.qtyNode ?? "-"} | ${r.exitReason ?? "-"}`);
}

// Aggregate cross-check: our gross PnL vs TV's reported net (net includes
// commission, ours doesn't — report the gap, never fail on it).
const tvGross = round(tvTrades.reduce((s, t) => s + t.grossPnl, 0));
const nodeGross = round(nodeTrades.reduce((s, t) => s + t.gross, 0));
const strategyNetProfit = payload?.strategy_results?.net_profit;
console.log(JSON.stringify({
  symbol, cls, fill, counts, hardFail: hf,
  aggregate: { tvGross, nodeGross, ...(strategyNetProfit != null ? { strategyNetProfit } : {}) },
}, null, 1));
if (strategyNetProfit != null)
  console.error(`x-check: tv gross ${tvGross} vs strategy_results.net_profit ${strategyNetProfit} (Δ ${round(tvGross - strategyNetProfit)} — TV net includes commission, our gross doesn't)`);

console.error(`verdict: ${hf.failed ? `HARD FAIL (${hf.reasons.length} reason(s))` : drift === 0 ? "PARITY OK" : `DRIFT: ${drift} signal/exit mismatch(es)`} · ${JSON.stringify(counts)}`);
process.exit(hf.failed || drift > 0 ? 1 : 0);
