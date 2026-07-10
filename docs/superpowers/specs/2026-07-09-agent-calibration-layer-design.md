# Design — Agent calibration layer (Plane B), walled from strategy validation (Plane A)

**Date:** 2026-07-09
**Branch:** `claude/repository-analysis-synthesis-4dw5i1` (shared cloud session — pull before commit, push after)
**Status:** drafted from the user's 8-point spec + 2026 eval-literature grounding; pending review
**Source spec:** the `/agents` requirements (8 points), verbatim intent preserved.

---

## 1. Purpose

Give the crew agents a durable, typed track record and a calibration score — *are
they trustworthy?* — **without ever letting that score touch strategy validation or a
risk gate.** Today crew findings evaporate into chat; there is no way to ask "when
catalyst-scout says SUPPORT with 0.8 confidence, how often is it right?" This layer
answers that, and only that.

**The invariant (the whole point):** two memory planes, one wall.

| | **Plane A — strategy truth (exists)** | **Plane B — agent calibration (new)** |
|---|---|---|
| Tables | `journal_entries → validation_state` | `agent_findings → finding_grades` |
| Moved by | **confirmed** trade/replay outcomes only | agent verdicts + their realized grading |
| Grades | *strategies* (edge / expectancy / status) | *agents* (hit rate / calibration) |
| Authority | confidence, alert level, L4 | **none** — advisory readout only |
| Reads | — | **reads Plane A's scoreboard (read-only)** |
| Writes to A | — | **NEVER** |

Data flows **A → B** (an agent reads the scoreboard for context). Data never flows
**B → A** (an agent's calibration can't change a strategy's validation or unblock a
risk gate). Requirements #7 and #8 are the executable enforcement of this wall.

**Explicit non-goals / guardrails:** do NOT alter trading thresholds, filters, risk
gates, or strategy-validation logic — except to **read** existing validation status.
No agent finding creates a journal sample. No agent finding changes the scoreboard or
a validation status. This is additive; every existing test stays green.

## 2. Grounding (verified)

- Schema today: `historyLog, journalEntries, reports, scorecard, strategyRegistry,
  universe, validationState, watchlist`. No `agent_findings` / `finding_grades` →
  greenfield.
- Crew agents (`.claude/agents/*.md`) currently emit **markdown**, not typed output →
  typed persistence + retrieval-before-verdict are new contract clauses.
