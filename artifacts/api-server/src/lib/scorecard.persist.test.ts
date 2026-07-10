import { test } from "node:test";
import assert from "node:assert/strict";
import { recordScanPicks } from "./scorecard.js";

const scanResult = {
  topIntraday: [{ symbol: "IREN", score: 9, gapPct: 5.1, price: 12.3 }],
  likelyJump: [{ symbol: "WULF", score: 7, gapPct: 4.0, price: 8.1 }],
  likelyFall: [],
} as any;

// Fake db whose insert chain resolves RETURNING to `insertedCount` synthetic rows,
// or rejects when handed an Error.
function fakeInsertDb(insertedCount: number | Error) {
  return {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (insertedCount instanceof Error) throw insertedCount;
            return Array.from({ length: insertedCount }, (_, i) => ({ id: i + 1 }));
          },
        }),
      }),
    }),
  } as any;
}

test("recordScanPicks returns the count of newly-inserted rows", async () => {
  const n = await recordScanPicks(scanResult, "2026-07-10", fakeInsertDb(2));
  assert.equal(n, 2);
});

test("recordScanPicks returns 0 when everything conflicts (already recorded)", async () => {
  const n = await recordScanPicks(scanResult, "2026-07-10", fakeInsertDb(0));
  assert.equal(n, 0);
});

test("recordScanPicks throws when the insert rejects (no silent swallow)", async () => {
  await assert.rejects(
    () => recordScanPicks(scanResult, "2026-07-10", fakeInsertDb(new Error("db down"))),
    /db down/,
  );
});

import { gradePending } from "./scorecard.js";

const pendingRow = { id: 1, symbol: "IREN", scanDate: "2026-07-09", list: "intraday", gapPct: 5.1, priceAtScan: 12.3 };
const bar = { high: 13, low: 12, close: 12.8 };

function fakeGradeDb(opts: { readThrows?: boolean; updateThrows?: boolean; rows?: any[] }) {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => {
      if (opts.readThrows) throw new Error("read failed");
      return opts.rows ?? [pendingRow];
    } }) }) }),
    update: () => ({ set: () => ({ where: async () => {
      if (opts.updateThrows) throw new Error("write failed");
    } }) }),
  } as any;
}

test("gradePending throws when the pending read fails (surfaced, not swallowed)", async () => {
  await assert.rejects(
    () => gradePending("2026-07-10", { database: fakeGradeDb({ readThrows: true }), getSessionBar: (async () => bar) as any }),
    /read failed/,
  );
});

test("gradePending grades a row against the session bar", async () => {
  const n = await gradePending("2026-07-10", { database: fakeGradeDb({ rows: [pendingRow] }), getSessionBar: (async () => bar) as any });
  assert.equal(n, 1);
});

test("gradePending skips (does not abort) when a per-row write fails", async () => {
  const n = await gradePending("2026-07-10", {
    database: fakeGradeDb({ rows: [pendingRow, { ...pendingRow, id: 2 }], updateThrows: true }),
    getSessionBar: (async () => bar) as any,
  });
  assert.equal(n, 0); // both writes failed but the call still resolved
});

test("gradePending skips (does not abort) when a per-row session-bar fetch throws", async () => {
  const row1 = { ...pendingRow, id: 1, symbol: "IREN" };
  const row2 = { ...pendingRow, id: 2, symbol: "WULF" };
  const n = await gradePending("2026-07-10", {
    database: fakeGradeDb({ rows: [row1, row2] }),
    getSessionBar: (async (symbol: string) => {
      if (symbol === "IREN") throw new Error("bar fetch failed");
      return bar;
    }) as any,
  });
  assert.equal(n, 1); // the throw for IREN skipped that row; WULF still graded
});
