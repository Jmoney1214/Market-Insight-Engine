# Audit: Agentic Reality & Learning-Loop Gaps

**Date:** 2026-07-15 · **Scope:** whole repo · **Method:** two independent
read-only code audits, every claim cited to `file:line`. Diagnosis only — no code
was changed to produce this document.

## Executive verdict

Two questions were asked of the codebase, honestly:

1. **Is this an agentic system, or deterministic functions with LLM narration
   wearing "agent" names?** → **Deterministic functions.** 0 of ~24
   "agents/lenses/specialists" are actually agentic. The LLM has **0% decision
   authority** — it appears on ~6 components as a Zod-validated narrator (prose,
   one enum, a clamped score, a point-deduction) that deterministic code
   overrides before it can affect anything.
2. **Does it learn, or only capture data it never learns from?** → **1 of 5
   learning loops closes**, and that one (Kronos) is a show/hide visibility gate,
   not selection/weight learning. The other four measure outcomes rigorously,
   then dead-end at a read-only endpoint no decision ever reads.

Plain English: **a deterministic decision engine with LLM narrators and a filing
cabinet.** It is disciplined, fail-closed, and honest in its own code comments —
but it is not agentic, and it does not learn. This document is the tracked record
of exactly where and why, and the architecture to fix it.

**What NOT to rebuild:** the *measurement* half is solid — event studies
(CAR/t-test, size-matched benchmark), Kronos calibration (Brier skill score,
day-clustered binomial), judge panels, scorecard hit-rate. The reinforcement
plumbing is well-built (bounded ±15, idempotent per gradeRef, backtest-hygienic).
It is not broken; it is simply **not consumed by any decision.**

---

## Part 1 — Agentic reality (R / N / A classification)

- **(R) Rule-function** — deterministic, fixed thresholds, no LLM, no state.
- **(N) Narrator** — an LLM whose output is constrained/validated/overridden by
  deterministic code; the model never decides.
- **(A) Actually agentic** — persistent state/goals, autonomous tool use, reads &
  rebuts other agents, adapts over time.

### Committee lenses — `lib/copilot-committee/src/agents/*` — 11/11 are (R)

| Component | file:line | Class | Note |
|---|---|---|---|
| technical | `technical.ts:8` | R | price-vs-VWAP / rvol thresholds, fixed confidence arithmetic |
| pattern | `pattern.ts:8` | R | reads `triggerStack`; bias from `riskReward.direction` |
| regime | `regime.ts:12` | R | hardcoded DEGRADED; `clampConfidence(0.2)` |
| orderFlow | `orderFlow.ts:9` | R | **hardcoded `UNAVAILABLE` constant** |
| catalyst | `catalyst.ts:9` | R | **hardcoded `UNAVAILABLE` constant** |
| position | `position.ts:11` | R | switch on `thesisStatus`, fixed confidence table |
| memory | `memory.ts:14` | R | formats a pre-computed edge + a DB string; bias hardcoded NEUTRAL |
| sentiment | `sentiment.ts:12` | R | renders a pre-scored reading; "scoring happened upstream" |
| bullCase / bearCase | `bullCase.ts:10` / `bearCase.ts:10` | R | concatenate sub-read factors; `0.15*n` confidence |
| riskCritic | `riskCritic.ts:12` | R | rank-based gate escalation → BLOCK/WARN/PASS |

Orchestrator `runCommittee` (`orchestrator.ts:139`): deterministic core; the only
LLM is optional prose enrichment (`orchestrator.ts:184`) that may overwrite **3
prose fields only**, number-grounded and forbidden-language-scanned, dropped on
any failure — textbook **(N)**.

### Research specialists — `lib/research-agents/src/*`

| Component | file:line | Class | Note |
|---|---|---|---|
| Lead / `runLead` | `lead.ts:155` | R | topo-sort executor (Kahn); authors no research field |
| — planner `propose` | `lead.ts:164` | N | LLM proposes plan; `validateResearchPlan` gates; invalid → `defaultPlan` |
| catalystVerifier | `catalystVerifier.ts:125` | R | `decideVerificationStatus` deterministic decision table |
| — narrator | `catalystVerifier.ts:158` | N | LLM emits only `{eventType, eventDescription}`; rejection → deterministic quote |
| sourceGuardian | `sourceGuardian.ts:89` | R | source-class policy, entity/numeric/temporal checks |
| — entailment | `sourceGuardian.ts:161` | N | LLM emits ENTAILS/CONTRADICTS/NEUTRAL; deterministic tally + hard overrides |
| sentiment | `sentiment.ts:57` | R | `bandFromScore`; provider's own band label ignored |
| — scorer | `sentiment.ts:62` | N | LLM score+citations; citations validated against injected blocks |
| macro | `macro.ts:54` | R | **no LLM** — pure trigger router |
| dilution | `dilution.ts:44` | R | **no LLM** — lifecycle classifier + regex share extraction |
| judgePanel | `judgePanel.ts:90` | R | `scoreFromVerdict` clamps to rubric; `median` aggregates |
| — judges | `judgePanel.ts:109` | N | LLMs may only subtract points from a fixed rubric |
| contest | `contest.ts:41` | R | field-by-field diff of two records; never averages |
| accuracyRanker | `accuracyRanker.ts:57` | R | deterministic aggregation |
| eventStudy | `eventStudy.ts:36` | R | OLS market-model math |
| Kronos calibration | `kronosCalibration.ts:114` | R | pure math; the forecast model itself is external |
| Memory (FinMem) | `memory.ts` | R | pure functions; storage is Supabase |

**Actually agentic (A): 0 components.** No `maxTurns`/tool-call/ReAct loop
anywhere; no LLM output is ever fed to another LLM.

