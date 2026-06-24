---
name: Desk replay completeness gating
description: Why early REPLAY steps are L5-blocked and how that constrains/testing any alertLevel-gated desk feature
---

# Desk REPLAY is L5-blocked until the session is "complete enough"

In the `desk` artifact, REPLAY reveals fixture bars incrementally. The market-quality
gate computes completeness as `barsRevealedSoFar / expectedFullSession`, so the early
and middle steps of a replay session fail completeness (e.g. 0.167) and produce a
hard block → `l5Blocked: true` / `alertLevel: "L5"`. Only the later steps (roughly the
last ~40% of the session) become unblocked (L2/L3).

**Why this matters:** any desk feature that is gated on "not blocked / not L5" (the
PERMANENT safety rule "Blocked/L5 never actionable") will appear to do nothing during
the early replay window even though triggers are already being *detected* in the board.
The live trigger banner is the prime example: it is correctly suppressed on L5, so it
only fires in the unblocked tail of a replay run — never in the first steps.

**How to apply / verify:** to exercise an alertLevel-gated feature in replay, do NOT
step one bar at a time from the open (you stay inside the L5 window). Jump the replay
position slider (`aria-label="Replay position"`, range 0..totalSteps-1) toward the far
right to land on an unblocked step, then look for a fresh trigger transition. For the
AAPL fixture the only false→true transition that happens *while unblocked* is near the
final steps (OPENING_RANGE_BREAKOUT + VOLUME_EXPANSION), so jumping the slider to the
end is the reliable way to see the banner.

**Note:** REPLAY also differs from the live FIXTURE read, which normalizes bars to
"now" and reports completeness 100% (L3, unblocked). So "works in live fixture" does
not imply "works at an arbitrary replay step".
