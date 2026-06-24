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
