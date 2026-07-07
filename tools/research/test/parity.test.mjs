import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPair, matchBySequence, tally, hardFail, defaultPriceTol } from "../lib/parity.mjs";

// tv trade shape (adapter output): {seq, side, entryPx, exitPx, qty, grossPnl, exitReason}
// node trade shape (engine output): {entry, exit, qty, reason} (+ optional side)
const tv = (o) => ({ seq: 0, side: "long", exitReason: "close", ...o });
const node = (o) => ({ side: "long", reason: "eod", ...o });

test("classifyPair: MATCH when prices within tolerance", () => {
  const t = tv({ entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 });
  const n = node({ entry: 20.03, exit: 21.98, qty: 100 }); // both within $0.05
  assert.equal(classifyPair(t, n), "MATCH");
});

test("classifyPair: FILL_DIFF when entry px just beyond tolerance", () => {
  const t = tv({ entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 });
  const n = node({ entry: 20.06, exit: 22, qty: 100 }); // tol(20)=0.05, delta 0.06
  assert.equal(classifyPair(t, n), "FILL_DIFF");
});

test("classifyPair: EXIT_DIFF when exit px beyond tolerance", () => {
  const t = tv({ entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 });
  const n = node({ entry: 20, exit: 22.20, qty: 100 }); // tol(22)=0.05, delta 0.20
  assert.equal(classifyPair(t, n), "EXIT_DIFF");
});

test("classifyPair: missing side -> SIGNAL_MISMATCH", () => {
  assert.equal(classifyPair(tv({ entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 }), null), "SIGNAL_MISMATCH");
});

test("defaultPriceTol: max($0.05, 0.2% of px)", () => {
  assert.equal(defaultPriceTol(20), 0.05);   // 0.04 -> floored at 0.05
  assert.equal(defaultPriceTol(100), 0.2);   // 0.2% dominates
});

test("matchBySequence + tally: every verdict + drift", () => {
  const tvTrades = [
    tv({ seq: 0, entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 }),   // -> MATCH
    tv({ seq: 1, entryPx: 30, exitPx: 33, qty: 50, grossPnl: 150 }),    // -> FILL_DIFF (entry off)
    tv({ seq: 2, entryPx: 40, exitPx: 44, qty: 25, grossPnl: 100 }),    // -> EXIT_DIFF (exit off)
  ];
  const nodeTrades = [
    node({ entry: 20.02, exit: 22.01, qty: 100 }),  // within tol -> MATCH
    node({ entry: 30.20, exit: 33, qty: 50 }),      // entry 0.20 > tol 0.06 -> FILL_DIFF
    node({ entry: 40, exit: 44.30, qty: 25 }),      // exit 0.30 > tol 0.088 -> EXIT_DIFF
  ];
  const results = matchBySequence(tvTrades, nodeTrades);
  assert.deepEqual(results.map((r) => r.verdict), ["MATCH", "FILL_DIFF", "EXIT_DIFF"]);
  const { counts, drift } = tally(results);
  assert.equal(counts.MATCH, 1);
  assert.equal(counts.FILL_DIFF, 1);
  assert.equal(counts.EXIT_DIFF, 1);
  assert.equal(drift, 1); // EXIT_DIFF counts as drift, FILL_DIFF does not
});

test("matchBySequence: count mismatch emits SIGNAL_MISMATCH tv-only and node-only", () => {
  // 2 tv vs 1 node -> extra tv trade is tv-only
  const tvTrades = [
    tv({ seq: 0, entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 }),
    tv({ seq: 1, entryPx: 30, exitPx: 33, qty: 50, grossPnl: 150 }),
  ];
  const r1 = matchBySequence(tvTrades, [node({ entry: 20, exit: 22, qty: 100 })]);
  assert.equal(r1[1].verdict, "SIGNAL_MISMATCH");
  assert.equal(r1[1].side, "tv-only");

  // 1 tv vs 2 node -> extra node trade is node-only
  const r2 = matchBySequence([tvTrades[0]], [
    node({ entry: 20, exit: 22, qty: 100 }),
    node({ entry: 30, exit: 33, qty: 50 }),
  ]);
  assert.equal(r2[1].verdict, "SIGNAL_MISMATCH");
  assert.equal(r2[1].side, "node-only");
});

