import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, scanDay, runEngine, resolveIntrabar } from "../lib/engine.mjs";

test("classify: validated class boundaries", () => {
  assert.equal(classify(7.7, 7e8, 36.8), "rider");     // HIMS profile
  assert.equal(classify(3.2, 33e9, 194), "scalper");   // NVDA profile
  assert.equal(classify(8.1, 2e8, 2.6), "caution");    // PLUG: cheap mover capped
  assert.equal(classify(3.9, 1.3e9, 17.9), "avoid");   // AAL: quiet tape
  assert.equal(classify(null, 33e9, 194), "scalper");  // liquidity alone identifies scalper
  assert.equal(classify(null, 1e9, 50), null);
});

test("resolveIntrabar: fill modes when stop AND target are inside the bar", () => {
  const bar = { o: 100, h: 104, l: 98, c: 103 }; // |o-h|=4 > |o-l|=2 -> walks DOWN first
  assert.equal(resolveIntrabar(bar, 99, 103.5, "stop_first"), "stop");
  assert.equal(resolveIntrabar(bar, 99, 103.5, "target_first"), "target");
  assert.equal(resolveIntrabar(bar, 99, 103.5, "tv_ohlc_path"), "stop");
  const barDn = { o: 100, h: 101.8, l: 96, c: 97 }; // open nearer high but... |o-h|=1.8 < |o-l|=4 -> up first
  assert.equal(resolveIntrabar(barDn, 99, 101.5, "tv_ohlc_path"), "target");
  const barDn2 = { o: 100, h: 105, l: 99.5, c: 97 }; // |o-h|=5 > |o-l|=0.5 -> down first
  assert.equal(resolveIntrabar(barDn2, 99.6, 104, "tv_ohlc_path"), "stop");
  assert.equal(resolveIntrabar({ o: 1, h: 2, l: 1, c: 2 }, 0.5, 3, "stop_first"), null);
});

// ---- synthetic-day fixtures ------------------------------------------------------
const mkDaily = (n, { range = 3, close = 50, vol = 5e6 } = {}) =>
  Array.from({ length: n }, (_, i) => ({
    t: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}T05:00:00Z`,
    o: close, h: close * (1 + range / 200), l: close * (1 - range / 200), c: close, v: vol,
  }));
const mkBar = (hm, o, h, l, c, v = 50000) => ({ t: `x`, hm, o, h, l, c, v });

test("scanDay telemetry: gates log pass/fail with values, lifecycle assigned", () => {
  const dailies = new Map([
    ["MOVER", mkDaily(40, { range: 8, close: 50 })],   // rider profile
    ["NEWIPO", mkDaily(5)],                            // history gate
    ["BIGPX", mkDaily(40, { range: 5, close: 400 })],  // caution class >150 -> ceiling
  ]);
  const dayBarsMap = new Map([
    ["MOVER", [mkBar("08:00", 51, 52, 51, 52, 2e5), mkBar("08:25", 52, 52.5, 52, 52.5, 2e5)]], // gap +5%, pm$ ~$20M
    ["NEWIPO", [mkBar("08:25", 5, 5, 5, 5, 100)]],
    ["BIGPX", [mkBar("08:25", 400, 400, 400, 400, 1000)]],
  ]);
  const board = scanDay({ day: "2026-03-05", dailies, dayBarsMap, earnSet: new Set() });
  const t = board.telemetry;
  assert.equal(t.get("NEWIPO").gates.find((g) => g.gate === "history_30d").pass, false);
  assert.equal(t.get("NEWIPO").lifecycle, "excluded");
  assert.equal(t.get("BIGPX").gates.find((g) => g.gate === "price_ceiling").pass, false);
  const m = t.get("MOVER");
  assert.equal(m.cls, "rider");
  assert.equal(m.lifecycle, "eligible");
  for (const g of ["history_30d", "price_ceiling", "prelim_rank_top30", "badge", "mtd_min7", "pm_dollar_2m", "top5_score"])
    assert.ok(m.gates.some((x) => x.gate === g && x.pass), `gate ${g} should pass`);
  assert.equal(board.eligible.length, 1);
});

test("runEngine: gap-up day, pullback entry, ride to flatten; 11:00 bar excluded from signals", () => {
  const prevClose = 50;
  const bars = [
    mkBar("08:30", 52, 52, 52, 52, 1e5),         // pre-market, gap +4%
    mkBar("09:30", 52, 52.6, 51.9, 52.5, 5e5),
    mkBar("09:35", 52.5, 53, 52.4, 52.9, 4e5),
    mkBar("09:40", 52.9, 53.2, 52.8, 53.1, 3e5),
    mkBar("09:45", 53.1, 53.2, 52.4, 53.15, 3e5), // dips through e9 (~52.57), closes above -> signal
    mkBar("09:50", 53.2, 55, 53.1, 54.8, 4e5),    // fill at open 53.2+slip
    ...Array.from({ length: 70 }, (_, i) => mkBar(
      `${String(10 + Math.floor((i * 5 + 55) / 60)).padStart(2, "0")}:${String((i * 5 + 55) % 60).padStart(2, "0")}`,
      55, 55.5, 54.8, 55.2, 1e5)),
    mkBar("15:50", 56, 56.2, 55.9, 56.1, 2e5),
  ];
  const res = runEngine("rider", bars, prevClose, "stop_first");
  assert.equal(res.status, "traded");
  assert.equal(res.trades.length, 1);
  assert.equal(res.trades[0].reason, "eod");
  assert.ok(res.trades[0].pnl > 0);
  // fall day declined
  const fall = runEngine("rider", [mkBar("09:30", 47, 47, 47, 47, 1e5)], 50, "stop_first");
  assert.match(fall.status, /declined: fall day/);
});
