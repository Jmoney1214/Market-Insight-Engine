# Design — Agent learning loop, step 1: replay-backfill measured edge

**Date:** 2026-07-09
**Branch:** `claude/repository-analysis-synthesis-4dw5i1` (shared with a live cloud session — pull before commit, push promptly after)
**Status:** approved (Approach A + refinements), pending spec review

---

## 1. Purpose

The learning machinery exists and is tested (registry fix at `9673617`, scoreboard
137/137), but the journal holds **one non-countable row**, so the `memory` lens
reports `unproven` for every setup. This step gives the loop its first real fuel:
grade the historical replay trades from the committed harness into `journal_entries`
so the scoreboard shows **measured** win-rate / expectancy and the `memory` lens flips
from `unproven` to a real status.

**Success = the read→learn path demonstrably moves on real data:** after the backfill,
`computeScoreboard(loadJournalSamples())` returns non-zero countable samples for at
least `JUMPDAY_RIDER`, and the `memory` lens returns a measured status (expected
`no_edge` or `insufficient_sample`, per the `backtest` tier in §3.1) instead of `unproven`.

**Explicit non-goals:** no self-updating/nightly loop, no crew-agent finding
persistence, no drift-status automation. Those are later steps. No live trades are
invented — only historical replay outcomes the deterministic engine produced.

## 2. Source of truth: re-run, not `.md` parsing

The committed `.md` reports carry per-trade `$P&L` but **not** stop distance, so parsing
them yields only the flat `$/250` R approximation — which drifts on gap-through stops and
would have to be tagged `MANUAL_ESTIMATED` (non-countable). Instead:

- The deterministic engine (`tools/research/lib/engine.mjs`) already holds `pos.entry`
  and `pos.stop` when it records a trade. A **~2-line additive change** emits `stop` and
  `rMultiple = (exit − entry) / (entry − stop)` on each trade record.
- Re-running the 8 report dates with the **current** engine reproduces the trade set with
  **exact realized R** → every traded row is `MANUAL_CONFIRMED`-eligible (countable).
- The re-run uses the current engine, which includes the batch-1 gap-through-stop + EOD-
  slippage fixes merged **after** these reports were written (`e235709`). So re-run P&L may
  differ slightly from the stale `.md` — **that is correct**, the fixed engine is more
  honest. The `.md` files become a **cross-check**, not the R source.

**Engine change is committed, not scratch.** Emitting `stop` + `rMultiple` is output
enrichment, not a rule change: the Pine twin and the Pine↔Node parity contract are
untouched. The commit message states this explicitly. The report writer
(`tools/research/lib/report.mjs`) carries the two new fields too.

**Keys:** re-running needs `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` / `FMP_API_KEY`
in env as normal harness operation. If unset, **stop and tell the user** — never hardcode
or touch key files.

## 3. Data model — the `manual_outcome` payload

Each backfilled `journal_entries` row (schema `lib/db/src/schema/journalEntries.ts`):

| column | value |
|---|---|
| `mode` | `"RESEARCH"` → sample kind `backtest` (ceiling `backtested_only`) — see §3.1 |
| `symbol` | trade symbol |
| `event_timestamp` | session date + entry time, stored **as UTC (with offset)** so the dedup SELECT-then-skip can't miss across a DST boundary |
| `manual_outcome` (jsonb) | the sample + provenance (below) |
| `notes` | human-readable one-liner (e.g. `"MSTR rider 10:10→10:25 stop"`) |

`manual_outcome` JSON:
```json
{
  "strategyName": "JUMPDAY_RIDER" | "LARGECAP_SCALPER",
  "outcomeConfidence": "MANUAL_CONFIRMED",
  "rMultiple": -0.96,
  "pnlDollars": -239,        // price-based R and $ diverge by commission — carry both
  "action": "stop_hit" | "target_hit" | "closed",
  "regime": "TREND_DAY" | ... | null,
  "timeWindow": "open" | "morning" | "midday" | "afternoon" | "power_hour" | null,
  "source": "replay_rerun",
  "configHash": "62eae2594331",
  "gitSha": "9673617",  // git HEAD of the engine used for the re-run, stamped at runtime
  "reportRef": "research/reports/2026-07-02_2026-07-02.md"
}
```

**Mappings (zero invented strings):**
- `strategyName`: rider class → `JUMPDAY_RIDER`, scalper class → `LARGECAP_SCALPER`. Any
  other class is not a registered promotable hypothesis → **not journaled** (the pre-
  validation step catches it; we skip it upstream to save the round trip).
- `action` from engine `reason`: `stop` → `stop_hit`, `target` → `target_hit`,
  `eod`/flatten → `closed`. (Whitelist confirmed: `closed, manually_tracked, target_hit,
  stop_hit`.)
- `regime` / `timeWindow`: best-effort enrichment (nullable, not required for
  countability). `regime` via `computeRegime(barsUpToEntry)`; `timeWindow` from `entryHm`.
- **Provenance stamp** (`source`/`configHash`/`gitSha`/`reportRef`): the audit-trail
  requirement — anyone can later reproduce exactly which engine produced which R.

### 3.1 Evidence tier — `backtest`, not `paper` (second-reader block, resolved)

These sessions were **studied during development** — July 2 and July 6 were dissected in
postmortems and the engine/classifier was iterated with full knowledge of them. That is
backtest evidence, not forward paper trades. Mapping them to `mode: "REPLAY"` (kind
`paper`) would place them in the out-of-sample bucket, where 20 countable samples with
edge reach **`paper_validated` — which unlocks L4 alerts** (`event.ts:58`) — *from
development-era backtests alone*, shortcutting the very ladder the system exists to
enforce.

