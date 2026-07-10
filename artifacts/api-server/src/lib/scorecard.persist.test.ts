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
