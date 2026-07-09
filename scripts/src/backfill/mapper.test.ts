import { test } from "node:test";
import assert from "node:assert/strict";
import { toStagedRow, actionFromReason, timeWindowFromHm } from "./mapper.ts";

const base = {
  symbol: "MSTR", date: "2026-07-02", cls: "rider", entryHm: "10:10",
  entry: 400, exit: 390, stop: 395, pnl: -239, rMultiple: -2, reason: "stop",
  configHash: "engine@f3e6548", gitSha: "f3e6548", reportRef: "research/reports/2026-07-02_2026-07-02.md",
};

test("action mapping is exact and whitelist-only", () => {
  assert.equal(actionFromReason("stop"), "stop_hit");
  assert.equal(actionFromReason("target"), "target_hit");
  assert.equal(actionFromReason("eod"), "closed");
  assert.equal(actionFromReason("data-end"), "closed");
});

test("time window buckets from entry hm", () => {
  assert.equal(timeWindowFromHm("09:45"), "open");
  assert.equal(timeWindowFromHm("10:10"), "morning");
  assert.equal(timeWindowFromHm("15:10"), "power_hour");
});

test("rider candidate maps to a COUNTABLE JUMPDAY_RIDER row with provenance", () => {
  const r = toStagedRow(base);
  assert.equal(r.mode, "RESEARCH");
  assert.equal(r.countable, true);
  assert.equal(r.dropReason, null);
  assert.equal(r.manualOutcome.strategyName, "JUMPDAY_RIDER");
  assert.equal(r.manualOutcome.action, "stop_hit");
  assert.equal(r.manualOutcome.outcomeConfidence, "MANUAL_CONFIRMED");
  assert.equal(r.manualOutcome.source, "replay_rerun");
  assert.equal(r.manualOutcome.gitSha, "f3e6548");
  assert.equal(r.dedupKey, "MSTR|2026-07-02|JUMPDAY_RIDER|10:10");
});

test("unknown class is dropped, never journaled", () => {
  const r = toStagedRow({ ...base, cls: "caution" });
  assert.equal(r.countable, false);
  assert.ok((r.dropReason ?? "").length > 0);
});
