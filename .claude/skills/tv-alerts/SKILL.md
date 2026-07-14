---
name: tv-alerts
description: >
  Turn a gated desk signal into a TradingView alert on the alert rail, via the
  tradingview-mcp server. Use on the operator's Mac when they say "alert me on
  SYMBOL", "set the TV alert", or want a desk-approved long setup wired to
  TradingView's native push/email. TradingView is the ONLY alert rail — never
  Telegram. Alerts notify; they never place orders.
---

# tv-alerts

Wire a **deterministic, desk-gated** long signal to a TradingView alert so the
operator gets native app-push / email when the setup triggers. This is a
notification rail, not an execution path — the operator's finger is still the
only thing that presses buy (ADR 0001, no order authority ever).

## What qualifies as a signal worth alerting

A signal is alertable ONLY when it is a frozen, gated LONG setup from the desk:
- direction is LONG (never SHORT — long-only product invariant)
- it carries a trigger level, an initial stop, and an expiry/session bound
- it passed the desk's gates (catalyst / committee did not veto)

If asked to alert on a raw price level with no desk gate, say plainly that this
rail is for gated setups and offer to alert the level as a bare price cross,
clearly labeled un-gated.

## BANNED — never use

- **`ui_evaluate`** on the MCP (never-use surface, standing operator rule).
- **Telegram** or any non-TradingView alert channel — TradingView is the rail.
- Any alert body shaped like a broker order (no order payloads, no webhooks to
  execution venues). Alerts are human notifications only.

## Procedure

1. Confirm the `tradingview` MCP is connected and the chart is on the signal's
   symbol + 5-minute timeframe, extended hours ON (same preconditions as
   tv-cockpit: port 9222 open).
2. Compose the alert from the frozen signal:
   - **Condition**: price crossing the trigger level (or the twin's entry
     condition if the reviewed Pine is on the chart — an alert on the strategy's
     own entry is tightest).
   - **Message**: `LONG {SYMBOL} trigger {level}, stop {stop}, invalidation
     {reason}, expires {time}` — human-readable, no order syntax.
   - **Expiry**: the signal's session bound (long-only intraday = same day; the
     desk flattens by 15:50 ET, so never leave an alert armed overnight).
3. Create the alert via the MCP's alert tool. Confirm it was created (read it
   back).
4. Report: the symbol, condition, message, and expiry set — and remind the
   operator this is a notification; the buy decision and the order are theirs.

One caveat to state honestly when relevant: TradingView has no server API for
creating alerts, so this rail depends on the MCP driving the desktop app with it
open and the chart loaded. It is a supervised, at-the-desk tool.
