import { test } from "node:test";
import assert from "node:assert/strict";
import { runScorecardCapture } from "./scan.js";

const scanResult = { topIntraday: [], likelyJump: [], likelyFall: [] } as any;
function deps(calls: string[]) {
  return {
    runPremarketScan: async () => { calls.push("scan"); return scanResult; },
    recordScanPicks: async () => { calls.push("record"); return 5; },
    gradePending: async () => { calls.push("grade"); return 3; },
  };
}

test("in the record window on a weekday -> records", async () => {
  const calls: string[] = [];
  const out = await runScorecardCapture({ minutes: 8 * 60 + 20, isWeekday: true }, deps(calls));
  assert.equal(out.action, "recorded");
  assert.equal((out as any).recorded, 5);
  assert.deepEqual(calls, ["scan", "record"]);
});

test("outside the record window -> grades", async () => {
  const calls: string[] = [];
  const out = await runScorecardCapture({ minutes: 16 * 60 + 30, isWeekday: true }, deps(calls));
  assert.equal(out.action, "graded");
  assert.equal((out as any).graded, 3);
  assert.deepEqual(calls, ["grade"]);
});

test("weekend -> grades (never records off a weekday)", async () => {
  const calls: string[] = [];
  const out = await runScorecardCapture({ minutes: 8 * 60 + 20, isWeekday: false }, deps(calls));
  assert.equal(out.action, "graded");
  assert.deepEqual(calls, ["grade"]);
});

test("a record error propagates (not swallowed)", async () => {
  const bad = { ...deps([]), recordScanPicks: async () => { throw new Error("insert failed"); } };
  await assert.rejects(() => runScorecardCapture({ minutes: 8 * 60 + 20, isWeekday: true }, bad), /insert failed/);
});
