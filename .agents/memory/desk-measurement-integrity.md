---
name: Desk measurement-subsystem invariants
description: Integrity rules for Trading Desk Copilot's edge scoreboard / journal — what may validate an edge, and the no-paper-trading wording rule.
---

# Edge scoreboard / journal integrity (product "desk")

## Only confirmed, attributed, whitelisted-action outcomes can validate an edge
A journal entry yields a scoreboard sample ONLY if it resolves to a promotable
PRIMARY-edge hypothesis, has `outcomeConfidence` MANUAL_CONFIRMED, a finite
`rMultiple`, AND an explicit whitelisted `action` (SCOREABLE_ACTIONS). Entry-
refinement "folklore" (FVG/BOS/CHOCH/liquidity_sweep/etc.) is `promotable:false`
and can NEVER be proven. CURRENT_PRICE_ASSUMED / WATCH_ONLY / manual annotations
never promote.

**Why:** the journal API accepts arbitrary `manualOutcome` JSON, so a malformed
or legacy payload that merely looks scoreable (strategy + MANUAL_CONFIRMED +
numeric R, but no action) could leak into the scoreboard. Integrity must be
enforced in deterministic core (`journalOutcomeToSample` in copilot-core), never
assumed from UI behavior.

**How to apply:** any new journal write path (UI or API) must still pass the core
whitelist; do not relax `journalOutcomeToSample`. Produce a sample only by
emitting a whitelisted action.

## No "paper" in the UI
The permanent product constraint forbids paper-trading wording. The validation
enum keeps internal `paper_validated` / `paper_pending` and SampleKind `paper`
(out-of-sample REPLAY provenance), but ALL user-visible strings remap to
"REPLAY" (desk `validation-status.ts` label map + scoreboard column header).

**How to apply:** never surface the literal word "paper" in desk UI; remap at the
display layer.
