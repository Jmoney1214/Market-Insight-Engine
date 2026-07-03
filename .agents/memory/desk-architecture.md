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
- Replay plays a fixture day bar-by-bar through the **same** deterministic gates + committee pipeline as live — there is deliberately no separate replay scoring path. It is research/practice only (no execution/sim/paper).
- **Freshness synthesis (key decision):** each replay step synthesizes a FRESH, tight quote anchored to the revealed bar so the read is "as-of that historical bar." **Why:** lets replay pass the staleness/spread gates through the normal pipeline without coupling fixtures to wall-clock time or special-casing the gates. Tradeoff: synthetic spread removes real spread noise (accepted MVP limitation).
- The replay API is **stateless** — step (and date) are query params; the client owns the transport clock. **Why:** keeps the server pure/cacheable and avoids per-session server state.
- **Date selection:** the session response carries `availableDates` so the UI can offer a date picker even though current fixtures expose a single session day (2024-06-03, 80 bars). Don't hardcode the date in the UI — bind it to `availableDates`.
- Early steps naturally hard-block (insufficient-data / MARKET_QUALITY_FAILURE) and clear once enough bars accrue — this is expected warm-up, not a bug.
- **Replay explain latency rule:** the committee "explain" is a real ~10-15s AI call, so in replay it is SUSPENDED during active playback and resumes for the settled step on pause (with keepPreviousData). **Why:** firing one per bar floods abandoned requests and blanks panels. Result: deterministic panels update live; committee/Final Read text lags and resolves shortly after pausing.
- **Don't let the session query rewind playback:** pin the immutable session query as permanently fresh + no focus refetch. **Why:** a refetch hands back a new object identity, the load effect re-runs, and an in-progress replay rewinds to step 0.
- Replay journal entries are tagged with the active mode (REPLAY vs RESEARCH); a full journal browser is a later phase.
