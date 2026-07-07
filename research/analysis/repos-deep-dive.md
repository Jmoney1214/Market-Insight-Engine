# Deep dive: the 4 trading-skill repos + the article

**Method:** each repo fetched live from GitHub raw files / API on 2026-07-07 by a
dedicated agent — not summarized from the earlier comparison doc. Facts below are
verified from source; the original `external-repo-analysis.md` got several things
wrong, corrected here.

---

## TL;DR ranking (for OUR purposes)

| Repo | What it really is | Stars | License | Safety | Worth taking |
|---|---|---|---|---|---|
| **tradermonty/claude-trading-skills** | Mature 64-skill equity-swing assistant w/ workflow DAGs, memory loop, backtest rigor | **2,292** | MIT | ✅ advisory-only by design | **Yes — the model to study** |
| **JoelLewis/finance_skills** | 84-skill finance-domain corpus; ~35 ship real quant Python | 148 | MIT | ✅ guidance-only | Risk math + data-governance vocab only |
| **ScientiaCapital/skills** | Mostly a **sales/BDR** library; 2–3 trading skills | 25 | MIT | ⚠️ emits BUY/SELL, LLM-vote authority | Skeleton only (regime table, teach pattern) |
| **roman-rr/trading-skills** | Thin wrapper over a **crypto-perp signal service** | ~90* | Proprietary | ❌ funnel to 10x auto-execution | One idea: the verification schema |

\* roman-rr's stars are partly manufactured by a mandatory repo-star step in onboarding.

---

## 1. tradermonty/claude-trading-skills — the substantive one

**Facts:** 2,292★ / 539 forks, MIT, created 2025-10-19, ~552 commits, Python 99.7%,
committed the same day it was researched (very active). Docs site (EN/JA). Solo dev.
Positioning in its own words: *"a research, journaling, and risk-review assistant,
**not** an automated trading system… not a signal service or a promise of profitability."*

**64 skills across 8 categories:** market-regime (14), core-portfolio (6),
swing-opportunity (8), trade-planning (5), trade-memory (7), strategy-research (12),
advanced-satellite (7), meta/tooling (8). Every skill = `SKILL.md` (YAML frontmatter
+ prose) + reference docs + Python helpers; all 64 pre-packaged as `.skill` archives.

**Architecture worth stealing:**
- **Metadata-driven:** `skills-index.yaml` is the single source of truth; catalog,
  navigator, and install bundles are generated from it, validated by
  `validate_skills_index.py` with 3 strictness tiers + error codes (IDX/WF/SK), wired
  into pre-commit + CI. Far beyond a "folder of prompts."
- **Workflow DAGs with hard gates.** 9 declarative YAML workflows chaining skills with
  `consumes`/`produces`/`depends_on` + decision gates. The flagship `swing-opportunity-daily`
  (11 steps, 4 gates): `drawdown-circuit-breaker` [GATE] → screeners → `technical-analyst`
  [GATE] → `position-sizer` → `breakout-trade-planner` → `trader-memory-core` [GATE] →
  `pre-trade-discipline-gate` [GATE] → **manual broker execution**. Won't even run if the
  regime workflow says "cash-priority." Pattern: **regime gate → screen → validate → size
  → plan → journal → discipline gate → human executes.**
- **Closed memory/learning loop:** `trader-memory-core` (thesis lifecycle YAML: idea →
  open → closed+postmortem) → `signal-postmortem` → `weekly-performance-digest` /
  `trade-performance-coach` → operating rules → monthly review. **This is exactly our
  Step-3 pattern, validated in the wild.**
- **Edge pipeline** (7 chained research skills: observations→hints→concepts→drafts→review→
  aggregation→orchestration) + a Druckenmiller synthesizer fusing 8 signals into a 0–100
  conviction score + `strategy-pivot-designer` (detects tuning stagnation).
- **Meta self-improvement:** `skill-idea-miner` (mines session logs) → `skill-designer` →
  `dual-axis-skill-reviewer` (deterministic + LLM scoring), scheduled via `launchd`.

**`backtest-expert` standards (verbatim, stricter than ours):**
- Sample: **min 30 / preferred 100+ / high-confidence 200+** trades.
- History: **5yr min, 10+ preferred**, spanning bull/bear/high-low-vol.
- Walk-forward OOS: **red flag if out-of-sample < 50% of in-sample** = curve-fit.
- Costs: **1.5–2× slippage multiplier**, worst-case fills (buy ask+1 tick, sell bid−1).
- Regime: year-by-year, **require positive expectancy in a majority of years**.
- Robustness: vary stop 50/75/100/125/150% & target 80/90/100/110/120% → require a
  **plateau, not a knife-edge** ("only works at stop=2.13%" = curve-fit).
- Too-good red flags: >90% win rate / minimal DD → audit for look-ahead.

**Safety:** advisory-only by explicit design; stops at Alpaca **bracket-order templates**
+ a discipline gate before manual execution; never places orders. MIT AS-IS.

---

