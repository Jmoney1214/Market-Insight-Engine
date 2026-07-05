// Full-pipeline PIT backtest orchestrator.
//   node pipeline.mjs --from 2026-07-02 [--to 2026-07-03] [--report] [--html] [--fill stop_first]
// Per day: 8:30 ET scanner replay (gate telemetry) -> badge-matched engines ->
// post-flight attribution (movers, reason codes, catch rates) -> stamped report.
// Data plane: Alpaca SIP bars only; FMP screener/earnings only. See lib/data.mjs.
import { writeFileSync } from "node:fs";
import { parseArgs, tradingDays, etWindow, etHm, daysBefore } from "./lib/dates.mjs";
import { requireCreds, fmpUniverse, fmpEarnings, alpacaBars, stampMetadata } from "./lib/data.mjs";
import { scanDay, runEngine } from "./lib/engine.mjs";
import { attribute } from "./lib/postflight.mjs";
import { writeReports } from "./lib/report.mjs";

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const args = parseArgs(process.argv.slice(2));
requireCreds();
const days = tradingDays(args.from, args.to);
console.error(`run: ${days.length} weekday(s) ${args.from}..${args.to} · fill=${args.fill}`);

const uni = await fmpUniverse();
const syms = uni.map((u) => u.symbol);
const nameOf = new Map(uni.map((u) => [u.symbol, u.companyName]));
console.error(`universe: ${uni.length}`);

// Warm-up lookback: 320 calendar days covers 60d dollar-vol + 10d range stats
// with margin, from the EARLIEST requested day.
const dailies = await alpacaBars(syms, "1Day",
  `${daysBefore(args.from, 320)}T00:00:00Z`, `${args.to}T23:59:59Z`, `dailies_${args.from}_${args.to}`);
console.error(`dailies: ${dailies.size} symbols`);
const earnSet = await fmpEarnings(args.from, args.to);

const results = [];
for (const day of days) {
  const w = etWindow(day, "04:00", "20:00"); // per-date DST-correct
  const raw = await alpacaBars(syms, "5Min", w.start, w.end, `full_${day}`);
  const dayBarsMap = new Map();
  for (const [sym, bars] of raw) dayBarsMap.set(sym, bars.map((b) => ({ ...b, hm: etHm(b.t) })));
  const anyRth = [...dayBarsMap.values()].some((bars) => bars.some((b) => b.hm >= "09:30" && b.hm < "16:00"));
  if (!anyRth) {
    console.error(`${day}: no session`);
    results.push({ day, noSession: true, universeSize: dailies.size, picks: [], dayPnl: 0 });
    continue;
  }

  const board = scanDay({ day, dailies, dayBarsMap, earnSet });
  const picks = board.eligible.map((rec) => {
    const res = runEngine(rec.cls, dayBarsMap.get(rec.sym) ?? [], rec.prevClose, args.fill);
    return { sym: rec.sym, companyName: nameOf.get(rec.sym), cls: rec.cls, score: rec.score,
      gap: rec.gap, pmDollar: rec.pmDollar, mtd: rec.mtd, avgRange: rec.avgRange, ...res };
  });
  const attribution = attribute({ day, board, picks, dailies, dayBarsMap });
  const dayPnl = round(picks.flatMap((p) => p.trades ?? []).reduce((s, t) => s + t.pnl, 0));

  const slim = (c) => ({ sym: c.sym, price: c.price, gap: c.gap, pmDollar: c.pmDollar,
    mtd: c.mtd, avgRange: c.avgRange, cls: c.cls, score: c.score, lifecycle: c.lifecycle });
  results.push({ day, universeSize: dailies.size, dayPnl,
    board: { top: board.top.map(slim), jump: board.jump.map(slim), fall: board.fall.map(slim) },
    picks, attribution });
  console.error(`${day}: eligible=${picks.length} traded=${picks.filter((p) => p.trades?.length).length} ` +
    `pnl=${dayPnl} movers=${attribution.movers.length} boardCatch=${attribution.catchRates.boardCatch}%`);
}

const meta = stampMetadata(args);
writeFileSync(new URL("./pipeline_results.json", import.meta.url).pathname, JSON.stringify({ meta, results }, null, 1));
console.error("results -> pipeline_results.json");
if (args.report) {
  const repoRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
  for (const f of writeReports(results, meta, repoRoot, args.html)) console.error(`report -> ${f}`);
}
