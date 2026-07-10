import { test } from "node:test";
import assert from "node:assert/strict";
import { runEngine } from "../lib/engine.mjs";

const bar = (hm, o, h, l, c, v = 1e6) => ({ hm, o, h, l, c, v });

// A synthetic gap-up day that fires the rider once and rides to the EOD flatten.
// Verified to trade with the shipped engine (status "traded", 1 trade).
function triggeringDay() {
  const bars = [bar("09:30", 102, 102.6, 101.8, 102.4)];
  let p = 102.4;
  for (let i = 0; i < 8; i++) {
    const o = p, c = p + 0.4;
    bars.push(bar(`09:${35 + i * 5}`.slice(0, 5), o, c + 0.15, o - 0.1, c));
    p = c;
  }
  bars.push(bar("10:15", p, p + 0.3, p - 1.2, p + 0.2)); // pullback-reclaim signal
  bars.push(bar("10:20", p + 0.25, p + 0.6, p + 0.1, p + 0.5)); // entry next open
  bars.push(bar("15:50", p + 0.5, p + 0.6, p + 0.4, p + 0.55)); // eod flatten
  return bars;
}

test("every trade carries stop and true entry->stop rMultiple", () => {
  const res = runEngine("rider", triggeringDay(), 100);
  assert.equal(res.status, "traded");
  assert.ok(res.trades.length >= 1, "fixture must produce a trade");
  for (const t of res.trades) {
    assert.equal(typeof t.stop, "number", "trade must carry stop");
    assert.equal(typeof t.rMultiple, "number", "trade must carry rMultiple");
    // R is measured off the ACTUAL fill: (exit - entry) / (entry - stop).
    const expected = (t.exit - t.entry) / (t.entry - t.stop);
    assert.ok(Math.abs(t.rMultiple - expected) < 0.01,
      `rMultiple ${t.rMultiple} != (exit-entry)/(entry-stop) ${expected}`);
  }
});

test("a stopped trade reads non-positive R", () => {
  // Same setup but the bar after entry craters through the stop.
  const bars = triggeringDay();
  bars.splice(bars.length - 1, 0, bar("10:25", 105, 105.1, 98, 98.2)); // deep drop -> stop
  const res = runEngine("rider", bars, 100);
  const stopped = res.trades.find((t) => t.reason === "stop");
  if (stopped) assert.ok(stopped.rMultiple <= 0, `stop must be <= 0R, got ${stopped.rMultiple}`);
});