## 2. JoelLewis/finance_skills — the risk/data-governance corpus

**Facts:** 148★ / 31 forks, MIT, last commit 2026-06-11, Python 98%. **84 skills / 7
plugins** confirmed (the repo's "81" About text is stale). Temporally current (T+1,
ISO 20022 cutover, Reg NMS fee cap, FICC deadlines), CLAUDE.md mandates "as-of" dates.

**Plugins:** core (3) · wealth-management (32) · compliance (16) · advisory-practice (12)
· trading-operations (9) · client-operations (8) · data-integration (4). `core` is the
implicit root; `install.sh` symlinks skills into `.claude/skills/`.

**~35 of 84 skills ship REAL runnable Python** (core + wealth-management have `scripts:true`),
each with a `--verify` self-test asserting against worked examples — the rest (49) are
knowledge prose. Verified genuine (not stubs): `bet_sizing.py` (~430 lines, Kelly +
sizing), `statistics_fundamentals.py` (Ledoit-Wolf shrinkage, OLS, bootstrap, JB test).

**Risk math present and real:** historical/Parkinson/Yang-Zhang vol; max DD + duration +
recovery; **historical + parametric + Monte-Carlo VaR**; **CVaR/Expected Shortfall**
(coherent-measure note); **Component/Marginal VaR**; **EWMA + GARCH(1,1)**; **implied-vol
surface** (strike×maturity); vol-risk-premium; **diversification ratio + marginal
contribution to risk**; **mean-variance + risk parity + Black-Litterman + min-variance**;
**discrete + continuous + fractional Kelly**; **threshold-band + Leland optimal
rebalancing** (+ vol harvesting, tax-aware, cross-account); Sharpe/Sortino/Info/Treynor/
Calmar/Omega/M²; **Brinson-Fachler attribution** + multi-period linking.

**Data governance (guidance-only):** L1/L2/L3 data, vendor landscape (Bloomberg/Refinitiv/
ICE/FactSet/S&P), licensing (display vs non-display, redistribution audit risk),
security-master IDs (CUSIP/ISIN/SEDOL/FIGI, "ticker never a primary ID"), golden-source +
MDM, **6 data-quality dimensions with numeric targets** (accuracy >99.5% etc.), **lineage**
(BCBS 239/MiFID II), 6-layer validation, exception-management workflow, owner/steward/
custodian governance.

**Trading ops:** 13-state order lifecycle + FIX tags + cancel/fill races; best-ex (FINRA
5310) + SOR + TCA/implementation-shortfall; **T+1** DTC/NSCC/FICC + CNS + DVP; counterparty
risk (SA-CCR, ISDA SIMM, CCP waterfall); margin (Reg T, FINRA 4210, portfolio margin);
operational risk (Basel event types, KRIs, BCP). Plus an actual **eval harness**
(`evals.json`, ~16 cases with assertions). No execution anywhere.

---

## 3. ScientiaCapital/skills — mostly sales, small dangerous trading slice

**Facts:** 25★ / 2 forks, MIT, 134 commits. **87 skills total, ~40+ are sales/BDR/GTM
automation** — trading is **2–3 skills**. The earlier doc badly mischaracterized this as
an "aggressive multi-asset trading framework"; it's a **sales library** with a trading
corner. The `trading-signals-skill` is v2.1.0 with 18 reference files.

**Real content:** multi-asset (options/stocks/crypto/commodities/gold/silver/oil/VIX/forex),
**33 options strategies** (exceeds "25+"), full Greeks + IV-rank gating, a **7-state Markov
(Bitcoin HMM)** for context + a **4-state model for weight routing**. Confluence weights
(verified verbatim):

| Regime | Elliott | Turtle | Fibonacci | Wyckoff |
|---|---|---|---|---|
| trending | 0.30 | 0.30 | 0.20 | 0.15 |
| ranging | 0.20 | 0.05 | 0.35 | 0.30 |
| volatile | 0.20 | 0.10 | 0.30 | 0.30 |

Score bands: **0.7–1.0 "execute with full position" · 0.4–0.7 half/wait · 0.0–0.4 no-trade.**
Teaching pattern: **"Signal → Why → Context → Action."**

**⚠️ DANGER (verified quotes):** output contract emits **"BUY/SELL/HOLD/ROLL/CLOSE with
specific levels"**; a **7-LLM ensemble VOTES the trade signal** into existence (Opus/Sonnet/
DeepSeek/Gemini/Qwen/Mistral, weighted; highest weighted score wins → "Execute with full
size" at 75%+); imperative risk directives ("Halt all trading, close discretionary
positions," "Reduce all position sizes by 50%"). **LLM-as-signal-authority + execute
language = the exact anti-pattern our architecture forbids.**

**Safe skeleton worth adapting:** regime-first routing, the regime-weighted confluence
table, "Signal→Why→Context→Action," progressive-disclosure (3-level) loading.

---

## 4. roman-rr/trading-skills — crypto-perp signal-service wrapper

