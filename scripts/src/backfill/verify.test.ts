import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreboardFromRows, retrieveForStrategy } from "./verify.js";

function row(r: number) {
  return { mode: "RESEARCH", manual_outcome: {
    strategyName: "JUMPDAY_RIDER", outcomeConfidence: "MANUAL_CONFIRMED",
    rMultiple: r, action: r >= 0 ? "closed" : "stop_hit" } };
}

test("seeded rows move JUMPDAY_RIDER off unproven; retrieval can read it", () => {
  const rows = [row(-1.02), row(1.04), row(0.34), row(-1.02), row(3.96)];
  const { samples, board } = scoreboardFromRows(rows);
  assert.equal(samples.length, 5);
  const got = retrieveForStrategy(board, "JUMPDAY_RIDER");
  assert.ok(got, "retrieval must return a row");
  assert.notEqual(got.status, "unproven");
  assert.equal(got.samples, 5);
});
