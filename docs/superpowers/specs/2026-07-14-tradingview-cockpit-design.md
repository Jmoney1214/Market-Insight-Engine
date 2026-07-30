# TradingView Execution Cockpit — Design Spec

**Date:** 2026-07-14
**Status:** Approved (brainstorming), pending implementation plan
**Depends on:** PR #29 (research-desk build, merged to `main` at `e8b13ef`)

## 1. Purpose

Turn the operator's live TradingView chart into an **execution cockpit**: the
desk's verdicts (catalyst, dilution, committee, Kronos, sentiment, scan
pedigree) are painted directly onto whatever chart is open, so the trigger
decision never requires leaving the chart. The operator's own Pine scripts
(ORB Matrix, Jump-Day) remain the **trigger** source; the desk is the
**annotation/gate** layer beside them — consistent with the standing law
*signals fire on triggers alone, gates are annotations only*.

## 2. The hard constraint (shapes everything)

**Pine Script cannot call the desk** — Pine has no HTTP. Desk state reaches the
chart through exactly two doors:

1. **MCP draws it on** — an external process paints via the TradingView MCP
   (`draw_shape`, `alert_create`, `draw_clear`). This is "the alert rail."
2. **Pine → webhook out** — Pine fires an alert webhook *to* the desk.

This cockpit uses **door 1 only**. Pine scripts are untouched.

A second consequence: TradingView native alerts evaluate **price/indicators
only** — they cannot evaluate desk state ("committee flipped to AVOID"). So the
one background interrupt *requires a desk-side watcher* that computes the state
and fires the alert through the MCP.

## 3. Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Chart's primary job | **Execution cockpit** (desk → chart annotations + alerts) |
| Which verdicts are loud | **2 per chart**, the rest small |
| How the loud pair is chosen | **Manual**, no auto-classifier |
| How manual selection persists | **Per-symbol memory** in Supabase; auto-loads |
| Fallback pair (symbol never set) | Catalyst + Committee |
| Which changes interrupt (alert) | **Committee escalation only** — into L4/L5 or flips AVOID |
| Everything else | Silent HUD update |
| Architecture | **Hybrid** — painter on-demand; watcher rides the merged scan scheduler |
| Tracked-symbol source for watcher | **Desk watchlist ∪ current chart symbol** (TV watchlist widget not used) |

## 4. Goals / Non-goals

**Goals**
- One compact HUD on the active chart: 2 loud badges + 4 small, per-symbol pair.
- One background interrupt: committee escalation, fires even when the operator
  is on a different chart.
- Reuse merged infrastructure (research, explain, kronos, scan routes; scan
  scheduler; MCP alert-create). Aggregator + painter, not new brains.
- Zero token cost for background watching.

**Non-goals (YAGNI)**
- Auto-classifier bucketing of symbols.
- Catalyst-death / dilution / Kronos interrupts (committee-only for now; the
  watcher is built so these are a small additive change later).
- A full always-on second-by-second watcher.
- Any change to existing Pine scripts.
- Order placement / broker authority (banned — ADR 0001).

## 5. Components

### 5.1 Cockpit prefs (persistence)
- New Supabase table `cockpit_prefs`: `symbol` (PK, text) → `loud_pair`
  (`text[]`, exactly 2 of `{catalyst, dilution, committee, kronos, sentiment, scan}`),
  `updated_at`.
- Drizzle schema in `lib/db/src/schema/`, added to `tablesFilter` like the
  other Wave tables.
- Read/write helpers in a new `artifacts/api-server/src/lib/cockpitStore.ts`.
- Missing symbol → fallback `["catalyst", "committee"]`.

### 5.2 Cockpit assembler
- New route `GET /api/cockpit/:symbol` in
  `artifacts/api-server/src/routes/cockpit.ts`.
- Aggregates from existing sources, each degrading to `UNKNOWN` on absence:
  - **catalyst / dilution** ← latest persisted research packet for the symbol
    (`research_packets` → catalyst `verificationStatus`, capital-structure
    dilution flags).
  - **committee** ← deterministic committee read (level + recommendation).
    **Deterministic by default — no LLM, no tokens.** Optional `?prose=1`
    includes the one-sentence LLM read (spends tokens, on demand only).
  - **kronos** ← `getGatedForecast(symbol)` → `p_up` + `gated`.
  - **sentiment** ← research sentiment reading (band) when news exists.
  - **scan** ← scan scorecard / premarket pedigree (rank + score) if present.
