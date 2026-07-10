// Backtest-truth regression tests — the bugs the #22 audit fixed in engine.mjs but left in
// class_backtest.mjs, plus the residual engine.mjs gap-through side-selection bug.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveIntrabar } from "../lib/engine.mjs";
import { resolveExit, cacheKey } from "../class_backtest.mjs";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

// --- engine.mjs #19: gap-through at the open overrides fillMode ---
test("resolveIntrabar: gap-through the level at the open beats the fillMode pick", () => {
  // bar OPENS at/below the stop (98 <= 99): stop is unavoidable-first even in target_first
  const gapDn = { o: 98, h: 104, l: 97, c: 103 };
  assert.equal(resolveIntrabar(gapDn, 99, 103.5, "target_first"), "stop");
  assert.equal(resolveIntrabar(gapDn, 99, 103.5, "tv_ohlc_path"), "stop");
  // bar OPENS at/above the target (104 >= 103.5): target first even in stop_first
  const gapUp = { o: 104, h: 105, l: 98, c: 99 };
  assert.equal(resolveIntrabar(gapUp, 99, 103.5, "stop_first"), "target");
  // regression guard: a bar that straddles both levels but opens BETWEEN them still uses fillMode
  const inside = { o: 100, h: 104, l: 98, c: 103 };
  assert.equal(resolveIntrabar(inside, 99, 103.5, "target_first"), "target");
  assert.equal(resolveIntrabar(inside, 99, 103.5, "stop_first"), "stop");
});

// --- class_backtest.mjs #4: gap-through stop fills at the (worse) open, not the stop price ---
test("resolveExit: gap-down through the stop fills at the open minus slip", () => {
  const pos = { entry: 100, stop: 99, tgt: 103, qty: 10 };
  const ex = resolveExit({ o: 97, h: 98, l: 96, c: 97.5, hm: "11:00" }, pos, 0.05, "15:55");
  assert.equal(ex.reason, "stop");
  near(ex.exit, 96.95);            // min(99,97)-0.05 — NOT the untraded 99-0.05
  // a normal stop touch (open above the stop) still fills at the stop minus slip
  const ex2 = resolveExit({ o: 100.2, h: 100.3, l: 98.5, c: 99.2, hm: "11:00" }, pos, 0.05, "15:55");
  near(ex2.exit, 98.95);
});

// --- class_backtest.mjs #14: EOD time-flatten is a market sell -> slipped ---
test("resolveExit: time-flatten books close minus slip, not the raw close", () => {
  const pos = { entry: 100, stop: 95, tgt: 110, qty: 10 };
  const ex = resolveExit({ o: 101, h: 102, l: 100.5, c: 101.5, hm: "15:55" }, pos, 0.05, "15:55");
  assert.equal(ex.reason, "flat");
  near(ex.exit, 101.45);           // 101.5 - 0.05
});

test("resolveExit: no level hit and before flat time returns null", () => {
  const pos = { entry: 100, stop: 95, tgt: 110, qty: 10 };
  assert.equal(resolveExit({ o: 101, h: 102, l: 100.5, c: 101.5, hm: "11:00" }, pos, 0.05, "15:55"), null);
});

// --- class_backtest.mjs #3: cache key includes the window (no cross-window collision) ---
test("cacheKey: distinct date windows produce distinct keys", () => {
  const a = cacheKey("NVDA", "5Min", "2025-08-01T00:00:00Z", "2026-07-02T23:59:00Z");
  const b = cacheKey("NVDA", "5Min", "2026-01-01T00:00:00Z", "2026-07-02T23:59:00Z");
  assert.notEqual(a, b);
  assert.equal(a, "NVDA_5Min_2025-08-01_2026-07-02.json");
});