test("hardFail: count mismatch is a hard-fail reason", () => {
  const results = matchBySequence(
    [tv({ seq: 0, entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 }),
     tv({ seq: 1, entryPx: 30, exitPx: 33, qty: 50, grossPnl: 150 })],
    [node({ entry: 20, exit: 22, qty: 100 })],
  );
  const hf = hardFail(results, { tvCount: 2, nodeCount: 1 });
  assert.equal(hf.failed, true);
  assert.ok(hf.reasons.some((r) => /count mismatch/.test(r)));
  assert.ok(hf.reasons.some((r) => /signal mismatch/.test(r)));
});

test("hardFail: price beyond tolerance fails (FILL_DIFF is a hard-fail reason)", () => {
  const results = matchBySequence(
    [tv({ entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 })],
    [node({ entry: 20.20, exit: 22, qty: 100 })],
  );
  const hf = hardFail(results, { tvCount: 1, nodeCount: 1 });
  assert.equal(hf.failed, true);
  assert.ok(hf.reasons.some((r) => /entry px beyond tol/.test(r)));
});

test("hardFail: side mismatch fails even when prices match", () => {
  const results = matchBySequence(
    [tv({ entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 })],
    [{ entry: 20, exit: 22, qty: 100, side: "short", reason: "eod" }],
  );
  assert.equal(results[0].verdict, "MATCH"); // prices agree
  assert.equal(results[0].deltas.sideMatch, false);
  const hf = hardFail(results, { tvCount: 1, nodeCount: 1 });
  assert.equal(hf.failed, true);
  assert.ok(hf.reasons.some((r) => /side mismatch/.test(r)));
});

test("hardFail: qty/PnL differences are REPORTED but NOT hard-fails (sizing base)", () => {
  // Node fixed $25k vs Pine compounding strategy.equity => qty (and therefore
  // absolute gross PnL) differ BY DESIGN. Prices match -> MATCH, no hard-fail.
  // See research/parity-audit.md § "Sizing base".
  const results = matchBySequence(
    [tv({ entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 })],
    [node({ entry: 20, exit: 22, qty: 105 })], // gross 210, big qty + pnl delta
  );
  assert.equal(results[0].verdict, "MATCH");
  // deltas are still surfaced for the report / JSON, just not failed on.
  assert.equal(results[0].deltas.qty, 5);
  assert.equal(results[0].deltas.pnl, 10);
  const hf = hardFail(results, { tvCount: 1, nodeCount: 1 });
  assert.equal(hf.failed, false);
  assert.deepEqual(hf.reasons, []);
  assert.ok(!hf.reasons.some((r) => /qty|pnl/.test(r)));
});

test("hardFail: price beyond tol still fails even when qty matches", () => {
  const results = matchBySequence(
    [tv({ entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 })],
    [node({ entry: 20, exit: 22.30, qty: 100 })], // exit 0.30 > tol 0.05
  );
  const hf = hardFail(results, { tvCount: 1, nodeCount: 1 });
  assert.equal(hf.failed, true);
  assert.ok(hf.reasons.some((r) => /exit px beyond tol/.test(r)));
});

test("classifyPair: non-finite node exit -> EXIT_DIFF (never MATCH via NaN)", () => {
  const t = tv({ entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 });
  assert.equal(classifyPair(t, node({ entry: 20, exit: NaN, qty: 100 })), "EXIT_DIFF");
  assert.equal(classifyPair(t, node({ entry: Infinity, exit: 22, qty: 100 })), "EXIT_DIFF");
});

test("matchBySequence: non-finite node exit surfaces as EXIT_DIFF drift", () => {
  const results = matchBySequence(
    [tv({ entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 })],
    [node({ entry: 20, exit: NaN, qty: 100 })],
  );
  assert.equal(results[0].verdict, "EXIT_DIFF");
  const { drift } = tally(results);
  assert.equal(drift, 1);
});

test("hardFail: clean sequence passes", () => {
  const results = matchBySequence(
    [tv({ entryPx: 20, exitPx: 22, qty: 100, grossPnl: 200 })],
    [node({ entry: 20.01, exit: 22.01, qty: 100 })],
  );
  const { drift } = tally(results);
  const hf = hardFail(results, { tvCount: 1, nodeCount: 1 });
  assert.equal(drift, 0);
  assert.equal(hf.failed, false);
  assert.deepEqual(hf.reasons, []);
});