**Facts:** ~90★ (partly manufactured), 12 forks, **Proprietary** license (no warranty/
liability disclaimer), 22 commits, solo (Roman Antonov). Thin markdown wrapper over the
hosted **signals.x70.ai** API (also an MCP server). "17 triggers × 44 algorithms × 3 AI
experts" over 50+ Hyperliquid perps.

**Signal object:** id/coin/direction/confidence(0–100)/type/tags/summary/entryPrice/
stopLoss/takeProfit/leverage(1–10x)/riskRewardRatio/positionSize + a **`verification`
object** (status unverified→pending→success/failed, priceChangePct, **maxFavorablePct**,
theoreticalProfitPct, stopLossHit/takeProfitHit, verifiedAt, **leverage-adjusted roi**).
Endpoints: register / signals / signals/:id / signals/history / stats. Onboarding harvests
name+email+GitHub and instructs the agent to **star the repo** ("push STAR to keep them free").

**✅ The one genuinely good idea:** the **outcome-verification lifecycle** — every signal is
a persistent object graded against real prices (TP/SL hit, MFE, leverage-adjusted ROI,
aggregate hit-rate). A proper falsifiable track-record schema. It even ships a published
**negative-result audit** (Zenodo DOI) proving LLMs are *bad* at reading candlestick charts
— a real credibility signal implying the signals come from order-flow, not vision.

**❌ Red flags:** the free advisory skill is a **lead-gen funnel into a real-money
auto-execution product** on Hyperliquid ("your signals start executing… in under a second"),
up to **10x leverage**, hit-rate/ROI **vendor-self-reported** (unauditable), soft in-skill
guardrails, **no "not financial advice" disclaimer in the repo** (only on the website).

---

## 5. The article ("Top 5 Claude Code Skills for Algorithmic Trading")

Kevin Meneses González, DataDrivenInvestor/Medium, **2026-04-15** (+ DEV.to mirror). Thesis:
skills compress quant boilerplate; the bottleneck shifts from implementation to strategy
selection. Names 5 skills (Backtesting Expert, Market Data Pipeline, Signal Generator, Risk
Manager, Live Signal Monitor) on "one EODHD data layer." **Verdict: content-marketing
listicle that didn't closely inspect the repos** — the mapping is **inaccurate for 3 of 5**
(JoelLewis has no market-data-pipeline skill or EODHD; ScientiaCapital is mostly sales;
roman-rr is crypto perps, not an EODHD equity monitor), and there is **zero performance data
anywhere**. Only tradermonty is a clean fit. The "one EODHD pipeline" is the author's construct.

---

## 6. What to graft into OUR build (safe) vs reject — mapped to the roadmap

**Take (safe, high-value):**
1. **tradermonty's `backtest-expert` standards** → tighten our `backtest-runner` agent
   contract (min-30/100/200 trades, walk-forward OOS<50% red flag, 1.5–2× slippage,
   parameter-plateau). We already do most; codify the rest. *(cheap, high-integrity)*
2. **tradermonty's workflow-DAG + hard-gate pattern** → our `.claude/workflows/*.yaml`
   (roadmap; regime-gate → screen → validate → size → plan → journal → discipline-gate).
3. **tradermonty's memory loop** → ✅ already shipped (Step 3) — this is the proof it's right.
4. **ScientiaCapital's regime-weighted confluence table** (the numbers above) → a starting
   skeleton for **Step 4/5** (deterministic regime + regime-weighted credibility). Take the
   *table shape*, not the methodologies, LLM-vote, or execute language.
5. **roman-rr's verification schema** (MFE/MAE, leverage-adjusted-agnostic ROI, hit-rate
   lifecycle) → the thesis-lifecycle piece (roadmap) — grade every pick against real outcome.
6. **JoelLewis's risk math** — Kelly/half-Kelly, **correlation-as-one-position** (directly
   solves the miner-cluster problem I flagged), VaR, drawdown-band halt → the portfolio-risk
   module (roadmap task #22 area), as reference/education, not an auto-executor.
7. **JoelLewis's data-governance vocab** (L1/L2/L3, lineage, DQ dimensions, exception state)
   → richer `feedQuality` labels on our gates.

**Reject (dangerous / off-contract):**
- ScientiaCapital's **BUY/SELL/CLOSE execute language + 7-LLM signal-vote authority**.
- roman-rr's **black-box signal service + 10x leverage + funnel-to-execution + proprietary
  license**.
- Any **wholesale plugin/skill import** — adds unsafe or irrelevant surface; we adapt
  concepts into our deterministic, no-execution, Alpaca-SIP architecture only.

**The through-line:** none of the four demonstrates profitability — they accelerate
*building and testing*, not *edge*. tradermonty is the gold standard for *how to structure*
a Claude trading assistant (advisory, gated, memory-looped, metadata-driven); the others
contribute one idea each (JoelLewis = risk/data rigor, ScientiaCapital = regime-weighted
confluence skeleton, roman-rr = outcome-verification schema). We graft ideas, never repos.
