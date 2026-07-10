# The Pipeline — agents, brains, rules, and how tickers actually get picked

Full step-by-step description of the Market-Insight-Engine multi-agent research
system: every component, what its "brain" is, what data it gets, what rules bind
it, how the pieces interact, and the daily flow end to end.

> The one-sentence version: **tickers are chosen by deterministic code, agents
> research them, a calibration-weighted brain fuses the research, a human
> decides, and everything is graded afterward so tomorrow's weights are earned,
> not asserted.**

---

## Layer 0 — The data plane (what everything is allowed to know)

| Source | Role | Hard rule |
|---|---|---|
| **Alpaca SIP** (paid) | The ONLY source of bars, prices, and the trade tape (`feed=sip`, `adjustment=split`) | Every price-shaped number traces here. Any other source's price claim is "unverified" until Alpaca confirms it |
| **FMP** (paid tier, direct REST) | Enrichment only: screener universe, news/press releases, analyst grade changes, earnings calendar | **Never bars.** Never a price of record |
| **Supabase `findesk`** | The system's memory (journal, findings, grades, snapshots, reports) | RLS enabled: publishable key = SELECT-only; writes only via the direct Postgres role |
| Banned | Yahoo, free tiers, scraping | No exceptions |

Cross-cutting rules:

- **Point-in-time (PIT) discipline** — nothing may use information from after
  the moment it claims to represent.
- **Credentials env-only** — never committed, never written into files.
- **No execution code exists anywhere.** The system cannot place, size, or
  suggest orders in execution language. Ever.

---

## Layer 1 — The deterministic core (who actually picks the tickers)

The most important fact about this system: **tickers are chosen by code, not by
AI.** The agents never invent a ticker. The deterministic scanner produces the
board; the agents *research* the board.

**Brain: none — pure TypeScript** (`lib/copilot-core/`, scan service in
`artifacts/api-server/`). Deliberate: the only component allowed to feed
anything trading-shaped is fully auditable, replayable, and has no opinions.

How the 8:30 board is built:

1. **Universe pull** — FMP screener → NASDAQ names (persisted to
   `universe_snapshot`).
2. **Gates** (each rejection gets a machine reason code): price floor/cap →
   `GATED_PRICE_CAP`; bar-history minimum → `GATED_HISTORY`; pre-market dollar
   volume → `GATED_PMVOL`.
3. **Alpaca verification** — every survivor's gap % and pre-market dollar
   volume recomputed from SIP bars. FMP's numbers are never trusted for this.
4. **Ranking + badges** — survivors ranked into Top Intraday / Likely Jump /
   Likely Fall; cuts logged as `RANK_CUT` / `BADGE_CUT`.
5. **Strategy classification** — each candidate matched to a hypothesis in the
   registry (`lib/copilot-core/src/strategyLab.ts`, 9 registered incl.
   `JUMPDAY_RIDER`, `LARGECAP_SCALPER`), routing it to the matching engine /
   Pine template.
6. **The board freezes at 8:30 ET.** Later movers are structurally invisible
   (`INVISIBLE_AT_0830`) — an honest, known blind spot postflight measures daily.

**The 10-lens copilot read** (also pure code — `lib/copilot-core/src/event.ts`
and friends), per event:

| Lens | Status | What it reads |
|---|---|---|
| regime | real | 8-state classification from bars + ET clock (`regime.ts`) |
| order_flow | real (live only) | tick-rule buy/sell pressure on the SIP tape (`orderFlow.ts`) |
| catalyst | real | FMP headline counts/freshness ONLY — bias hardcoded NEUTRAL, never sentiment (`catalyst.ts`) |
| memory | real | journal scoreboard via `computeScoreboard` (`edgeScoreboard.ts`) |
| position / bull / bear | real | position state, strongest cases each way |
| risk_critic | real, **governor** | at risk level L5 it FORCES defensive output regardless of everything else |
| technical, pattern | DEGRADED | honestly labeled placeholders |

These lenses are functions, not agents — 8 of 10 real, 2 admit they aren't.

---

## Layer 2 — The research crew (the AI agents)

**What their "brain" is:** each agent is a full Claude instance spawned as a
subagent whose personality, data sources, house rules, memory obligations, and
output format come from a contract file in `.claude/agents/<name>.md`. Tools:
shell, file read, search — they write scratch scripts and hit real APIs; they do
not hallucinate data. The exception is **brain-diagnostics**: not a subagent but
an always-on service in the api-server running `claude-opus-4-8`
(`artifacts/api-server/src/lib/brain/`).

