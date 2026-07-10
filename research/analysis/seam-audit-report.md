# Adversarial Seam Audit — Market-Insight-Engine
**Run:** 2026-07-06 · main @ `e235709` · 9 finder agents + 8 skeptic verifiers (every critical/high/medium finding independently re-verified at the cited lines and attacked for materiality; 1 finding killed, several downgraded)

**Raw findings: 55 → verified unique: 1 CRITICAL · 11 HIGH · 16 MEDIUM · ~20 LOW · 1 REFUTED**

**The theme in one sentence:** the deterministic backtest core you validated is largely sound — but the LIVE scanner has drifted from it in six confirmed ways, the backtest has three fills/caching flaws that flatter results, and the accountability loop (scorecard/scheduler) has structural holes that make its hit-rate untrustworthy.

---

## CRITICAL

**C1. Backtest bar-cache keys omit the symbol list — stale universe served for up to 30 days, with a lying provenance stamp.**
`tools/research/lib/data.mjs:97` — `alpacaBars` caches by tag (`dailies_<from>_<to>`, `full_<day>`) with no hash of the symbol list. Change the universe (screener drift, snapshot appears) and a rerun silently serves the OLD symbol set — while `stampMetadata` stamps the NEW universe source into the report. Violates the module's own "never silently run on incomplete data" contract. (I hit this personally during the truncation fix — had to `rm` caches by hand.)
*Fix: include `configHash({symbols,timeframe,start,end})` in the cache key, or store the symbol list in the payload and hard-fail on mismatch.*

## HIGH — live scanner is not the validated scanner

**H1. The live app has NO eligible pipeline.** The badge gate, mtd≥7, pre-market $2M dollar-volume gate, and top-5 cut exist only in the harness (`engine.mjs:81-98`). Live (`scan.ts:281-299`) emits only the three ungated boards, never fetches pre-market minute bars (pm gate uncomputable), and the scorecard records the ungated boards. Production surfaces — and measures — picks the validated engines would refuse.

**H2. $150 ceiling divergence.** Live caps the entire universe at $150 (`fmp.ts:242`, `scan.ts:48,158,188`); harness exempts the scalper class (`engine.mjs:65-66`). TSLA-class scalpers can never appear live.

**H3. dollarVol base mismatch (flips the scalper badge).** Live: FMP single-day screener volume × live pre-market price (`scan.ts:189`, mislabeled `avgVolume` at :167,269). Harness/replay/Pine: Alpaca 20-day avg volume × prior close. One-day volume spikes flip the $8B badge on exactly the catalyst days that matter.

**H4. Today's partial daily bar contaminates live stats.** `getDailyBars` has no `end` bound (`alpaca.ts:206-214`), so intraday refreshes push today's half-formed bar into the 10-day range/mtd/ATR windows — badges and scores drift all session vs the twins (which filter `t < day`).

## HIGH — backtest math that flatters results

**H5. Gap-through stops fill at the stop price** (`engine.mjs:106,155`) — reproduced: a crash bar booked an exit $11.60 above the bar's entire traded range, understating one trade's loss by ~$934. Breaks the "pessimistic fills" promise exactly on the loss tail. *Fix: fill at `min(bar.o, stop) − slip`.*

**H6. Pine↔Node pm-volume window drift, and the parity guard can't see it.** Pine sums pre-market dollars through 09:30; Node cuts at ≤08:30 (heaviest hour excluded); `parity-audit.md` row wrongly says MATCH; and `parity_check.mjs` only replays days present in the TV export, so Node-only-trade drift is structurally invisible (`parity_check.mjs:41,54`).

## HIGH — the accountability loop

**H7. Scorecard records the union of every 5-minute board.** Recording fires on ~16 ticks between 8:15–9:30 per instance (`scan.ts:117-123`); the stored set is "everything that ever touched a board", not the morning picks — the hit rate measures the wrong thing.

**H8. Autoscale scale-to-zero silently skips days.** In-process `setInterval` scheduler (`scan.ts:140`); an instance that wakes after 9:30 can never record that day; no backfill, no error.

**H9. Grading can starve.** `gradePending` selects unordered `LIMIT 100` with no terminal state for ungradeable rows (`scorecard.ts:62-66`) — once holidays/delistings accumulate >100 permanently-pending rows, fresh picks may never grade again.

**H10. Partial snapshots get recorded as truth.** A single failed Alpaca chunk at 8:20 silently drops ~100 symbols (`alpaca.ts:133-134`); the degraded board is served and permanently recorded with no coverage marker.

**H11. Errors leave the API as HTML.** No JSON error middleware (`app.ts`); provider failures during `/analyze` collapse intended 404/502s into Express's HTML 500, breaking the ApiError contract clients parse.

