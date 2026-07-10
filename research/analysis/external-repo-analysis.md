# Analysis: grafting the external trading-skill repos onto our build

**Scope:** meticulous fact-check of the `repo_level_comparison.md` claims against our actual code, then a grounded, safety-preserving implementation plan. Verified against `main @ e235709`.

---

## Executive verdict

The doc is **directionally right and unusually well-researched** — but it makes **one factual error that halves the work**, and its headline thesis **independently corroborates the #1 finding of our own adversarial audit**. That convergence is the strongest signal in the whole document.

- **Two independent sources, same conclusion.** The doc (analyzing us from outside) says our biggest weakness is *"the missing live feedback loop… memoryAgent is unavailable."* Our 9-seam audit (analyzing us from inside) independently flagged: `history_log` has no writer, the scorecard records a broken denominator, and nothing feeds research results back into the live read. **Both fingered the memory/feedback loop as the core gap.** That makes it the unambiguous #1 priority.

- **The error that matters:** the doc's Phase-2 says *"Add tables: strategy_registry, validation_state, copilot_events, journal_entries."* **They already exist** — `lib/db/src/schema/{strategyRegistry,validationState,journalEntries,historyLog,scorecard}.ts` are all built. The work is **not** building a memory layer; it's **wiring the one that's already there.** That's a surgical connect-the-pipes job, not a greenfield build.

---

## Fact-check: every claim about our repo

| Doc claim | Reality | Verdict |
|---|---|---|
| `memoryAgent` is UNAVAILABLE | `memory.ts` self-reports `status: "UNAVAILABLE"`, confidence 0, "no journal/validation sample wired" | ✅ TRUE |
| `regimeAgent` is DEGRADED | `regime.ts` self-reports `status: "DEGRADED"`, infers from rvol/volume proxies only | ✅ TRUE |
| Credibility = `0.35×primary + 0.10×refinement` | `triggers.ts:670`: `Math.min(1, 0.35*primary.length + 0.1*refinement.length)` | ✅ TRUE (exact) |
| `ValidationSnapshot` exists (status/sampleCount/expectancyR) | `types.ts:75-78` — exact fields present | ✅ TRUE |
| 10-agent committee w/ defined order + safety orchestration | Confirmed (technical…risk_critic; guardrails re-validate) | ✅ TRUE |
| "Add tables strategy_registry / validation_state / journal_entries" | **All three schemas already exist** | ❌ FALSE — they're built |
| No `regime.ts` in copilot-core | Correct — core has no deterministic regime classifier | ✅ TRUE (real gap) |
| `journal_entries` needs a writer | Has one (`journal.ts:50` inserts) | ⚠️ Partly — journal writes; history_log doesn't |
| Alpaca SIP only / FMP enrichment / no-execution / LLM prose-only | All confirmed, all still holding | ✅ TRUE |

**Net:** the doc understands our architecture correctly. Its only real miss is assuming the persistence layer is absent when it's present-but-unwired.

---

## The one thing that matters: wire the memory loop (it's 80% built)

What actually exists vs. what's disconnected:

| Piece | State | Gap |
|---|---|---|
| `ValidationSnapshot` type + `DEFAULT_VALIDATION` placeholder | ✅ built | Nothing computes a *real* one from research |
| `validation_state` table | ✅ built | **No writer** — research results never persist here |
| `edgeScoreboard.ts` / `strategyLab.ts` in core | ✅ built | Compute edge, but not wired to persist → event |
| `journal_entries` table + writer | ✅ built + writes | Not read back into the event/memory agent |
| `history_log` table | ✅ built | **No writer** (audit confirmed) — feed permanently empty |
| `scorecard` writer | ✅ writes | Records union-of-boards (audit: broken denominator) |
| `memoryAgent` | ✅ built | Reads `event.gates.validation` only — which is the placeholder |