| Agent | Job | Gets | Hard rules |
|---|---|---|---|
| **catalyst-scout** | Find the *why* behind every board name: fresh news, PRs, grade changes, earnings — then verify the tape agrees | FMP archives (direct REST), Alpaca bars, the board | Primary-source timestamps required; uncorroborated = labeled so; catalyst tiers HARD / SOFT / SYMPATHY; research only |
| **risk-auditor** | Find the hidden single bet: pairwise correlations, clusters, true portfolio heat vs naive "1% each" | Alpaca daily bars, candidate list, journal | Measured r beats sector labels; flags and quantifies, **never blocks or sizes** |
| **tv-scanner** (local sessions only) | See what the frozen board can't: TV pre-market ranks, rvol, post-8:30 movers | TradingView MCP + the repo board | TV is discovery ONLY — every claim re-verified on Alpaca; disagreements are findings |
| **replay-grader** | "Pretend it's 8:30 on date X" — rerun the board point-in-time, grade it against what happened | Historical Alpaca bars, shipped classifier | Strict PIT; grades the board, never changes it |
| **postflight-analyst** | Accountability twice: (a) after close, every ≥5% missed mover WITH reason code + catch rate; (b) **the grader** — scores agent findings against the realized tape into `finding_grades` | Alpaca bars, the day's findings, reason-code vocabulary | Grades the claim actually made, from the finding's timestamp; can't-test = `ungradable`, never forced |
| **edge-curator** | Custodian of measured edge: reproduces the production scoreboard, finds starvation (thin samples, ungraded entries, drift) | `journal_entries` + the SAME `computeScoreboard` the live memory lens uses; both memory planes | Never writes an outcome; low sample is the headline; the only agent allowed to read both planes side by side |
| **backtest-runner** | Turn hypotheses into numbers: deterministic counterfactuals with pessimistic assumptions | Journal replay set, Alpaca bars, the hypothesis spec | PIT, train/validate honesty, reports both arms win or lose; metrics, never vibes |
| **pine-reviewer** | Review Pine v6 scripts before they ship (repainting, na-poisoning, session traps) | `tools/pine/` diffs | Read-only reviewer |
| **chief-analyst** (gold) | **The brain** — see Layer 4, step "the fuse" | The entire DB: findings + grades + scoreboard, queried by itself | Advisory only; never sets gates; drives the Change Protocol |
| **brain-diagnostics** (`POST /brain/ask`) | Answer "why did X fail?" with citations from the same record | Read-only Supabase client (RLS-enforced) | Never writes; surfaces errors instead of fabricating |

**Rules binding ALL agents (the memory clause, in every contract):**

