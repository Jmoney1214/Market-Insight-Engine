import { test } from "node:test";
import assert from "node:assert/strict";
import { strategyEvidence } from "./evidence.ts";

// Fake read client: returns fixed journal rows for the strategy query.
function fakeDb(rows: any[]) {
  return {
    from() {
      return { select: async () => ({ data: rows, error: null }) };
    },
  };
}

const rows = [
  { mode: "RESEARCH", manual_outcome: { strategyName: "JUMPDAY_RIDER", outcomeConfidence: "MANUAL_CONFIRMED", rMultiple: -1.02, action: "stop_hit", timeWindow: "morning", regime: null } },
  { mode: "RESEARCH", manual_outcome: { strategyName: "JUMPDAY_RIDER", outcomeConfidence: "MANUAL_CONFIRMED", rMultiple: 3.96, action: "closed", timeWindow: "morning", regime: null } },
];

test("strategyEvidence packs the scoreboard row + grouped trade facts, all cited", async () => {
  const pack = await strategyEvidence(fakeDb(rows), "JUMPDAY_RIDER");
  assert.deepEqual(pack.subject, { kind: "strategy", id: "JUMPDAY_RIDER" });
  const board = pack.facts.find((f) => f.source === "scoreboard");
  assert.ok(board, "expected a scoreboard fact");
  assert.equal(board.data.sampleCount, 2);
  const trades = pack.facts.filter((f) => f.source === "trade");
  assert.equal(trades.length, 2);
  assert.ok(trades.every((t) => typeof t.data.rMultiple === "number"));
});

test("strategyEvidence with no rows returns a note, not a crash", async () => {
  const pack = await strategyEvidence(fakeDb([]), "JUMPDAY_RIDER");
  assert.equal(pack.facts.filter((f) => f.source === "trade").length, 0);
  assert.match(pack.note ?? "", /no .*samples/i);
});