### The four questions

1. **Communication / debate / revise?** No. One-shot fan-out → deterministic
   reducer. `bullCase`/`bearCase`/`riskCritic` consume the lens output *arrays*
   (`agents/index.ts:58-75`) but no lens revises after being rebutted. The
   research "contest" is a field-diff (`contest.ts:52`) that stamps `CONFLICTED`;
   the two verifications never see each other.
2. **Persistent state / goals across runs?** No. Memory is a DB read handed in as
   an input. FinMem checkpoint/resume (`lead.ts:69-93`) is crash-recovery keyed by
   a plan **shape hash**, not learned state.
3. **Autonomous tool use?** No. Evidence is pre-fetched and bound
   (`lead.ts:46-55`); sentiment "NEVER searches" (`sentiment.ts:1`). The only
   "tool decision" is which of 6 fixed functions the validated plan includes.
4. **Real planning?** No. Validated static DAG executed by Kahn topo-sort
   (`plan.ts:63,119`). The planner can reorder/subset frozen steps; it cannot
   invent a tool, branch on a result, or loop.

---

## Part 2 — Learning loops (1 of 5 close)

Pattern across the broken loops: **outcome captured ✓ → fed into an aggregate ✓ →
aggregate exposed only on a read-only API endpoint, never consumed by scan
pick-selection or committee synthesis ✗.** Feedback dead-ends at a dashboard.

| Loop | Captured | Fed back | Changes a future decision? | Status |
|---|---|---|---|---|
| 1 · Memory reinforcement | ✓ `memoryStore.ts:181` | ✓ `importance` ±15 `memory.ts:157` | ✗ only surfaces via read-only `/memory/:symbol` `routes/memory.ts:21` | **OPEN** |
| 2 · Agent accuracy ranker | ✓ `accuracyStore.ts:33` | ✓ metrics computed | ✗ `topKAgents` is **dead code** `accuracyRanker.ts:99` | **OPEN** |
| 3 · Kronos calibration gate | ✓ `kronosStore.ts:88` | ✓ rolling report | ✓ `getGatedForecast` gates next forecast `kronosStore.ts:191` | **CLOSES** (show/hide only) |
| 4 · Judge grades → behavior | ✓ | ✓ into loops 1 & 2 | ✗ write-mostly telemetry `research.ts:35-38` | **OPEN** |
| 5 · Event-study (CAR) → reinforcement | ✓ `eventStudyGrader.ts:60` | ✓ into memory + accuracy | ✗ those aggregates feed no decision | **OPEN** |

### Two design defects independent of wiring

- **SEMANTIC promotion gates on grade-EXISTENCE, not QUALITY.** `canPromote`
  (`memory.ts:172`) requires only `schemaValid` + a non-null `independentGradeRef`,
  and `reinforceFromGrades` stamps that ref for **every** grade including bad ones
  (`memoryStore.ts:223`). A catalyst graded **wrong** (`eventSignificant=false`,
  delta −8) is still promoted to durable "validated truth."
- **`topKAgents` is dead code** — the one function whose name implies routing work
  to better agents is never called anywhere in production or wiring.

### The single missing wire

To convert capture into learning, the reinforced `importance` (Loop 1) and the
`accuracyScore`/`topKAgents` ranking (Loop 2) must be **read by an actual
decision** — scan pick-ranking or committee synthesis weighting — and the
committee `memoryAgent` must let recalled outcomes **move bias/confidence
numerically** instead of appending inert text (`memory.ts:21-22`).

---

## Part 3 — Transformation architecture

Target: **agentic *research* that learns and debates, feeding a deterministic
*risk/execution* core that stays un-foolable.** Agency around the brake, not
instead of it. LLMs never place orders (ADR 0001).

### Layer 1 — Close the learning loops (highest leverage; mostly wiring)
The measurement exists; wire it to decisions.
- Read reinforced `importance` + accuracy ranking into scan pick-ranking and
  committee synthesis weighting.
- `memoryAgent` moves bias/confidence numerically, not inert text.
- **The brake:** judge median + event-study gate the *outcome* and the *memory
  write* — a weak finding can't stamp COMPLETE, can't be memorized, can't be
  promoted. Gate SEMANTIC promotion on grade **quality**, not existence.
- Cost: days. Converts "captures data it never learns from" → "learns."

### Layer 2 — Real inter-agent communication
Shared working memory + debate protocol: agents post claims, a critic can send a
finding **back for rework**, positions revise after seeing rebuttals. Catches the
catalyst-fabrication bug (unrelated 10-Q bundled with news) that a one-shot
fan-out cannot. Cost: real build — a new agent runtime with message-passing.

### Layer 3 — Autonomous tool use
Research agents decide to **fetch more** when suspicious (pull the actual filing;
do event-time/entity matching) instead of trusting a pre-bagged blob. LLM
tool-loops belong here — in *evidence gathering*, never in the trade decision.
Cost: real build.

### Layer 4 — Agent state that persists & adapts
Agents carry forward what's worked per setup/regime; selection measurably shifts
over sessions. Built on the existing memory system — wired to change behavior.
Cost: moderate; depends on 1–2.

### Untouched — the deterministic risk/execution brake
LLMs never place orders. The paper risk/execution plane (Phase D) stays
deterministic and isolated.

---

## Cross-references

- Research-crew defect audit (catalyst fabrication, no-brake chain, latency): the
  "brake" (Layer 1) is the shared keystone.
- Integrity & runtime-wiring audit (Phase A): overlapping findings on
  event-grading, memory promotion, planner wiring.
- The Kronos gate (`kronosCalibration.ts`) is the **reference pattern** for a
  correctly-closed adaptive control loop — copy its shape for Layers 1 & 4.