- No-override is already partially enforced: `guardrails.test` ("forces AVOID when
  blocked") and `committee.test` ("blocked fixtures only yield a defensive
  recommendation"). Req #8 adds a test that *calibration specifically* cannot create a
  new override path — architecturally guaranteed because the deterministic core never
  reads Plane B.
- 2026 literature alignment: layered eval (reasoning vs action separated), grader
  versioning to disentangle grader error from agent error, ECE-style confidence
  calibration. (Anthropic evals; "Grading the Grader" arXiv 2606.24839; DeepEval.)

## 3. Data model

Two new Drizzle tables (`lib/db/src/schema/`), matching the existing style
(`serial` id, `text`, `jsonb`, `timestamptz`).

### 3.1 `agent_findings` — one typed verdict per agent per event

```ts
// lib/db/src/schema/agentFindings.ts
export const agentFindingsTable = pgTable("agent_findings", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),          // groups a crew sweep (one morning/session)
  eventId: text("event_id"),                // the CopilotEvent this judged, when applicable
  agentName: text("agent_name").notNull(),  // catalyst-scout | risk-auditor | ...
  ticker: text("ticker").notNull(),
  strategyId: text("strategy_id"),          // registered hypothesis when the finding is setup-scoped
  verdict: text("verdict").notNull(),       // support | reject | neutral | unavailable
  confidence: doublePrecision("confidence").notNull(), // [0,1]
  evidence: jsonb("evidence").notNull().default([]),   // string[]
  risks: jsonb("risks").notNull().default([]),         // string[]
  provenance: jsonb("provenance").notNull().default([]), // string[] — source URLs / tape refs / file:line
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`verdict` vocabulary is fixed (`support | reject | neutral | unavailable`) — mirrors the
committee's honesty tiers. `strategyId` is nullable: a catalyst finding may be ticker-
scoped, not setup-scoped.

### 3.2 `finding_grades` — the realized outcome of a finding

```ts
// lib/db/src/schema/findingGrades.ts
export const findingGradesTable = pgTable("finding_grades", {
  id: serial("id").primaryKey(),
  findingId: integer("finding_id").notNull(),      // FK -> agent_findings.id
  realizedOutcomeWindow: text("realized_outcome_window").notNull(), // e.g. "0940-1550" | "close"
  realizedMovePct: doublePrecision("realized_move_pct"),
  followThrough: doublePrecision("follow_through"), // move in the finding's implied direction
  adverseMove: doublePrecision("adverse_move"),     // max move against
  grade: text("grade").notNull(),                   // correct | incorrect | mixed | ungradable
  calibrationBucket: text("calibration_bucket"),    // confidence bucket, e.g. "0.6-0.8"
  graderVersion: text("grader_version").notNull(),  // disentangles grader error from agent error
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`graderVersion` is mandatory: when the grading rubric improves, old grades aren't
silently reinterpreted — you can recompute and compare by version (the arXiv "Grading
the Grader" discipline). `ungradable` is a first-class grade (no realized window, halted
day, symbol delisted) — never force a grade.

## 4. Typed contract (shared type)

`lib/copilot-core/src/agentFinding.ts` (pure types + a builder + a validator, imported by
the writer and the graders — same pattern as `edgeScoreboard.ts`):

```ts
export type Verdict = "support" | "reject" | "neutral" | "unavailable";
export interface AgentFinding {
  runId: string; eventId: string | null; agentName: string; ticker: string;
  strategyId: string | null; verdict: Verdict; confidence: number;
  evidence: string[]; risks: string[]; provenance: string[];
}
export type FindingGradeLabel = "correct" | "incorrect" | "mixed" | "ungradable";
export interface FindingGrade {
  findingId: number; realizedOutcomeWindow: string; realizedMovePct: number | null;
  followThrough: number | null; adverseMove: number | null;
  grade: FindingGradeLabel; calibrationBucket: string | null; graderVersion: string;
}
```

A `validateAgentFinding()` guard (verdict in vocab, confidence in [0,1], arrays present)
rejects malformed findings at the boundary — never a silent write.

## 5. Retrieval-before-verdict (req #4) — a contract clause for every crew agent

Before an agent writes a new finding, it MUST first read (all **read-only**):
1. **its own recent findings** for this ticker/strategy (`agent_findings` where
   `agent_name = self`),
2. **its own finding_grades** (its realized track record / calibration),
3. **the current strategy scoreboard** for the `strategyId` (Plane A, via
   `computeScoreboard` — read-only).

Then the verdict must be *conditioned* on that context — e.g. "SUPPORT, confidence 0.42
— fresh catalyst but my last 8 SUPPORTs on gap-downs graded 3/8, and the strategy
scoreboard says JUMPDAY_RIDER is `no_edge`." A verdict that ignores a poor own-track-
record or a `no_edge` scoreboard is a contract violation.

This clause is added to **all** `.claude/agents/*.md` (the 8 crew agents), plus a
"Typed output" clause: alongside the human-readable report, the agent emits the
`AgentFinding` rows it wants persisted.

## 6. Postflight grading (req #5)

`postflight-analyst` gains a grading pass: for each finding whose `realizedOutcomeWindow`
has closed, compute `realizedMovePct` / `followThrough` / `adverseMove` from **Alpaca SIP**
bars (Plane-neutral market data), assign `grade` by a documented rubric, stamp
`graderVersion`, and write a `finding_grades` row. Rubric (v1):
- `correct`: verdict direction matched realized follow-through beyond a threshold.
- `incorrect`: realized move went against the verdict beyond a threshold.
- `mixed`: followed through then reversed (or vice-versa) within the window.
- `ungradable`: no clean realized window (halt, no session, insufficient bars).

Grading reads Plane A / market data and writes **only** `finding_grades` — never
`journal_entries`, never the scoreboard.

## 7. Calibration readout (req #6)

`edge-curator` gains a per-agent calibration section, computed from `agent_findings` +
`finding_grades`:
- **hit rate** = correct / (gradable findings).
- **false-positive rate** = incorrect `support` verdicts / all `support` verdicts (agent
  cried wolf).
- **false-negative rate** = incorrect `reject` verdicts / all `reject` verdicts (agent
  waved off a real move).
- **confidence calibration** = per confidence bucket (`0-0.2 … 0.8-1.0`), realized
  accuracy vs the bucket's mean stated confidence; the gap is the miscalibration (ECE-
  style). Report per agent, with sample counts and a `LOW_SAMPLE` flag under a floor.

This is a **readout** — it changes no confidence, no gate, no validation. It informs the
human (and, later, an optional advisory weighting that is itself never authoritative).

## 8. Hard-wall tests (req #7 — the load-bearing tests)

Executable enforcement of §1. All must pass:
1. Writing N `agent_findings` produces **zero** `TradeSample`s — `loadJournalSamples()` /
   `computeScoreboard()` output is byte-identical before and after. **Assert this against
   the actual live rows too:** with the real seeded `agent_findings` present in the DB,
   `loadJournalSamples()` still yields the same sample set (the seeded findings produce
   zero `TradeSample`s) — a real-data instance of this hard-wall test, not only synthetic.
2. Writing `agent_findings` + `finding_grades` does **not** change any strategy's
   `validationStatus` for any hypothesis.
3. The strategy scoreboard is a pure function of `journal_entries` only — a property test
   feeding it agent findings as if they were samples is rejected by `journalOutcomeToSample`
   (they lack the journal outcome shape; already dropped, but assert it).
4. Only `MANUAL_CONFIRMED` journal/replay outcomes move validation — re-assert the
   existing invariant with agent findings present in the same DB.

## 9. No-override test (req #8)

A finding with `verdict: "support"`, `confidence: 0.99`, from the highest-calibrated
agent, on an event carrying a hard block (`l5Blocked`), must still yield a defensive
recommendation — the deterministic core never reads Plane B, so calibration cannot reach
the gate. Assert the recommendation stays in `BLOCKED_ALLOWED_RECOMMENDATIONS`.

## 10. Components (each independently testable)

1. **Schema + migration** — `agentFindings.ts`, `findingGrades.ts`, Drizzle migration.
2. **Typed contract** — `agentFinding.ts` (types + `validateAgentFinding`), core tests.
3. **Findings writer** — persists validated `AgentFinding[]` via the DB layer; idempotent
   on `(runId, agentName, ticker, strategyId)`.
4. **Retrieval helper** — `getAgentContext(agentName, ticker, strategyId)` → `{ ownRecent,
   ownGrades, scoreboardRow }` (all read-only; scoreboard via `computeScoreboard`).
5. **Grader** — `gradeFinding(finding, bars, graderVersion)` → `FindingGrade` (pure);
   postflight persists.
6. **Calibration** — `computeCalibration(findings, grades)` → per-agent metrics (pure).
7. **Agent-contract updates** — retrieval-before-verdict + typed-output clauses in all 8
   `.claude/agents/*.md`.
8. **Hard-wall + no-override tests** — §8, §9.

## 11. Data flow

```
crew agent run
  → [retrieval] read own findings + own grades + strategy scoreboard (READ-ONLY, Plane A)
  → verdict conditioned on that context
  → [writer] persist AgentFinding rows (Plane B)               ── never touches Plane A
  ... later, after the session ...
  → [postflight grader] realized outcome from Alpaca bars → FindingGrade (Plane B)
  → [edge-curator calibration] per-agent hit/FP/FN/ECE readout (advisory)
```

## 12. Sequencing & relationship to the backfill

This is **independent of and complementary to** the approved replay-backfill plan
(`docs/superpowers/plans/2026-07-09-agent-learning-backfill.md`). The backfill fuels
Plane A (strategy truth); this builds Plane B (agent calibration). They share only the
wall. Recommended order: **backfill first** (Plane A must have real scoreboard data for
retrieval-before-verdict in §5 to read something meaningful), then this layer. But the
schema + writer + hard-wall tests (Tasks 1-3, 8-9) can land before the backfill without
conflict.