**Default: `mode: "RESEARCH"` → kind `backtest` → status ceiling `backtested_only`.**
`paper_validated` / L4 can then only ever be earned by trades taken **going forward, after
the config froze** — the definition of out-of-sample. Distinguishability is unaffected:
the scoreboard already tracks `forwardSampleCount` vs `paperSampleCount` vs backtest
separately, and the provenance stamp marks every row `replay_rerun`.

**Escape hatch (explicit human decision, never a field default):** if a *specific* report
date was a genuine post-config-freeze walk-forward (config demonstrably frozen before that
date), the human may reclassify that date's rows to `REPLAY`/paper **at the staging step**.
The tier is shown per-date in the staging table so this is a deliberate choice, not an
inherited mapping.

## 4. Components (each independently testable)

1. **Engine enrichment** — `engine.mjs record()` emits `stop` + `rMultiple`; `report.mjs`
   carries them. *Interface:* trade objects gain two fields. *Depends on:* nothing new.
2. **Backfill extractor** — re-runs the harness over the 8 report dates, returns candidate
   sample rows with true R + provenance. *Interface:* `extractReplayTrades(dates) →
   CandidateRow[]`. *Depends on:* enriched engine, Alpaca keys.
3. **Diff gate** — cross-checks re-run trades vs the committed `.md` on `(symbol, date,
   entryHm)`. Same trades / slightly different P&L = OK. **A trade appearing or
   disappearing halts staging with an explanation** (a gap-through-stop fill difference is a
   legitimate, reportable divergence). The final count may not equal 26 — journal what the
   fixed engine says and report the delta; never force the old count.
4. **Sample mapper + pre-validation** — maps each candidate to the `manual_outcome` shape
   and runs it through the real `journalOutcomeToSample()`; any row that would be dropped is
   surfaced, never silently written. *Interface:* `toSampleRow(candidate) → {row, countable,
   reason}`.
5. **Staging + human confirmation** — prints all candidate rows (symbol, date, strategy,
   **R and $P&L both**, action, tier, countable?) as a table for review. **This review IS
   the `MANUAL_CONFIRMED` act** — the script never auto-writes on a green diff; it waits for
   explicit "write it." The per-date tier column is where the §3.1 escape hatch is exercised.
6. **Writer** — idempotent insert into `journal_entries` via the Supabase connector.
   Dedup key `(symbol, session date, strategy, entryHm)` checked against existing rows
   (SELECT-then-skip); a rerun cannot double-write. No keys handled by the assistant.
7. **Verifier** — after write, re-runs `computeScoreboard(loadJournalSamples())` and prints
   the per-hypothesis table + the `memory` lens output, showing `unproven → no_edge`
   (or `insufficient_sample`) with real, measured expectancy.

## 5. Data flow

```
8 report dates
  → [extractor] re-run current engine → candidate trades (true R, provenance)
  → [diff gate] vs committed .md on (symbol,date,entryHm)   ── divergence? → HALT + explain
  → [mapper+prevalidate] manual_outcome shape, prove countable via journalOutcomeToSample()
  → [staging] table printed for human review  ── the confirmation act
  → (explicit "write") → [writer] idempotent insert via connector
  → [verifier] recompute scoreboard → memory lens flips, real numbers shown
```

## 6. Error handling

- **Keys unset** → stop, tell the user, write nothing.
- **Diff-gate divergence** (trade added/removed) → halt, explain the specific trade and why
  (gap-through fill, slippage), let the user decide before staging.
- **Non-countable row** at pre-validation → surfaced in the staging table with its reason;
  not silently dropped.
- **Writer collision** on the dedup key → skipped (idempotent), logged.
- **Connector/DB unreachable** → stop after extraction+staging; the staged rows are printed
  so nothing is lost, and the write can be retried.

## 7. Testing

- **Engine enrichment:** unit test that `rMultiple` on a known synthetic trade equals
  `(exit−entry)/(entry−stop)` and that a full-stop trade is ≈ −1R.
- **Mapper:** every produced row passes `journalOutcomeToSample()` (countable) for the two
  registered strategies; a bad strategy name is dropped.
- **Idempotency:** running the writer twice against a seeded row inserts once.
- **Verifier (integration):** seed the extracted rows through `computeScoreboard` and assert
  `JUMPDAY_RIDER` moves off `unproven` with the expected sign of expectancy.

## 8. Expected outcome (don't flinch)

The ~26 trades net **≈ −$96 (12W / 14L)**. Under the `backtest` tier (§3.1) with the
default thresholds (`minBacktestSample: 20`, `minExpectancyR: 0.1`, `minPF: 1.2`):

- `JUMPDAY_RIDER`: **`no_edge`** if it crosses 20 countable samples with negative
  expectancy, otherwise **`insufficient_sample`**.
- `LARGECAP_SCALPER`: **`insufficient_sample`** (too few trades).
- Neither can reach `paper_validated` or unlock L4 from these replays — by construction.

**That is the loop working** — it is the drift signal edge-curator flagged, now measured
instead of asserted. We journal the truth and report it plainly.

## 9. Commit & coordination plan

- Commit 1: engine enrichment (`engine.mjs` + `report.mjs`) — message states it is additive
  output, Pine twin + parity contract untouched.
- Commit 2: the backfill tool (extractor / diff gate / mapper / staging / writer / verifier)
  under `tools/research/`, plus its tests.
- The journal-row writes are data, not code (via connector) — the verifier's scoreboard
  output is captured in the PR description as evidence.
- **Shared branch:** pull before the first commit, push promptly after each; the cloud
  session pulls before touching anything harness-adjacent.
