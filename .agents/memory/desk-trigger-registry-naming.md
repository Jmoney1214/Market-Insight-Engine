---
name: Desk trigger names vs Strategy Lab registry
description: Why directional detector trigger names must resolve to a directionless registry hypothesis, or measured outcomes get silently dropped
---

# Directional trigger names must map to a registry hypothesis

Detectors emit **directional** primary-edge trigger names (e.g. `GAP_FADE_LONG`,
`GAP_CONTINUATION_SHORT`, `VOLATILITY_COMPRESSION_BREAKOUT_LONG`) — the direction
suffix drives the bias via the BULLISH/BEARISH sets. But the Strategy Lab registry
(`strategyLab.ts`) and the Edge Scoreboard key off the **directionless** hypothesis
name (`GAP_FADE`, `GAP_CONTINUATION`, `VOLATILITY_COMPRESSION_BREAKOUT`).

**Why:** the trigger-stack name flows into the journaled `strategyName`, and the
scoreboard only counts a sample when `getStrategy(strategyName)` resolves to a
promotable primary edge. If a directional name reaches journaling without
normalization, `getStrategy` returns undefined and the measured outcome is
**silently dropped** — a measurement-integrity bug (a user thinks they are building
a track record that is actually discarded). Code review rejected exactly this.

**How to apply:** the chokepoint is `canonicalHypothesisName()` in `strategyLab.ts`
(strips a trailing `_LONG`/`_SHORT` only when the base is a real registry entry).
`buildTriggerStack` runs the stack name through it, and `journalOutcomeToSample`
normalizes before lookup. When adding any new directional primary-edge trigger,
ensure its directionless base exists as a registry hypothesis, or it will neither
score nor highlight on the scoreboard. Note `TREND_CONTINUATION_*` and the
uppercase `VWAP_RECLAIM`/`VWAP_REJECTION` are pre-existing primaries with **no**
registry hypothesis, so they are intentionally unscoreable today.