**The wiring path (this is the whole ballgame):**
```
tools/research (pipeline.mjs / scorecard grading)
   → compute per-strategy expectancyR + sampleCount + status
   → persist into validation_state  (NEW writer, ~1 file)
   → getValidationSnapshot(symbol/strategy) at event-build time  (NEW read, ~1 call)
   → BuildEventInput.validation = real snapshot instead of DEFAULT_VALIDATION
   → memoryAgent flips UNAVAILABLE → real measured edge
   → credibility can finally use measuredEdgeScore (Phase 4)
```
Everything downstream (the doc's Phases 4 & 5) **depends on this** — you can't weight credibility by "measured edge" until measured edge is flowing. So this is not just #1 by value, it's #1 by dependency.

---

## Per-repo idea assessment (fit · safety · effort)

### 1. `tradermonty` — workflow packaging + trade-memory + strict backtest standard
- **Steal:** the **`.claude/workflows/*` manifest layer** (premarket-scan, live-read, postmarket-grading, trade-memory-loop) — turns Claude's routes from improvised into contracted. Low effort, real ROI. **Also steal the backtest-evaluator standard** (min 30 trades / 100+ preferred, multi-regime, 1.5–2× slippage, walk-forward) as a written agent contract — our `backtest-runner` already *does* most of this; codifying it prevents drift.
- **Fit:** high. **Safety:** neutral (docs/process). **Effort:** low.
- **Caveat:** their "5–10 years of data" standard is for *swing/EOD* strategies. Ours is *intraday PIT* — our equivalent is "N sessions across regimes," not calendar years. Adopt the *rigor*, translate the *units*.

### 2. `JoelLewis` — risk taxonomy + data governance
- **Steal (high value, already motivated):** a **portfolio-risk module** — open risk, daily-max-loss, loss-streak, **symbol correlation**, drawdown halt. This directly solves the problem I flagged live this morning: IREN/WULF/CIFR are all one BTC bet, so "1% each × 3" is really ~3% correlated risk. A correlation-aware heat check is a concrete, needed upgrade.
- **Steal (cheap, auditable):** **data-governance labels** on `feedQuality` (provider, feed, delayed/live, missing-field count, stale-field count, exception state). Makes our existing hard-blocks (`DATA_FAILURE`, `STALE_QUOTE`, `WIDE_SPREAD`) *explainable*.
- **Reject:** the full 84-skill wealth/compliance/advisory sprawl — irrelevant to an intraday terminal.
- **Fit:** medium-high. **Safety:** positive (more gates). **Effort:** medium.

### 3. `ScientiaCapital` — regime-first + confluence scoring
- **Steal (structure only):** **deterministic regime classification** in core (`OPENING_DRIVE / ORB_WINDOW / TREND_DAY / RANGE_DAY / CHOP / LOW_VOL_AFTERNOON / POWER_HOUR / NEWS_SPIKE`) computed from bars — this flips our `regimeAgent` from DEGRADED to real. **And regime-weighted credibility** (replace trigger-count with measured-edge + regime-fit + participation).
- **REJECT hard (safety):** their BUY/SELL/CLOSE/ROLL action language, LLM-driven signal authority, leverage, 25+ options strategies. This is the exact opposite of our permanent no-execution, deterministic-core, LLM-prose-only rule. The doc is right: *steal the skeleton, not the muscle.*
- **Fit:** high (concept). **Safety:** dangerous if copied literally — take only the deterministic parts. **Effort:** medium (regime), medium (credibility, but gated behind the memory loop).

### 4. `roman-rr` — signal lifecycle + outcome tracking
- **Steal:** the **thesis lifecycle** — `ACTIVE_THESIS → RESOLVED_TARGET / RESOLVED_INVALIDATED / EXPIRED / NO_FOLLOW_THROUGH`, tracking MFE / MAE / final-R / hold-time per event. This is the *outcome* half of the memory loop and pairs exactly with wiring `validation_state`. It's also what makes the scorecard honest (grade the thesis, not the union-of-boards).
- **Reject:** the external black-box crypto-signal API, leverage, "actual P&L" from a third party.
- **Fit:** high. **Safety:** positive (accountability). **Effort:** medium.

---

## Prioritized plan (corrected for what already exists)

Sequenced by **dependency and by overlap with the audit** — several items fix an audit finding *and* land a doc recommendation at once.

**P1 — Wire the memory loop** *(doc #1 + audit's core finding; unblocks everything)*
Persist real `ValidationSnapshot` from research → read at event-build → `memoryAgent` goes live. Add the `history_log` writer (audit fix) so the desk history panel stops being empty. ~3–4 files, mostly wiring, zero new tables.

**P2 — Fix the scorecard denominator + add thesis lifecycle** *(doc #4 roman-rr + audit H7/H9)*
Record once/day not union-of-boards; add `ACTIVE→RESOLVED` states with MFE/MAE/final-R. This makes "measured edge" trustworthy — which P4 needs.

**P3 — Deterministic regime in core** *(doc #3 structure)*
`lib/copilot-core/src/regime.ts` → 8 states from bars → `regimeAgent` DEGRADED→real. Pure deterministic, safe, self-contained.

**P4 — Regime-weighted credibility** *(doc #3, gated behind P1–P3)*
Replace `0.35×primary + 0.1×refinement` with `measuredEdge·0.45 + regimeFit·0.20 + triggerStack·0.20 + participation·0.10 + rr·0.05`. **Do NOT do this before P1/P3** — `measuredEdge` and `regimeFit` don't exist until then, or you're just renaming the same static score.

**P5 — Portfolio-risk + data-governance vocabulary** *(doc #2 JoelLewis)*
Correlation-aware heat check (solves today's miner-cluster problem) + `feedQuality` lineage labels.

**P6 — Workflow manifests** *(doc #1 tradermonty; do anytime, independent)*
`.claude/workflows/*.yaml` contracts. Low effort, improves every future run.

---

## What to explicitly REJECT (non-negotiable safety)

Straight from our permanent design rules — the doc agrees on all of these:
- ❌ BUY/SELL/CLOSE/ROLL action language or specific "take this trade" output
- ❌ LLM given authority over recommendation/confidence/blocks (prose-only stays)
- ❌ Leverage, broker routing, order execution, paper-order code in the committee
- ❌ External black-box signal APIs as a source of truth
- ❌ Non-Alpaca-SIP bars (the whole data contract)

---

## Bottom line

The doc's framing — *"don't replace your pipeline, graft the missing layers"* — is exactly right, and its priority ranking (memory → regime → credibility → lifecycle → risk/data vocab) is sound. The one correction: **you're not building the memory layer, you're connecting it** — the tables, the `ValidationSnapshot` type, the scoreboard math, and the journal writer already exist. That turns the doc's biggest recommendation from a multi-week build into a wiring task that *also* closes three audit findings at once.

Recommended first move: **P1 (wire the memory loop)** — highest value, unblocks P4, and it's the exact intersection where the external doc and our internal audit agree.
