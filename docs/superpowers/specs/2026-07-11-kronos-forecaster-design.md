# kronos-forecaster — Design & Build Spec (executable handoff)

**Date:** 2026-07-11 · **Status:** Approved design, ready to build
**Builds in:** the quant-research repo (Python). This doc is self-contained —
an agent session opened in that repo can execute Phase 1 from this spec alone.
**Depends on (already done, Market-Insight-Engine side):** `kronos_forecasts`
table live in findesk Supabase (migration `kronos_forecasts_raw_table`, RLS on,
anon SELECT-only); computed calibration at `GET /api/calibration` with
per-writer separation; intraday-anchoring contract + anchored grading semantics
in the agent contracts (commit `f8a2428`); writer convention `<agent>/<variant>`.

## What this is

A new crew member: **the tape reader**. Kronos
([github.com/shiyu-coder/Kronos](https://github.com/shiyu-coder/Kronos), MIT)
is a foundation model that forecasts future K-lines from past OHLCV. The agent
wraps judgment around it and writes typed, anchored, probability-carrying
findings into the same graded memory as the rest of the crew. It is deliberately
**news-blind** — its value is that its errors are uncorrelated with the
catalyst-scout's.

Two-stage architecture (non-negotiable):
1. **Raw stage** — every forecast persists to `kronos_forecasts` exactly as the
   model produced it (quantile paths, sampler params, input hash). Raw rows are
   replayable: future conversion-rule changes re-grade history without
   re-running the model.
2. **Judgment stage** — a converter reads raw rows, applies the rules below,
   and writes `agent_findings` rows as writer `kronos-forecaster/zs-small`.

## House rules (the agent contract)

1. **Data contract**: input bars from **Alpaca SIP only**
   (`feed=sip&adjustment=split`), all bars strictly `< anchor_ts` (PIT).
   No Yahoo, no free tiers, no news, no other agents' findings as input.
2. **Blindness is law**: the forecaster never reads news, catalyst labels, or
   other findings before forecasting. (The chief fuses; the instrument stays pure.)
3. **No execution language.** Findings are opinions. THE WALL applies: never
   writes journal_entries, never counts as a validation sample.
4. **Abstain rule**: sample N>=30 paths. If `dispersion_pct` ((q75−q25 terminal
   spread)/anchor_price) > **0.04** (4%, initial value — tune later via Change
   Protocol), the finding verdict is `neutral` with evidence "no signal —
   dispersion X%". An honest "I don't know" is a feature; never force a call.
5. **Quality gates** (fail any → verdict `unavailable`, quality_flags say why):
   - >= 400 clean bars in context window at the chosen timeframe
   - no split/halt inside the context window (`GAP_IN_CONTEXT` if an
     overnight gap > 10% sits inside it — forecast still allowed but flagged
     and confidence capped at 0.5)
   - anchor_price >= $3; median bar volume above zero for all context bars
6. **Model version = writer identity**: zero-shot Kronos-small stamps
   provenance source `kronos-forecaster/zs-small`. Any fine-tune is a NEW
   writer (`/ft-v1`) with a fresh, empty track record; promotion of a
   fine-tune's weight goes through the Change Protocol with zero-shot as the
   stated baseline.

## Finding mapping (raw forecast → agent_findings row)

- `verdict`: `support` if p_up >= 0.60, `reject` if p_up <= 0.40, else
  `neutral`. (Direction claims are about the ANCHOR price over the WINDOW.)
- `confidence`: `max(p_up, 1 - p_up)` — computed, never narrated.
- `evidence[]` (all strings, concrete):
  - `"ANCHOR: 2026-07-13T10:00:00-04:00 @ 43.74 (regular session)"`
  - `"WINDOW: anchor -> 12:00 ET (24 x 5Min bars)"`
  - `"RESIDUAL: p_up=0.71, median path +1.8%, band q25 -0.4% .. q75 +3.1%"`
  - `"DISPERSION: 3.5% (abstain threshold 4%)"`
  - `"INPUT: 512 bars 5Min ending 09:55 ET, hash sha256:..., flags []"`
  - `"MODEL: Kronos-small zero-shot (NeoQuasar/Kronos-small), n_samples=30"`
- `risks[]`: quality flags verbalized + `"news-blind by design: unaware of
  catalysts, earnings, dilution"`.
- `event_timestamp`: window_end_ts. `run_id`: `kronos-<date>-<sweep>` (e.g.
  `kronos-2026-07-13-0835`). `provenance`: `{source:"kronos-forecaster/zs-small",
  gitSha:<quant-research sha>, runRef:<run_id>, forecastId:<kronos_forecasts.id>}`.
- Writes go through the quant-research secret-key connection (same path as
  breakout_bridge). One finding per (symbol, sweep).

## Grading semantics (postflight already supports this — commit f8a2428)

Graded on the anchor→window_end leg ONLY: direction vs sign(price@window_end −
anchor_price), magnitude credit inside the stated band, and **Brier score on
p_up** recorded in the grade's realized notes. The pre-anchor move never earns
or costs a grade. Regime tag (from the copilot regime lens, or session bucket
premarket/open/midday) goes in `calibration_bucket` alongside confidence bucket
when available.

## Daily schedule (Phase 1: one sweep; Phase 2: all four)

- 08:35 ET on the day's board candidates (union with breakout_candidates)
- 10:00 / 12:30 / 14:30 ET anchored sweeps, horizon = to 16:00 ET
- Timeframe: 5Min bars, context 512 bars, horizon = bars remaining to close
  (cap 78)

## Phase plan + acceptance checks

**Phase 1 — raw pipeline + converter (a day):**
1. `pip install` Kronos deps; load `NeoQuasar/Kronos-small` +
   `NeoQuasar/Kronos-Tokenizer-base` (CPU OK).
2. `kronos_bridge.py`: fetch Alpaca 5Min bars → quality gates → N-sample
   forecast → write `kronos_forecasts` row → convert → write `agent_findings`.
3. Acceptance: (a) run against 3 liquid symbols at a live anchor; 3 raw rows +
   3 findings appear (verify via anon REST select); (b) input_bars_hash
   reproducible on re-fetch; (c) an intentionally thin symbol produces
   `unavailable` with flags, not a forecast; (d) UNIQUE constraint makes
   re-runs idempotent; (e) no news/API besides Alpaca + Supabase touched.

**Phase 2 — schedule + chief integration (days 2-3):**
Cron the four sweeps; add the disagreement report (scout support + kronos
reject or vice versa → surfaced to chief as a conflict); Memory page shows the
new writer automatically (calibration endpoint already separates writers).

**Phase 3 — earned-weight era (when grades accumulate):**
Postflight grades daily; after ~2 weeks compare `kronos-forecaster/zs-small`
vs `catalyst-scout` tradability cells in `/api/calibration`. Fine-tune
(their Qlib pipeline, our NASDAQ universe, hard examples = incorrect-graded
forecasts) → `/ft-v1` writer → Change Protocol vs zero-shot baseline.

## Env (quant-research .env, all already present except model cache)

`ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY` (bars), `SUPABASE_URL`,
`SUPABASE_SECRET_KEY` (writes), HF model cache dir. No new secrets.

## Explicitly out of scope

Order/execution code of any kind; journal writes; gate changes; using Kronos
output anywhere in the deterministic core. It is a graded voice, nothing more.
