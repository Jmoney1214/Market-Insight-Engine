import { test } from "node:test";
import assert from "node:assert/strict";
import { etOffset, etWindow, tradingDays, parseArgs, daysBefore } from "../lib/dates.mjs";

test("DST: January is EST (-05:00), July is EDT (-04:00)", () => {
  assert.equal(etOffset("2026-01-15"), "-05:00");
  assert.equal(etOffset("2026-07-15"), "-04:00");
  // transition days 2026: DST starts Mar 8, ends Nov 1
  assert.equal(etOffset("2026-03-09"), "-04:00");
  assert.equal(etOffset("2026-11-02"), "-05:00");
});

test("etWindow builds RFC3339 with the correct per-date offset", () => {
  assert.deepEqual(etWindow("2026-01-15", "04:00", "20:00"),
    { start: "2026-01-15T04:00:00-05:00", end: "2026-01-15T20:00:00-05:00" });
  assert.deepEqual(etWindow("2026-07-15", "04:00", "20:00"),
    { start: "2026-07-15T04:00:00-04:00", end: "2026-07-15T20:00:00-04:00" });
});

test("tradingDays: weekdays only, inclusive", () => {
  assert.deepEqual(tradingDays("2026-07-01", "2026-07-06"),
    ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-06"]); // Jul 4-5 = weekend
  assert.deepEqual(tradingDays("2026-07-02", "2026-07-02"), ["2026-07-02"]);
  assert.throws(() => tradingDays("2026-07-05", "2026-07-01"));
});

test("parseArgs: range + defaults + fill validation", () => {
  const a = parseArgs(["--from", "2026-07-02", "--report"]);
  assert.equal(a.to, "2026-07-02");
  assert.equal(a.fill, "stop_first");
  assert.equal(a.report, true);
  assert.throws(() => parseArgs(["--from", "bad"]));
  assert.throws(() => parseArgs(["--from", "2026-07-02", "--fill", "nope"]));
});

test("daysBefore crosses month/year boundaries", () => {
  assert.equal(daysBefore("2026-01-05", 10), "2025-12-26");
});
