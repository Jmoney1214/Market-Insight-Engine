---
name: Desk terminal (Trading Desk Copilot)
description: Architecture, safety constraint, and latency gotchas for the read-only "desk" research terminal artifact
---

# Trading Desk Copilot ("desk" artifact)

Read-only, multi-agent AI day-trading RESEARCH/HELPER terminal. Separate artifact (slug `desk`, previewPath `/desk/`) alongside the UNCHANGED FinDesk web artifact (served at `/`). Shares the same api-server at `/api`.

## PERMANENT safety constraint
- NO live trading / order execution / broker / paper / simulated-exchange code or UI — ever. The LLM committee only explains/critiques.
- Forbidden UI phrases live in `lib/copilot-committee/src/vocab.ts` (e.g. "buy now","sell now","execute","place order","must enter","guaranteed", etc.).
- **All AI-generated prose must be rendered through `safeText` / `safeList`** from `artifacts/desk/src/lib/safety.ts`, which redact forbidden phrases at runtime. Controlled enums (bias/status/verdict) don't need it. Any NEW free-form LLM/event prose added to a panel must also go through safeText/safeList.
- **Why:** the committee output is LLM-generated and could surface execution-style language; static source greps only cover our code, not model output, so the runtime sanitizer is the real guardrail.

## explain endpoint latency (gotcha)
- `GET /api/copilot/explain` calls real OpenAI: **~11-12s per call and is NOT cached server-side** (second identical call is also ~12s).
- Consequence: on every fresh page load the Analyst Committee + Final Read panels show loading skeletons for ~12s before populating. That is expected, not a bug. If the panels show the skeleton (not the red error text), the query is in-flight, not failing.
- Client mitigation: the explain react-query has `staleTime`/`gcTime` so it isn't refetched redundantly within a session. **Improvement worth doing later:** cache explain server-side by eventId so repeat loads are instant.

## Testing gotcha
- `artifacts/desk` needs its own `vitest.config.ts` (node env) because plain `vitest run` loads `vite.config.ts`, which throws "PORT required". Run via `pnpm --filter @workspace/desk run test`.

## Chart
- `ChartPanel` plots ONLY real point-in-time level lines (price/vwap/ORH/ORL + risk-reward entry/inval/target) as recharts `ReferenceLine`s. **Never fabricate OHLC candles.** Level names/values render as a corner legend (not inline labels) to avoid overlap when levels are close.

## Replay mode (fixture-backed time machine)
- Engine: `lib/copilot-core/src/replay.ts` (`getReplaySession`, `buildReplayInput`). 0-based step, reveals `bars.slice(0, step+1)`, rejects NODATA/no-bar fixtures. Replay reads run through the **same** deterministic gates/committee pipeline as live — no separate code path.
- **Freshness synthesis:** replay synthesizes a FRESH quote anchored to the revealed bar (`quoteTime = lastBar.t`, `nowMs = lastBar.t*1000`, tight bid/ask ±0.02). **Why:** this makes a replay an "as-of that historical bar" read so the staleness gate passes without coupling fixtures to wall-clock time or special-casing the gate. Tight synthetic spread intentionally removes spread noise (accepted MVP limitation).
- API is **stateless** — `/api/copilot/replay/{session,event,explain}` take `step` as a query param; routes reuse `buildCopilotEvent`/`runCommittee`. Early steps (<~47 bars) naturally L5 MARKET_QUALITY_FAILURE and warm up as bars accrue (MIN_COMPLETENESS 0.6×~78). Fixtures are ONE day 2024-06-03, 80 bars, 5-min spacing; AAPL/MSFT/TSLA share the same date+length.
- Transport: zustand store `use-replay-store.ts` (mode, date, step, totalSteps, playing, speed∈{1,5,10,30}) + a `setInterval(1000/speed)` clock in `Terminal.tsx` that advances step. Store test reset uses `setState(replayInitialState)` WITHOUT `replace:true` (replace wipes the action fns).
- **Replay explain latency rule:** explain is the same ~12s AI call, so in replay it is SUSPENDED during active playback (`enabled: replayReady && !playing`) and uses `placeholderData: keepPreviousData`. Committee/Final Read text intentionally LAGS the bar during playback and resolves ~12s after you pause. Deterministic panels (LiveBoard/Chart/Gates) update instantly from the fast event query.
- **Don't let the session query rewind playback:** the replay session query is pinned `staleTime: Infinity` + `refetchOnWindowFocus: false` (fixtures are immutable). **Why:** otherwise a focus-refetch hands back a new object identity, the load effect re-runs `loadSession`, and step rewinds to 0 mid-replay.
- Journaling: `PositionPanel` ARCHIVE TRACKING NOTE POSTs `/api/copilot/journal` tagged with `event.mode` (REPLAY/RESEARCH). Full journal browser is a later phase.
