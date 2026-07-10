# Scorecard Forward-Capture — Design

**Date:** 2026-07-10
**Status:** Approved design (brainstorming → spec)

## Problem

`scan_scorecard` is **empty everywhere** (0 rows, every date), so every session/catch-rate
question in the Brain Diagnostics engine reads empty. The live record→grade path is wired
(`startScanScheduler` in `scan.ts`, invoked at boot in `index.ts`), but it has never
persisted a pick. Root causes are un-observable because both writers swallow errors:

- The in-process `setInterval` scheduler only records if the server process is **alive during
  the 08:15–09:30 ET window** — fragile on a sleepy/cold-starting host.
- `recordScanPicks` and `gradePending` are **best-effort: they catch and log, never surface**.
  A year of empty scorecard produced no signal.

There is **no faithful historical source** for the scanner's real picks: the research reports
are a different artifact (`Class` taxonomy ≠ scorecard `list`; most rows are
`INVISIBLE_AT_0830 — below board thresholds`, i.e. not picks), and scan-time gap%/price
(~08:15–09:30 ET) cannot be exactly reconstructed from historical daily bars. So the scorecard
is inherently a **forward-measurement** instrument.

## Decision

**Forward-only, honest.** No historical backfill, no reconstruction. Make forward capture
**reliable and verifiable**, host-uptime-independent, via a stateless trigger endpoint an
external scheduler drives. Historical dates stay legitimately empty; the brain's honest-empty
answer for them is correct behavior, not a bug.

## Architecture

Keep `scan_scorecard` as a pure forward-measurement table. Add one stateless trigger endpoint
that an external cron drives; keep the in-process `setInterval` scheduler as a backup. The
endpoint **self-selects its job by the NY clock**, reusing the exact time logic the scheduler's
`tick()` already uses, so both paths behave identically.

```
external cron (weekdays)
  ~08:20 ET ─┐
  ~16:20 ET ─┴─> POST /scan/scorecard/run
                   ├─ weekday & 08:15–09:30 ET → RECORD: runPremarketScan(true) + recordScanPicks
                   └─ otherwise                → GRADE:  gradePending(maxDate) vs real SIP session bar
historical dates: untouched → brain reports "no picks recorded" (correct)
```

**Record vs grade — which job when, and why:**
- **Record is time-critical and irreversible** — the morning picks only exist at scan time;
  miss the window and that day's measurement is lost forever. Gated to 08:15–09:30 ET.
- **Grade is not time-critical** — the SIP session bar is final and available any time after
  the close (even days later). So grading is the safe **default** the endpoint falls back to;
  it also catches up any older ungraded rows on every call.

## Components

### `lib/scorecard.ts` (modify)
- `recordScanPicks(result, scanDate): Promise<number>` — **returns the row count** written and
  **throws on a DB error** (remove the internal swallow). The scheduler call site is already
  inside a `try/catch`, so the background path stays best-effort; the endpoint now sees the truth.
- `gradePending(maxDate): Promise<number>` — **surface the initial read failure** (throw) so the
  endpoint reports it, but keep **per-row grading resilient** (one bad symbol logs + skips, never
  aborts the batch). Return value stays the graded count.

### `lib/scan.ts` (add one function — the encapsulated decision)
- `runScorecardCapture(clock = nyClock()): Promise<CaptureResult>` — the single testable unit
  that owns the record-vs-grade decision, reusing the existing `nyClock()` / `todayNYDate()` /
  window constants (`RECORD_START`, `RECORD_END`, `GRADE_AFTER`) so it can never diverge from
  `tick()`. The `clock` param defaults to the real NY clock and is overridden in unit tests:
  - weekday & `RECORD_START ≤ minutes ≤ RECORD_END` → `runPremarketScan(true)` + `recordScanPicks`
    → `{ action: "recorded", date, recorded }`.
  - otherwise → `gradePending(maxDate)` (maxDate = today after `GRADE_AFTER`, else yesterday, same
    as `tick()`) → `{ action: "graded", graded }`. Grading with nothing pending honestly returns
    `graded: 0` — no separate "idle" state needed.
  - errors from `recordScanPicks` / `gradePending` propagate (the route surfaces them).
  - `type CaptureResult = { action: "recorded"; date: string; recorded: number } | { action: "graded"; graded: number }`.

### `routes/scan.ts` (modify — add one handler)
- `POST /scan/scorecard/run`:
  - `503 { error }` if `!scanAvailable()`.
  - else `await runScorecardCapture()` → `200` with the `CaptureResult`.
  - any thrown error → `500 { error: String(err) }` (the real reason, never fake success).

### `docs/` (add — operational)
`docs/scorecard-cron.md`: how to point an external scheduler (Replit Scheduled Deployment /
cron-job.org / GitHub Actions cron) at `POST /scan/scorecard/run`, weekdays ~08:20 and ~16:20 ET.
No auth guard (per decision) — the endpoint only runs an idempotent scan/grade and returns counts.

## Error handling

- Triggers return the **real outcome** (count) or the **real error** (`500 + detail`) — never a
  fake `200`. This is the specific flaw that hid the empty table for a year.
- The background `setInterval` scheduler stays best-effort — a throw from `recordScanPicks`/
  `gradePending` is caught by its existing `try/catch` and logged; the server never crashes.
- Per-row grade failures are logged and skipped; a single bad symbol never aborts the batch.

## Idempotency

- Record: `db.insert(...).onConflictDoNothing()` on the unique `(scanDate, symbol, list)` index —
  re-hitting the endpoint in-window never duplicates.
- Grade: `gradePending` only touches rows where `gradedAt IS NULL` — re-grading is a no-op.
- So extra cron hits (or overlap with the in-process scheduler) are harmless.

## Testing

- **Unit (`scorecard.test.ts`, fake db):**
  - `recordScanPicks` returns the written count; throws when the insert rejects.
  - `gradePending` throws on the initial read failure; skips (not aborts) a per-row grade error;
    returns the graded count.
- **`runScorecardCapture` (unit, injectable clock + fake record/grade):**
  - in-window clock → `action:"recorded"` with the recorded count;
  - out-of-window clock → `action:"graded"` with the graded count;
  - a thrown record/grade error propagates (not swallowed).
- **Route (supertest, mocked `scanAvailable` + `runScorecardCapture`):**
  - `!scanAvailable()` → `503`;
  - success → `200` passing through the `CaptureResult`;
  - a thrown error → `500` with the detail.
- **Live verify (deployment only):** on a weekday, `curl -X POST …/scan/scorecard/run` at ~08:20
  ET → `{recorded:n}`, then confirm the brain's session answer for that date returns real picks.
  **Local cannot verify end-to-end** — `scanAvailable()` needs provider keys and the DB needs
  `DATABASE_URL`, neither present locally; tests use fakes. This limitation is called out, not hidden.

## Integrity boundary (unchanged)

No historical writes, no reconstruction. `scan_scorecard` remains a measurement of **real live
picks vs real SIP outcomes**. The brain's honest-empty answer for historical dates is correct.
This preserves the "measured hit rate" meaning — the whole reason the scorecard exists.

## Out of scope

- Reconstructed/backtest historical scorecard (explicitly declined in favor of forward-only).
- Auth/rate-limiting on the trigger (dropped per decision; revisit if abuse appears).
- Fixing host uptime itself (operational; the endpoint + external cron route around it).
