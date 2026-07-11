# Intraday anchoring contract — design sources

Motivating grades (2026-07-09/10, `finding_grades` graders `postflight-*`):
catalyst-scout hard-catalyst supports issued 13:18 ET were right close-to-close
but delivered +0.4% / −0.1% / −3.9%-against on the post-call leg; its sub-0.3
skeptical calls went 9-for-10 over two sessions. Day-level conviction is not a
claim about the remaining move. The fix shipped into
`.claude/agents/catalyst-scout.md` ("Intraday anchoring"), `chief-analyst.md`
(fusion rules 6–7), `postflight-analyst.md` (anchored grading semantics).

Survey of comparable multi-agent finance systems (Hugging Face papers + code
reads, 2026-07-10). What each contributed:

| System | Source | Contribution to our contract |
|---|---|---|
| QuantAgent (HFT) | hf.co/papers/2509.09995 | The horizon as a MANDATORY typed field of the verdict ("predict the next N candlesticks"; required `forecast_horizon` output) |
| ContestTrade | hf.co/papers/2508.00554 | Post-trigger-time reward (agent graded strictly on the post-signal leg); per-evidence `<time>`/`<from_source>`; mandatory `<limitations>` ("No limitation will be rejected"); judge scores probability-quality itself; track-record-weighted agent fusion |
| FinGPT-Forecaster / FinRobot | AI4Finance repos | The minimal residual-claim sentence: as-of date + direction + magnitude band + named forward window ("up/down by 2-3% for next week upon {date}") |
| AIA Forecaster | hf.co/papers/2511.07678 | LLM confidences compress toward 0.5; fix with Platt/log-odds scaling fitted on own grading record; discard low-confidence self-revisions |
| FinCon | hf.co/papers/2407.06567 | Selective lesson propagation: a graded failure updates the failing FACULTY (tradability), not the working one (catalyst identification) |
| FinMem | hf.co/papers/2311.13743 | Evidence half-life by class (layered memory decay) — a 1:18 PM hard catalyst is hours-scale evidence, not day-scale |
| TradingAgents (Tauric) | hf.co/papers/2412.20138 | Post-grade reflection format: was the call correct (cite alpha), which thesis leg failed, ONE lesson — re-injected into future prompts |
| Janus-Q / Trade-the-Event / DeepFund et al. | hf.co/papers/2602.19919, 2105.12825, 2503.18313 | Grading target = post-event/post-decision abnormal return from the issuance timestamp; day-level backfill grading is look-ahead leakage |

Honest gaps found: no surveyed framework encodes a **spent-move discount**
(discount conviction by the fraction of the typical catalyst reaction already
realized) — clause 4 of our contract is novel. Most frameworks operate on
daily cadence where "the move already happened at 1:18 PM" is inexpressible.

Follow-ups queued:
- Fit a monotone (Platt-style) recalibration of raw agent p once the grade
  count supports it; apply before chief-analyst fusion (contract rule 6).
- Calibration must key on writer provenance: scheduled-routine runs and
  subagent runs share agent names but are different writers (distinguishable
  today by provenance.gitSha; give routines a distinct source suffix).