1. **READ BEFORE VERDICT** — query your own prior findings and grades first;
   cite your track record in the verdict ("my prior miner supports graded 3/7 —
   confidence tempered"). DB unreachable → output labeled *memory-blind*, never
   fabricated.
2. **WRITE AFTER** — every material conclusion becomes one typed row in
   `agent_findings`: verdict (`support|reject|neutral|unavailable`), confidence
   0–1, evidence[] with numbers, risks[], required_followup[], provenance
   `{source, gitSha, runRef}`. RLS blocks direct agent writes, so agents print
   typed JSON and the orchestrating session persists it — every write passes
   through one auditable door.
3. **THE WALL** — findings are *opinions*. They may never touch
   `journal_entries` and never become validation samples.
4. No execution language, no gate-setting, advisory always.

---

## Layer 3 — Memory: two planes and a wall

**Plane A — strategy truth.** `journal_entries` (real outcomes; only
human-confirmed `MANUAL_CONFIRMED` rows count) → `computeScoreboard` →
per-hypothesis expectancy / win rate / validation status (`unproven`,
`paper_pending`, `backtested_only`, `paper_validated`, `no_edge`,
`insufficient_sample`). This is the ONLY thing that can validate a strategy.

**Plane B — agent calibration.** `agent_findings` → `finding_grades`. Measures
how often each agent is *right*, per verdict type. This is what the chief
weighs.

**The wall:** A→B reads allowed; B→A never. An agent being right doesn't make a
strategy validated; a strategy winning doesn't make an agent credible. The only
door through the wall is the Change Protocol (below).

---

## Layer 4 — The full daily flow, step by step

**~8:00–8:25 ET — discovery (local session).** tv-scanner sweeps TradingView
pre-market screens, re-verifies every candidate on Alpaca SIP, diffs against our
board, logs disagreements and blind spots as findings.

**8:30 — the board freezes.** Deterministic core only: universe → gates →
Alpaca verification → ranks → badges → strategy classification. *This is the
moment the tickers are decided, and no AI touched it.*

**8:30–9:15 — the crew researches the board (parallel).**
- catalyst-scout: memory read → PIT catalyst hunt per name → tiered verdicts →
  findings persisted.
- risk-auditor: memory read → correlation web across the board → which names
  are secretly one bet, true heat vs naive → findings persisted.
- Every verdict arrives pre-tempered by that agent's own graded history.

**~9:15 — chief-analyst fuses.** It queries everything itself (no hand-feeding):
all findings, all grades, the scoreboard. Then:
- **Weights each agent by measured calibration**, tier-conditionally where the
  grades support it (e.g. scout hard-binary calls near 0.85, its soft-catalyst
  supports near 0.30; ungraded agents at stated confidence × 0.5).
- **Conflicts are surfaced, never averaged** — scout supports a name,
  risk-auditor rejects the plan holding it → the brain resolves explicitly and
  says why.
- **Recency decay + negative evidence** — an agent's repeatedly-failed pattern
  is cited against it.
- Output: a **ranked advisory read** per name — fused verdict, the per-agent
  verdicts + weights behind it, the one conflict that matters, and "what would
  change my mind" — persisted as its own findings **so postflight grades the
  brain too**.
- It cannot set gates, unlock conviction, change validation status, or emit
  execution language. The deterministic risk_critic remains the governor.

**Human decides.** The read is advisory. There is no order code to run.

**After the close — accountability.**
1. postflight-analyst grades every gradable finding against the realized tape →
   `finding_grades`. Claims about future sessions wait; findings written after
   the close are never graded against the day they already saw (no hindsight).
2. Postflight attribution: every ≥5% missed mover with its machine reason code;
   the day's catch rate.
3. Human confirms trade outcomes → journal → scoreboard → validation status
   moves (or doesn't).
4. edge-curator audits the feed: starvation, drift, thin samples, calibration
   table.

**Overnight learning.** Tomorrow's run starts with updated calibration weights
and an updated scoreboard — the same agents speak with different authority than
yesterday, based on measured results. That is the loop.

---

## The Change Protocol — the only door through the wall

When the brain (or the evidence) wants the SYSTEM itself to change:

1. **Draft** — a typed hypothesis: exact rule with pinned parameters, motivating
   data (cited finding/grade/journal ids), the baseline to beat, and explicit
   kill conditions. Under-specification is a rejectable offense.
2. **Committee** — adversarial, independent, parallel: risk-auditor attacks the
   risk, edge-curator checks measured edge + sample honesty, postflight-analyst
   checks frequency honesty and audits any input labeling. Each writes a
   finding WITH data. Any member's data-backed reject sends the proposal back
   for revision or kills it.
3. **Test** — survivors (or committee-revised versions) go to backtest-runner:
   deterministic replay, control arms, kill conditions enforced mechanically.
4. **Record** — every draft, verdict, and backtest result persists as
   provenance-stamped `agent_findings` rows.
5. **Human merges — or doesn't.** Nothing ships on discussion alone.

Track record so far: three proposals in (correlation heat rule, whipsaw circuit
breaker, catalyst entry gate), **zero shipped** — the heat rule lost to the
committee's own dumb-count-cap control arm; the breaker died on a
data-existence fact (no exit timestamps in the journal); the catalyst gate was
inverted by the data (SOFT > HARD; sympathy tier toxic) and the inversion still
missed its own pinned kill bar. Every "no" is recorded with numbers. That is
the point.

---

## Observability

- **Crew Memory page** (findesk `/memory`): live `agent_findings` +
  `finding_grades` + per-agent calibration, straight from Supabase (read-only).
- **`POST /brain/ask`** (api-server): plain-English "why" questions answered
  with citations into the same record, by `claude-opus-4-8`.
- Every finding carries provenance (source agent, git SHA, run ref); every
  grade carries grader ref + rubric version.
