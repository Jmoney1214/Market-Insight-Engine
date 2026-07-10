# Scorecard Forward-Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scan_scorecard` capture reliable and verifiable going forward — one stateless `POST /scan/scorecard/run` that self-selects record vs grade — so session/catch-rate brain questions return real data, with no historical backfill.

**Architecture:** A new `runScorecardCapture()` in `scan.ts` owns the record-vs-grade decision (reusing the scheduler's own NY-clock + window constants). `recordScanPicks`/`gradePending` in `scorecard.ts` stop swallowing DB errors and return/throw honestly. A thin `POST /scan/scorecard/run` route calls `runScorecardCapture()` and surfaces the real count/error. An external cron drives it.

**Tech Stack:** TypeScript (Express api-server) · Drizzle (`@workspace/db`, Postgres) · Alpaca SIP session bars for grading.

## Global Constraints

- **Forward-only. No historical backfill, no reconstruction.** The scorecard stays a measurement of real live picks vs real SIP outcomes. Historical dates stay empty; the brain's "no picks recorded" is correct.
- **Grading uses real SIP session bars only** (`alpaca.getSessionBar`) — never reconstructed/assumed prices.
- **Surface, never fake.** Triggers return the real count or the real error; the background scheduler stays best-effort (never crashes the server).
- **Idempotent:** record uses `onConflictDoNothing` on `(scanDate,symbol,list)`; grade only touches `gradedAt IS NULL`. Extra hits are safe.
- **Dependency injection for testability:** `recordScanPicks`/`gradePending` take the db (and `getSessionBar`) as an optional last param defaulting to the real singleton; `runScorecardCapture` takes optional `clock` + `deps`. Units test with fakes.
- **Test runner (important — this machine):** new tests use `node:test`, imported with `.js` specifiers, run via the direct tsx binary with a placeholder DB URL:
  `DATABASE_URL=postgres://test artifacts/api-server/node_modules/.bin/tsx --test <file>`
  The env prefix is set before load so `@workspace/db` (which throws at import if `DATABASE_URL` is unset) loads; its pg Pool is lazy, so nothing connects. This matches the brain module's convention in this same PR. Do **not** use `pnpm --filter exec` or `node --import tsx` (both fail on this Node 20 machine), and do **not** run vitest locally (its rollup darwin-arm64 native binary is missing — a Linux-lockfile gap; vitest still works in CI).
- **Keep the new node:test files separate** from the existing vitest `scorecard.test.ts` (which covers pure `gradeRow`) — do not mix runners in one file. Leave that file untouched.
- **Local cannot verify end-to-end:** `scanAvailable()` needs FMP+Alpaca keys and grading needs a live DB; neither present locally. Live verification lands in the deployment. Tests use fakes.
- **Shared branch** `claude/repository-analysis-synthesis-4dw5i1`: pull --rebase before first commit, push after each. Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `recordScanPicks` returns the written count and throws on DB error

**Files:**
- Modify: `artifacts/api-server/src/lib/scorecard.ts`
- Test: `artifacts/api-server/src/lib/scorecard.persist.test.ts` (new)

**Interfaces:**
- Produces: `recordScanPicks(result: ScanResult, scanDate: string, database?: typeof db): Promise<number>` — returns the count of newly-inserted rows (0 if all were duplicates); throws if the insert rejects.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/scorecard.persist.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://test artifacts/api-server/node_modules/.bin/tsx --test artifacts/api-server/src/lib/scorecard.persist.test.ts`
Expected: FAIL — current `recordScanPicks` returns `void`, has no `database` param, and swallows errors.

- [ ] **Step 3: Implement**

In `artifacts/api-server/src/lib/scorecard.ts`, replace `recordScanPicks`:

```ts
/** Record the morning's picks (idempotent — unique per day/symbol/list). Returns
 * the count of newly-inserted rows; throws on a DB error so callers can surface it. */
export async function recordScanPicks(
  result: ScanResult,
  scanDate: string,
  database: typeof db = db,
): Promise<number> {
  const rows = (["intraday", "jump", "fall"] as const).flatMap((list) => {
    const picks = list === "intraday" ? result.topIntraday : list === "jump" ? result.likelyJump : result.likelyFall;
    return picks.map((c) => ({
      scanDate,
      symbol: c.symbol,
      list,
      score: c.score,
      gapPct: c.gapPct,
      priceAtScan: c.price,
    }));
  });
  if (rows.length === 0) return 0;
  const inserted = await database
    .insert(scanScorecardTable)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: scanScorecardTable.id });
  return inserted.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://test artifacts/api-server/node_modules/.bin/tsx --test artifacts/api-server/src/lib/scorecard.persist.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/scorecard.ts artifacts/api-server/src/lib/scorecard.persist.test.ts
git commit -m "feat(scorecard): recordScanPicks returns inserted count + throws on DB error"
```

---

### Task 2: `gradePending` surfaces its read error; stays per-row resilient

**Files:**
- Modify: `artifacts/api-server/src/lib/scorecard.ts`
- Test: `artifacts/api-server/src/lib/scorecard.persist.test.ts` (append)

**Interfaces:**
- Produces: `gradePending(maxDate: string, deps?: { database: typeof db; getSessionBar: typeof alpaca.getSessionBar }): Promise<number>` — throws if the pending-rows read fails; a single per-row bar/write failure is logged and skipped (never aborts the batch); returns the graded count.

- [ ] **Step 1: Write the failing test**

Append to `artifacts/api-server/src/lib/scorecard.persist.test.ts`:

```ts
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
    () => gradePending("2026-07-10", { database: fakeGradeDb({ readThrows: true }), getSessionBar: async () => bar }),
    /read failed/,
  );
});

test("gradePending grades a row against the session bar", async () => {
  const n = await gradePending("2026-07-10", { database: fakeGradeDb({ rows: [pendingRow] }), getSessionBar: async () => bar });
  assert.equal(n, 1);
});

test("gradePending skips (does not abort) when a per-row write fails", async () => {
  const n = await gradePending("2026-07-10", {
    database: fakeGradeDb({ rows: [pendingRow, { ...pendingRow, id: 2 }], updateThrows: true }),
    getSessionBar: async () => bar,
  });
  assert.equal(n, 0); // both writes failed but the call still resolved
});
```

- [ ] **Step 2: Run to verify fail**

Run: `DATABASE_URL=postgres://test artifacts/api-server/node_modules/.bin/tsx --test artifacts/api-server/src/lib/scorecard.persist.test.ts`
Expected: FAIL — current `gradePending` has no `deps` param and swallows the read error (returns 0 instead of throwing).

- [ ] **Step 3: Implement**

In `artifacts/api-server/src/lib/scorecard.ts`, replace `gradePending` (the imports `eq, isNull, desc, and, lte` and `import * as alpaca` already exist):

```ts
/** Grade all pending rows for sessions up to and including `maxDate`. The read
 * failure is surfaced (thrown); a single per-row failure is logged and skipped. */
export async function gradePending(
  maxDate: string,
  deps: { database: typeof db; getSessionBar: typeof alpaca.getSessionBar } = {
    database: db,
    getSessionBar: alpaca.getSessionBar,
  },
): Promise<number> {
  const pending: ScanScorecardRow[] = await deps.database
    .select()
    .from(scanScorecardTable)
    .where(and(isNull(scanScorecardTable.gradedAt), lte(scanScorecardTable.scanDate, maxDate)))
    .limit(100);
  let graded = 0;
  for (const row of pending) {
    const bar = await deps.getSessionBar(row.symbol, row.scanDate);
    if (!bar) continue; // holiday/halt/no data yet — retry next pass
    const g = gradeRow(row.list as ScanList, row.gapPct, row.priceAtScan, bar);
    try {
      await deps.database
        .update(scanScorecardTable)
        .set({
          sessionClose: bar.close,
          sessionHigh: bar.high,
          sessionLow: bar.low,
          changePct: g.changePct,
          rangePct: g.rangePct,
          hit: g.hit,
          gradedAt: new Date(),
        })
        .where(eq(scanScorecardTable.id, row.id));
      graded++;
    } catch (err) {
      logger.warn({ err: String(err) }, "Scorecard grade write failed (non-fatal)");
    }
  }
  if (graded > 0) logger.info({ graded }, "Scorecard graded");
  return graded;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgres://test artifacts/api-server/node_modules/.bin/tsx --test artifacts/api-server/src/lib/scorecard.persist.test.ts`
Expected: PASS (6 tests total in the file).

- [ ] **Step 5: Confirm the scheduler still type-checks with the new signatures**

The scheduler in `scan.ts` calls `recordScanPicks(result, todayNYDate())` and `gradePending(maxDate)` — both stay valid because the new params are optional with defaults. No change needed; just confirm at the Task 5 typecheck.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/scorecard.ts artifacts/api-server/src/lib/scorecard.persist.test.ts
git commit -m "feat(scorecard): gradePending surfaces read errors, stays per-row resilient"
```

---

### Task 3: `runScorecardCapture` — the record-vs-grade decision unit

**Files:**
- Modify: `artifacts/api-server/src/lib/scan.ts`
- Test: `artifacts/api-server/src/lib/scan.capture.test.ts` (new)

**Interfaces:**
- Consumes: `recordScanPicks`/`gradePending` (Tasks 1/2), plus in-file `runPremarketScan`, `nyClock`, `todayNYDate`, `todayNY`, `RECORD_START`, `RECORD_END`, `GRADE_AFTER`, `ScanResult`.
- Produces:
  - `type CaptureResult = { action: "recorded"; date: string; recorded: number } | { action: "graded"; graded: number }`
  - `interface CaptureDeps { runPremarketScan: (refresh: boolean) => Promise<ScanResult>; recordScanPicks: (r: ScanResult, d: string) => Promise<number>; gradePending: (maxDate: string) => Promise<number>; }`
  - `runScorecardCapture(clock?: { minutes: number; isWeekday: boolean }, deps?: CaptureDeps): Promise<CaptureResult>`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/scan.capture.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify fail**

Run: `DATABASE_URL=postgres://test artifacts/api-server/node_modules/.bin/tsx --test artifacts/api-server/src/lib/scan.capture.test.ts`
Expected: FAIL — `runScorecardCapture` is not exported yet.

- [ ] **Step 3: Implement**

In `artifacts/api-server/src/lib/scan.ts`, add after `startScanScheduler`:

```ts
export type CaptureResult =
  | { action: "recorded"; date: string; recorded: number }
  | { action: "graded"; graded: number };

export interface CaptureDeps {
  runPremarketScan: (refresh: boolean) => Promise<ScanResult>;
  recordScanPicks: (result: ScanResult, scanDate: string) => Promise<number>;
  gradePending: (maxDate: string) => Promise<number>;
}

/**
 * Self-selects the scorecard job by the NY clock, reusing the same window
 * constants as the in-process scheduler so the two can never diverge:
 *  - weekday & inside the record window (08:15-09:30 ET) -> record the picks.
 *  - otherwise -> grade pending vs the real SIP session bar (safe default; a
 *    call with nothing pending honestly returns graded: 0).
 * Errors propagate so the trigger endpoint surfaces them.
 */
export async function runScorecardCapture(
  clock: { minutes: number; isWeekday: boolean } = nyClock(),
  deps?: CaptureDeps,
): Promise<CaptureResult> {
  let d = deps;
  if (!d) {
    const s = await import("./scorecard.js");
    d = { runPremarketScan, recordScanPicks: s.recordScanPicks, gradePending: s.gradePending };
  }
  const { minutes, isWeekday } = clock;
  if (isWeekday && minutes >= RECORD_START && minutes <= RECORD_END) {
    const result = await d.runPremarketScan(true);
    const date = todayNYDate();
    const recorded = await d.recordScanPicks(result, date);
    return { action: "recorded", date, recorded };
  }
  const maxDate = minutes >= GRADE_AFTER ? todayNYDate() : todayNY(-1);
  const graded = await d.gradePending(maxDate);
  return { action: "graded", graded };
}
```

Note: `todayNY(-1)` yields yesterday's NY date (same value `tick()` computes inline). `ScanResult`, `nyClock`, `todayNYDate`, `todayNY`, and the window constants already exist in this file — no new imports.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgres://test artifacts/api-server/node_modules/.bin/tsx --test artifacts/api-server/src/lib/scan.capture.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/scan.ts artifacts/api-server/src/lib/scan.capture.test.ts
git commit -m "feat(scan): runScorecardCapture — clock-driven record-vs-grade decision unit"
```

---

### Task 4: `POST /scan/scorecard/run` route + guard test

**Files:**
- Modify: `artifacts/api-server/src/routes/scan.ts`
- Test: `artifacts/api-server/src/routes/scan.run.test.ts` (new)

**Interfaces:**
- Consumes: `scanAvailable`, `runScorecardCapture` (Task 3), from `../lib/scan.js`.

- [ ] **Step 1: Write the failing test (the guard is what's locally verifiable)**

Create `artifacts/api-server/src/routes/scan.run.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";

// No FMP/Alpaca keys locally -> scanAvailable() is false -> the guard returns 503.
test("POST /scan/scorecard/run returns 503 when providers are unconfigured", async () => {
  const res = await request(app).post("/scan/scorecard/run").send({});
  assert.equal(res.status, 503);
  assert.match(res.body.error ?? "", /providers not configured/i);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `DATABASE_URL=postgres://test LOG_LEVEL=silent artifacts/api-server/node_modules/.bin/tsx --test artifacts/api-server/src/routes/scan.run.test.ts`
Expected: FAIL — route not registered yet → 404, not 503.
(If importing `app.js` hard-fails locally for an unrelated reason, drop this route test and rely on Task 3's unit coverage + the deployment check in Task 5 — do NOT fake a pass. Note the substitution in the commit message.)

- [ ] **Step 3: Implement the route**

In `artifacts/api-server/src/routes/scan.ts`, extend the top import and add the handler:

```ts
import { runPremarketScan, scanAvailable, runScorecardCapture } from "../lib/scan.js";
```

```ts
router.post("/scan/scorecard/run", async (_req, res) => {
  if (!scanAvailable()) {
    res.status(503).json({ error: "Market data providers not configured (FMP + Alpaca keys required)" });
    return;
  }
  try {
    const result = await runScorecardCapture();
    res.json(result);
  } catch (err) {
    logger.error({ err: String(err) }, "Scorecard capture failed");
    res.status(500).json({ error: String(err) });
  }
});
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL=postgres://test LOG_LEVEL=silent artifacts/api-server/node_modules/.bin/tsx --test artifacts/api-server/src/routes/scan.run.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/scan.ts artifacts/api-server/src/routes/scan.run.test.ts
git commit -m "feat(scan): POST /scan/scorecard/run — cron-driven record/grade trigger"
```

---

### Task 5: Cron docs + full typecheck/build + verification note

**Files:**
- Create: `docs/scorecard-cron.md`
- Verify: whole api-server typecheck + esbuild build + full new-test run

- [ ] **Step 1: Write the operational doc**

Create `docs/scorecard-cron.md`:

```markdown
# Scorecard forward-capture — external cron

`scan_scorecard` is a forward-measurement table: it records the scanner's morning
picks and grades them after the close against the real SIP session bar. Capture is
driven by a single idempotent endpoint so it does not depend on the server process
being alive at any exact minute.

## Endpoint

`POST /scan/scorecard/run` — self-selects by the NY clock:
- weekday 08:15–09:30 ET → records the morning picks → `{ "action": "recorded", "date": "YYYY-MM-DD", "recorded": N }`
- otherwise → grades pending picks vs the SIP session bar → `{ "action": "graded", "graded": N }`
- `503` if FMP/Alpaca keys are unconfigured; `500 { error }` on a real failure (surfaced, not hidden).

Idempotent: re-hitting in-window never duplicates (unique `scanDate,symbol,list`);
grading only touches ungraded rows.

## Schedule (America/New_York, weekdays)

Point any external scheduler at the endpoint twice per trading day:
- **~08:20 ET** — records that morning's picks (must land inside 08:15–09:30).
- **~16:20 ET** — grades the day (session bar is final after 16:15).

Examples: a Replit Scheduled Deployment, cron-job.org, or a GitHub Actions `schedule`
cron issuing `curl -X POST https://<host>/scan/scorecard/run`. Because the endpoint
self-selects and is idempotent, extra hits (e.g. hourly) are harmless.

## Verify

`curl -X POST https://<host>/scan/scorecard/run` on a weekday morning should return
`{"action":"recorded","recorded":N}` with N > 0. Then the brain's session question for
that date (`pnpm run brain "what happened on YYYY-MM-DD?"`) returns the real picks.
```

- [ ] **Step 2: Typecheck (expect no NEW errors vs the copilot-core baseline)**

Run: `node_modules/.bin/tsc -p artifacts/api-server/tsconfig.json --noEmit 2>&1 | grep -E "scorecard|scan\.(ts|capture|run)|routes/scan"`
Expected: no output (the only pre-existing baseline errors are the `copilot-core/dist` TS6305s, unrelated to these files).

- [ ] **Step 3: Production build (proves the route bundles)**

Run: `node artifacts/api-server/build.mjs && grep -c "scorecard/run" artifacts/api-server/dist/index.mjs`
Expected: build exits 0; the grep prints a count ≥ 1.

- [ ] **Step 4: Run the full new-test set once more**

Run: `DATABASE_URL=postgres://test LOG_LEVEL=silent artifacts/api-server/node_modules/.bin/tsx --test artifacts/api-server/src/lib/scorecard.persist.test.ts artifacts/api-server/src/lib/scan.capture.test.ts artifacts/api-server/src/routes/scan.run.test.ts`
Expected: all pass (Tasks 1–4 green together).

- [ ] **Step 5: Commit**

```bash
git add docs/scorecard-cron.md
git commit -m "docs(scorecard): external-cron setup for forward capture"
```

- [ ] **Step 6: Deployment verification (note, not a local step)**

Local cannot exercise the record/grade path end-to-end (no provider keys, no live DB).
After deploy, hit `POST /scan/scorecard/run` on a weekday morning, confirm `recorded > 0`,
then confirm the brain returns real picks for that date. Report the real result — never
simulate it.

---

## Known cross-runner note (flag, do not silently break CI)

The repo's `test` script is `vitest run` with `include: ["src/**/*.test.ts"]`, which also
globs the new `node:test` files (and the brain module's). vitest does not execute the
`node:test` API. If CI runs `vitest run`, add these files (and `src/lib/brain/*.test.ts`) to
the vitest `exclude`, or migrate them to vitest once its local rollup native binary is
restored. This plan uses `node:test`+tsx because it is the only runner that executes on the
current machine; the choice is called out, not hidden.

## Self-Review

**Spec coverage:** §Architecture (self-selecting endpoint) → Tasks 3+4. §Components: `recordScanPicks` count/throw → Task 1; `gradePending` surface-read/per-row-resilient → Task 2; `runScorecardCapture` → Task 3; route → Task 4; docs → Task 5. §Error handling (surface; best-effort scheduler untouched) → Tasks 1/2/4. §Idempotency → Global Constraints + Task 1 `.returning()` on `onConflictDoNothing`. §Testing (DI + fakes, deployment-only live) → each task + Task 5. §Integrity boundary (no backfill) → Global Constraints. **No gaps.**

**Placeholder scan:** no TBD/"handle errors"/"similar to". Task 4 Step 2 names a concrete fallback (unit coverage + deployment check) rather than a vague "make it work".

**Type consistency:** `CaptureResult`/`CaptureDeps`/`runScorecardCapture` (Task 3) consumed by the route (Task 4). `recordScanPicks: … Promise<number>` (Task 1) and `gradePending: … Promise<number>` (Task 2) match the `CaptureDeps` signatures in Task 3. The `database: typeof db` / `deps` defaults keep the scheduler's existing calls (`recordScanPicks(result, date)`, `gradePending(maxDate)`) valid.
```
