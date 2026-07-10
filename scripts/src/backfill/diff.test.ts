import { test } from "node:test";
import assert from "node:assert/strict";
import { diffTradeSets } from "./diff.js";

const k = (symbol: string, entryHm: string) => ({ symbol, date: "2026-07-02", entryHm });

test("same trade set = all matched, no add/remove", () => {
  const r = diffTradeSets([k("MSTR", "10:10"), k("ABVX", "09:50")], [k("ABVX", "09:50"), k("MSTR", "10:10")]);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
  assert.equal(r.matched.length, 2);
});

test("a trade that now appears is flagged added; one that vanished as removed", () => {
  const r = diffTradeSets([k("MSTR", "10:10"), k("NEW", "10:00")], [k("MSTR", "10:10"), k("GONE", "11:00")]);
  assert.deepEqual(r.added, ["NEW|2026-07-02|10:00"]);
  assert.deepEqual(r.removed, ["GONE|2026-07-02|11:00"]);
});