- Returns `{ symbol, loudPair, verdicts: { catalyst, dilution, committee,
  kronos, sentiment, scan } }`, each verdict a small `{ label, state, tone }`.

### 5.3 Chart painter (MCP-driven)
- New module `artifacts/api-server/src/lib/cockpitPainter.ts` (or a thin
  orchestration the assistant drives via the MCP — see Open Questions).
- Input: a cockpit read. Actions via TradingView MCP:
  1. `draw_clear` scoped to prior cockpit drawings (tagged prefix) so nothing
     piles up on repaint.
  2. `draw_shape` text labels: the 2 loud verdicts large + color-coded
     (green = confirmed/bullish, red = blocked/bearish/dilution, amber =
     partial/unknown); the other 4 as a compact small strip.
  3. Optional single `draw_shape` horizontal line for a key desk level when one
     exists (e.g., catalyst-invalidation price) — deferred, not v1.
- Trigger: on-demand — chart load, explicit "cockpit SYM", or manual refresh.
  Not a hot loop.
- If the MCP/TV desktop app is disconnected, painter no-ops gracefully; the
  assembler still returns data.

### 5.4 Committee escalation watcher
- Extends the merged scan scheduler (`artifacts/api-server/src/lib/scan.ts`).
- Each scheduler tick, over tracked symbols (desk watchlist ∪ current chart
  symbol):
  1. Compute the **deterministic** committee read (level + recommendation) —
     **zero tokens**.
  2. Compare to last-known state per symbol (kept in memory / a small table).
  3. On a **transition** into L4/L5 **or** a flip to AVOID (not merely being at
     that level), fire a TradingView alert via MCP `alert_create`.
  4. Dedupe: fire once per escalation edge, re-arm only after the symbol
     de-escalates.
- On a failed read for a symbol, skip it this tick (never fire on missing data).

## 6. Data flow

```
Chart load / "cockpit SYM"
   -> GET /api/cockpit/:symbol  (assembler, deterministic, token-free)
   -> painter: draw_clear + draw_shape (2 loud + 4 small)

Scheduler tick
   -> watcher: deterministic committee read over tracked symbols
   -> on escalation edge -> MCP alert_create -> operator pinged
```

## 7. HUD rendering (BMNR example, loud pair = catalyst + dilution)

```
CATALYST  ✓ CONFIRMED        (large, green)
DILUTION  ⚠ S-3 ACTIVE       (large, red)
committee L2·WAIT · kronos 0.61 gated · sent NEUTRAL · scan #4   (small)
```

Operator's ORB / Jump-Day Pine scripts render untouched underneath.

## 8. Guards (standing laws)

- **Token guard** — background watcher uses the deterministic committee read
  only; LLM prose renders solely when the operator opens a cockpit with
  `?prose=1`. Background watching costs zero tokens.
- **Honesty / fail-closed** — any unavailable verdict shows `UNKNOWN`, never
  fabricated, matching the rest of the desk.
- **Safety** — cockpit is display + alerts only. No order/broker authority ever
  (ADR 0001).
- **No new brains** — every verdict comes from an already-merged, already-tested
  desk computation; the cockpit only aggregates, paints, and alerts.

## 9. Testing

- `cockpitStore` — prefs read/write, fallback pair, pair-validation (exactly 2,
  from the allowed set).
- assembler — each verdict degrades to `UNKNOWN` independently; deterministic
  path spends no provider calls.
- watcher — escalation **edge** detection (fires on transition, not on level);
  dedupe/re-arm; skip-on-failed-read; no token spend.
- painter — draw_clear-before-draw idempotence; graceful no-op when MCP down.

## 10. Out of scope (restated)

Auto-classifier; non-committee interrupts; always-on second-by-second watcher;
Pine script changes; order placement.

## 11. Open questions for the plan

1. **Painter host:** does the painter run *inside* the api-server (a module that
   itself speaks MCP), or is it assistant-driven (the operator/agent invokes the
   MCP paint using the assembler's JSON)? The api-server does not currently hold
   an MCP client; assistant-driven is lighter for v1. To resolve in the plan.
2. **Watcher tracked-set table:** reuse the existing desk watchlist table as the
   source of tracked symbols, plus a way to register "the chart I'm on."
3. **Escalation state store:** in-memory (lost on restart, re-arms next tick) vs
   a small `cockpit_committee_state` table (survives restart). Lean in-memory
   for v1.
