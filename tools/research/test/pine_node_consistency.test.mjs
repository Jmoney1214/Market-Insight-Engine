// Three-way structural lock: STRATEGY_SPEC <-> Node engine <-> Pine twins.
//
// pine-reviewer checklist #6 ("thresholds must match the shipped classifier")
// was a MANUAL check. This makes it automatic: if a Pine constant drifts from
// the engine, or the engine from the spec, CI fails here instead of the desk
// trading a strategy it never backtested.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STRATEGY_SPEC as S } from "../lib/strategy_spec.mjs";
import { THRESHOLDS, EXEC } from "../lib/engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pineDir = join(here, "..", "..", "pine");
const readPine = (f) => readFileSync(join(pineDir, f), "utf8");

// --- Pine constant extractors (default value of input.* / assignment) ---
const num = (src, name) => {
  // Tolerate optional whitespace before the paren: input.float (1.5) too.
  const m = src.match(new RegExp(`${name}\\s*=\\s*input\\.(?:float|int)\\s*\\(\\s*([0-9.eE_]+)`));
  return m ? Number(m[1].replace(/_/g, "")) : undefined;
};
const sess = (src, name) => {
  const m = src.match(new RegExp(`${name}\\s*=\\s*input\\.session\\(\\s*"([0-9-]+)"`));
  return m ? m[1] : undefined;
};
const assign = (src, name) => {
  const m = src.match(new RegExp(`${name}\\s*=\\s*([0-9.]+)`));
  return m ? Number(m[1]) : undefined;
};
const ema = (src, len) => new RegExp(`ta\\.ema\\(close,\\s*${len}\\)`).test(src);

const RIDER = "morning_scan_jumpday_long.pine";
const SCALPER = "morning_scan_largecap_scalper.pine";

test("engine THRESHOLDS are derived from the spec (no fork)", () => {
  assert.equal(THRESHOLDS.gap, S.scan.gapUpMin);
  assert.equal(THRESHOLDS.mtdMin, S.scan.mtdMin);
  assert.equal(THRESHOLDS.rangeDay, S.scan.rangeThresh);
  assert.equal(THRESHOLDS.pmDollarMin, S.scan.pmDollarMin);
  assert.equal(THRESHOLDS.priceCeil, S.scan.priceCeil);
  assert.equal(THRESHOLDS.riderRange, S.klass.riderRange);
  assert.equal(THRESHOLDS.riderPriceFloor, S.klass.riderPriceFloor);
  assert.equal(THRESHOLDS.scalperDollarVol, S.klass.scalperDollarVol);
  assert.equal(THRESHOLDS.cautionRange, S.klass.cautionRange);
});

test("engine EXEC constants match the spec (percent<->fraction mapped)", () => {
  assert.equal(EXEC.equity, S.exec.equity);
  assert.equal(EXEC.riskPct, S.exec.riskPct);
  assert.equal(EXEC.stopBuf, S.exec.stopBufPct);
  assert.equal(EXEC.notionalCap, S.exec.notionalCapPct / 100);
  assert.equal(EXEC.commPct, S.exec.commissionPct / 100);
});

for (const file of [RIDER, SCALPER]) {
  test(`${file}: scan + execution constants match the spec`, () => {
    const src = readPine(file);
    assert.equal(src.startsWith("//@version=6"), true, "must be Pine v6");

    // Scan filter — shared by both twins.
    assert.equal(num(src, "gapUpMin"), S.scan.gapUpMin, "gapUpMin");
    assert.equal(num(src, "mtdMin"), S.scan.mtdMin, "mtdMin");
    assert.equal(num(src, "mtdLookback"), S.scan.mtdLookback, "mtdLookback");
    assert.equal(num(src, "pmDollarMin"), S.scan.pmDollarMin, "pmDollarMin");

    // Execution — shared.
    assert.equal(num(src, "stopBufPct"), S.exec.stopBufPct, "stopBufPct");
    assert.equal(num(src, "riskPct"), S.exec.riskPct, "riskPct");
    assert.equal(num(src, "notionalCap"), S.exec.notionalCapPct, "notionalCap");
    assert.equal(num(src, "dayLoss"), S.exec.dailyLossLimit, "dayLoss");
    assert.equal(assign(src, "initial_capital"), S.exec.equity, "initial_capital");
    assert.equal(assign(src, "commission_value"), S.exec.commissionPct, "commission");
    assert.equal(assign(src, "slippage"), S.exec.slippageTicks, "slippage");

    // Sessions — the long-only entry window + hard EOD flatten.
    assert.equal(sess(src, "entrySess"), S.session.entry, "entry window");
    assert.equal(sess(src, "flatSess"), S.session.flatten, "flatten window");

    // Indicators.
    assert.equal(ema(src, S.indicators.emaFast), true, "9-EMA present");
    assert.equal(ema(src, S.indicators.emaSlow), true, "20-EMA present");
  });
}

test("rider twin: single trade, rrTarget default 0 (rides to flatten)", () => {
  const src = readPine(RIDER);
  assert.equal(num(src, "rrTarget"), S.classes.rider.rrTarget, "rider rrTarget default (0 = ride)");
  assert.equal(num(src, "maxTrades") ?? 1, S.classes.rider.maxTrades, "rider maxTrades");
});

test("scalper twin: multi-trade with a fixed RR target matching the spec", () => {
  const src = readPine(SCALPER);
  assert.equal(num(src, "rrTarget"), S.classes.scalper.rrTarget, "scalper RR target");
  assert.equal(num(src, "maxTrades"), S.classes.scalper.maxTrades, "scalper maxTrades");
});
