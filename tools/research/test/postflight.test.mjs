import { test } from "node:test";
import assert from "node:assert/strict";
import { outcome, reasonCode, attribute } from "../lib/postflight.mjs";

const mkBar = (hm, o, h, l, c, v = 1e5) => ({ hm, o, h, l, c, v });

test("outcome: cc / ride / max excursions from session bars", () => {
  const bars = [
    mkBar("09:40", 100, 101, 99, 100.5),
    mkBar("12:00", 100.5, 108, 100, 107),
    mkBar("15:50", 107, 107.5, 106, 107),
  ];
  const o = outcome(bars, 95);
  assert.equal(o.ride, 7);          // 100 -> 107
  assert.equal(o.maxUp, 8);         // 108 high
  assert.equal(o.maxDn, -1);        // 99 low
  assert.equal(o.cc, 12.63);        // 95 -> 107
  assert.equal(outcome([], 95), null);
});

const rec = (gates, extra = {}) => ({ sym: "X", gap: 0.8, gates, ...extra });
const g = (gate, pass, value) => ({ gate, pass, value });

test("reasonCode: deterministic codes from logged gates, cascade order", () => {
  assert.equal(reasonCode(null).code, "NOT_IN_UNIVERSE");
  assert.equal(reasonCode(rec([g("history_30d", false, 3)])).code, "GATED_HISTORY");
  assert.equal(reasonCode(rec([g("history_30d", true, 40), g("price_ceiling", false, 300)])).code, "GATED_PRICE_CAP");
  // rank cut with tiny 8:30 gap -> INVISIBLE_AT_0830; with real gap -> RANK_CUT
  assert.equal(reasonCode(rec([g("prelim_rank_top30", false, 200)], { gap: 0.6 })).code, "INVISIBLE_AT_0830");
  assert.equal(reasonCode(rec([g("prelim_rank_top30", false, 33)], { gap: 4.2 })).code, "RANK_CUT");
  assert.equal(reasonCode(rec([g("badge", false, "caution")])).code, "BADGE_CUT");
  assert.equal(reasonCode(rec([g("mtd_min7", false, 4)])).code, "GATED_MTD");
  assert.equal(reasonCode(rec([g("pm_dollar_2m", false, 5e5)])).code, "GATED_PMVOL");
  assert.equal(reasonCode(rec([g("top5_score", false, 61)])).code, "TOP5_CUT");
  // eligible symbols resolve through the engine result
  assert.equal(reasonCode(rec([]), { status: "declined: fall day", trades: [] }).code, "DECLINED");
  assert.equal(reasonCode(rec([]), { status: "traded", trades: [{ pnl: 5 }] }).code, "TRADED");
  assert.equal(reasonCode(rec([]), { status: "qualified, no trigger", trades: [] }).code, "NO_TRIGGER");
});

test("attribute: movers detected, joined to telemetry, catch rates computed", () => {
  const telemetry = new Map([
    ["WIN", { sym: "WIN", gap: 3, prevClose: 100, gates: [], cls: "rider" }],
    ["MISS", { sym: "MISS", gap: 0.4, prevClose: 50, gates: [{ gate: "prelim_rank_top30", pass: false, value: 99 }], cls: "caution" }],
    ["FLAT", { sym: "FLAT", gap: 0.1, prevClose: 10, gates: [], cls: "avoid" }],
  ]);
  const dayBarsMap = new Map([
    ["WIN", [mkBar("09:40", 103, 104, 102, 103), mkBar("15:50", 110, 111, 109, 110)]],   // ride ~ +6.8%
    ["MISS", [mkBar("09:40", 50, 50, 44, 45), mkBar("15:50", 44, 44, 43, 43.5)]],        // ride -13%
    ["FLAT", [mkBar("09:40", 10, 10.1, 9.9, 10), mkBar("15:50", 10, 10.1, 9.9, 10.05)]], // no move
  ]);
  const picks = [{ sym: "WIN", status: "traded", trades: [{ pnl: 250 }] }];
  const a = attribute({ day: "2026-07-02", board: { telemetry }, picks, dailies: new Map(), dayBarsMap });
  assert.equal(a.movers.length, 2);
  assert.equal(a.movers.find((m) => m.sym === "WIN").code, "TRADED");
  assert.equal(a.movers.find((m) => m.sym === "MISS").code, "INVISIBLE_AT_0830");
  assert.equal(a.catchRates.netPnl, 250);
  assert.equal(a.catchRates.tradedCatch, 100); // 1 of 1 up-movers traded
  assert.ok(a.catchRates.captureRatio > 0);
});
