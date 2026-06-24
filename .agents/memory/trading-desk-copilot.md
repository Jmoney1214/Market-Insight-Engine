---
name: Trading Desk Copilot architecture
description: How the Copilot product is hosted/contracted in this monorepo and its permanent safety constraint
---

# Trading Desk Copilot

A research/helper day-trading terminal built as a NEW standalone product alongside FinDesk (FinDesk left unchanged). Planned up front as phases (project tasks: foundation → deterministic core → agent committee → dashboard → replay → strategy lab/journal → safety verification), linear dependency chain.

## Permanent safety constraint
NO live trading, NO order execution, NO broker / simulated-exchange / paper-order code — ever. Deterministic code is the source of truth; LLM agents only explain/critique, never decide or execute. A safety grep (terms like submit_order, place_order, execute_trade, broker, paper-order) must stay CLEAN.

## Hosting & contracts decision (non-obvious)
`createArtifact` has NO "api" artifact type, and the monorepo uses ONE shared api-server + ONE OpenAPI→codegen pipeline (`lib/api-spec/openapi.yaml` → `@workspace/api-zod` + `@workspace/api-client-react`).
**So:** Copilot is hosted on the SHARED api-server under its own `/api/copilot/*` namespace (FinDesk routes untouched), and Copilot contracts live in the SINGLE shared `lib/api-spec/openapi.yaml` (tag `copilot`).
**Why:** smallest safe adaptation that keeps one codegen pipeline and stable generated types; avoids a parallel spec/server that the tooling doesn't support.
**How to apply:** add new Copilot endpoints/schemas to the shared spec under the `copilot` tag, run `pnpm --filter @workspace/api-spec run codegen`, implement routes in `artifacts/api-server/src/routes/copilot/` mounted at `/copilot`.

## Contract conventions established
- Safety-critical domain fields are OpenAPI enums (generated Zod enforces them at the API boundary): `mode` = LIVE|REPLAY|RESEARCH; `alertLevel` = L1..L5 or null; trigger `category` = primary_edge|entry_refinement; `validationStatus` = unproven|paper_pending|backtested_only|backtested_pending_forward|paper_validated|no_edge|insufficient_sample.
- Free-form JSON modeled as `type: object, additionalProperties: true`; nullable JSON as `type: ["object","null"]`. Timestamps are `type: string` (return `.toISOString()`), matching FinDesk; validate incoming date strings in the handler and 400 on invalid.
- DB tables (lib/db): journal_entries, strategy_registry, validation_state, history_log. Columns stay flexible text/jsonb; validation enforced at the API contract layer, not DB CHECK constraints (yet).

## Deterministic core = single source of truth (separate lib)
The deterministic engine is its OWN composite lib `@workspace/copilot-core`: it defines its own output types and imports NOTHING from the API layer. `buildCopilotEvent()` is pure and mode/source-agnostic.
**Why:** keeps decision logic independently testable (vitest, fixtures only) and prevents the API/agent layers from leaking into it — the engine stays the source of truth.
**How to apply:** api-server re-validates the engine's output at the boundary with generated zod (`GetCopilotEventResponse.parse`) and converts core→API via a mapper typed against the GENERATED `CopilotEvent` type, so contract drift fails to compile. Add engine logic in the lib → extend OpenAPI → regenerate → map. Adapters (fixture loader, delayed Yahoo v8 intraday labeled `yahoo_delayed`) live in api-server, never in the core.

## L5 hard blocks are non-overridable BY ARCHITECTURE (not by disclaimer text)
`evaluateGates()` is the SOLE producer of hard-block codes (DATA_FAILURE / STALE_QUOTE / WIDE_SPREAD / MARKET_QUALITY_FAILURE); `computeAlertLevel()` forces alertLevel L5 + l5Blocked whenever hardBlocks is non-empty. On any live-data fetch failure the route emits a canonical DATA_FAILURE L5 event rather than an error.
**Why:** safety must be structural — later LLM/agent phases must never raise the ceiling or downgrade an L5.
**How to apply:** never let a downstream layer recompute or lower alertLevel; agents may only explain an existing event. Keep hard-block production centralized in gates.

## Agent committee = prose-only enrichment, defense-in-depth (lib `@workspace/copilot-committee`)
The committee explains an existing deterministic event; it never decides. An optional LLM provider may return ONLY three prose fields (`oneSentenceRead`, `positionGuidance`, `riskNotes`) — structured decision fields are never LLM-writable, and any provider failure falls back to the deterministic read.
**Why:** prompting is not an enforceable guardrail; safety must be code-enforced after the model speaks.
**How to apply (ordered gates, all in `orchestrator.finalize` / `guardrails`):**
- `enforceHardBlock` is the idempotent absolute final gate — applied in `synthesize` AND re-applied in `finalize`; blocked events can only ever be AVOID / DO_NOT_ADD / EXIT_WARNING / THESIS_INVALIDATED.
- "Never invent data" needs MORE than forbidden-phrase scanning: a numeric-grounding guardrail (`ungroundedNumbers`) rejects provider prose containing any number token absent from the deterministic context (read+agents), because safe-looking invented figures (fake prices/levels/dates) pass phrase scans. On a hit → fall back to deterministic prose. Conservative by design (may reject valid prose; safe direction).
- The final `scanForbiddenDeep` sweep must sanitize the WHOLE payload — replace `dashboardRead` with the safety-net read AND scrub `agents` + filter top-level `warnings` — not just `dashboardRead`, or event-derived forbidden text leaks.

## Gotcha: new workspace-lib dependency needs an explicit `pnpm install`
After adding `@workspace/<lib>` to an artifact's package.json, that artifact's typecheck fails with TS2307 (cannot find module) until you re-run `pnpm install` to create the node_modules symlink — even when the lockfile reports "Already up to date".