## MEDIUM (16, verified — grouped)

- **Live↔harness drift, smaller:** catalyst inputs (live adds analyst-grade +1.2 prelim/+6 score and news +4 the harness lacks — changes which names make the top-30); no 30-day history gate live (IPOs ranked on imputed defaults `?? 3`/`?? 1.5`); earnings window today+tomorrow live vs same-day harness; classification on rounded values (badge bands shift at 6.45/4.45/$19.995).
- **Backtest math, smaller:** EOD/data-end exits unslipped (~3bps flattery on every rider winner); entry gaps over signal bar → single trade can risk ~2.4–3× the sized $250 and a day can end well past the $500 brake (undocumented; matches Pine, but the money consequence is disclosed nowhere); Pine slippage model (2 ticks) ≠ Node (3bps) and it's absent from the intentional-differences list; Pine fills gap-through *entries* the Node engine silently skips.
- **Data plane:** replay `batchBars` swallows chunk errors (drill boards silently partial); copilot earnings-time enrichment falls back to keyless Nasdaq/Yahoo-crumb endpoints ungated inside the alpaca_live path (contract breach; FMP tried first).
- **Scheduler:** no exchange-holiday calendar — weekday holidays record ~12+ ungradeable rows each and feed H9.
- **Contract/UI:** analysis/journal/history responses sent unvalidated (raw JSONB can leak stale shapes to typed clients); `history_log` is documented + rendered in the desk UI but nothing ever writes it (permanently empty panel); the report's "expected range" marker is algebraically pinned at 50% for every stock every day (both bounds derived from the same price it plots); all mutations lack onError (failed analyze/add/delete = silent dead spinner).
- **Committee (finder-verified):** prose guardrail is substring-blacklist-only — numberless imperative trade language can pass, incl. on hard-blocked events (cheapest fix: skip LLM enrichment entirely when hard-blocked); OpenAI/Gemini model ids look stale (`gpt-5.4`, `gemini-3.1-pro-preview`) → those providers would silently degrade to deterministic forever (Anthropic ids verified valid).

## LOW (~20, one line each)
Rounding-band drift in replay price; falsy-close deflation in `rangeStats`; catch-rates return 0% instead of null on zero-mover days; scorecard hit rate silently windowed to last 400 rows; grading on pre-rounded percentages; stale `parity-audit.md` rider line numbers; NaN gap-gate bypass on missing prevClose; missing fetch timeouts in harness/crosscheck; replay cutoff hardcodes EDT (winter drills 1h off, conservative direction); TradingView widgets get bare tickers (no exchange prefix); committee panel doesn't show whatConfirms/whatInvalidates/alertLevel; headquarters/founded/avgVolume/scorecard-score fetched but never rendered; scorecard cosmetic separator + red "—" on ungraded; nav lists sections that didn't render; dead `/copilot/validation` + unused DELETE journal endpoints; undocumented 400/500 status codes; unbounded committee prose arrays; prompt data not delimited.

## REFUTED (the process working)
- "Copilot surface is dead — only desk consumes it": **killed.** `artifacts/desk` is a real deployed Trading Desk Copilot UI at `/desk/`; intended architecture.
- Halves of two others trimmed: the scorecard "stray separator" path is unreachable (atomic writes); avgDailyRangePct *is* rendered on the report page (just not on scan rows).

## Verified clean (attacked, held)
LLM output structurally cannot reach any authoritative committee field; hard-block enforcement runs after prose enrichment on every path; provider-failure fallback is honest (degraded=true); no determinism breaks in copilot replay; commission math correct (2bps/side); stop-vs-EOD ordering at 15:50 pessimistic; qty formula matches spec; postflight divide-by-zero guarded; capture-ratio denominator matches docs.

---

## Recommended fix order

1. **Backtest truth first** (C1 cache key; H5 gap-through stop; EOD slippage; pm-window decision + parity-audit correction) — then re-run the July week to see honest numbers.
2. **Live↔harness reunification** (H1 eligible pipeline in scan.ts; H2 ceiling; H3 dollarVol base; H4 exclude today's bar; the four medium drifts) — this is most of "classifier 2.0 prep".
3. **Accountability loop** (H7 record-once; H8 external cron trigger; H9 grading order+terminal state; H10 coverage gate; holiday calendar; H11 error middleware).
4. **Polish batch** (committee hardening + model ids, UI mediums/lows).

Each batch ends with the twin-contract test this audit effectively wrote the spec for: shared-constant and gate-outcome assertions across scan.ts / engine.mjs / Pine, so this class of drift can never silently return.
