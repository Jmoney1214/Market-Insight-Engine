import { test } from "vitest";
import assert from "node:assert/strict";
import { strategyEvidence, sessionEvidence, systemEvidence } from "./evidence.js";

// Fake read client: returns fixed journal rows for the strategy query.
function fakeDb(rows: any[]) {
  return {
    from() {
      return { select: async () => ({ data: rows, error: null }) };
    },
  };
}

// Fake read client keyed by table name (for multi-table builders).
function fakeTable(byTable: Record<string, any[]>) {
  return { from(t: string) { return { select: async () => ({ data: byTable[t] ?? [], error: null }) }; } };
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

test("sessionEvidence packs the scan_scorecard picks for the date", async () => {
  const db = fakeTable({ scan_scorecard: [
    { scan_date: "2026-07-06", symbol: "IREN", list: "intraday", gap_pct: 5.1, change_pct: 2.0, hit: true },
    { scan_date: "2026-07-06", symbol: "WULF", list: "intraday", gap_pct: 4.0, change_pct: -8.0, hit: false },
    { scan_date: "2026-07-02", symbol: "XXX", list: "jump", gap_pct: 1, change_pct: 1, hit: true },
  ] });
  const pack = await sessionEvidence(db, "2026-07-06");
  assert.deepEqual(pack.subject, { kind: "session", date: "2026-07-06" });
  assert.equal(pack.facts.filter((f) => f.source === "pick").length, 2); // only that date
  const catch_ = pack.facts.find((f) => f.source === "catchRate");
  assert.ok(catch_ && catch_.data.picks === 2 && catch_.data.hits === 1);
});

test("systemEvidence reads history_log and notes when logs are thin", async () => {
  const db = fakeTable({ history_log: [] });
  const pack = await systemEvidence(db, 24);
  assert.equal(pack.subject.kind, "system");
  assert.match(pack.note ?? "", /no .*log/i);
});

test("systemEvidence surfaces alert_level counts for the why-signal", async () => {
  const db = fakeTable({ history_log: [
    { id: 1, mode: "LIVE", alert_level: "ERROR", symbol: "IREN", created_at: "2026-07-08T13:31:00Z" },
    { id: 2, mode: "LIVE", alert_level: "ERROR", symbol: "WULF", created_at: "2026-07-08T13:32:00Z" },
    { id: 3, mode: "LIVE", alert_level: "INFO", symbol: "AAA", created_at: "2026-07-08T13:33:00Z" },
  ] });
  const pack = await systemEvidence(db, 24);
  assert.equal(pack.facts.filter((f) => f.source === "log").length, 3);
  const split = pack.facts.find((f) => f.source === "split" && f.id === "byAlertLevel");
  assert.ok(split && split.data.ERROR === 2 && split.data.INFO === 1);
});
