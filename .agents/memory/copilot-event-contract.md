---
name: CopilotEvent contract propagation chain
description: The four places a new CopilotEvent field must be wired, and why the api-server boundary mapper is the easy one to forget.
---

# Adding a field to CopilotEvent

A new field on the copilot event must be added in FOUR places, in order:

1. `lib/api-spec/openapi.yaml` — schema property (+ add to `required` if non-null),
   then run `pnpm --filter @workspace/api-spec run codegen`.
2. `lib/copilot-core/src/types.ts` — the `CopilotEvent` interface.
3. `lib/copilot-core/src/event.ts` — populate it in the `buildCopilotEvent` builder.
4. `artifacts/api-server/src/lib/copilotEvent.ts` — `coreEventToApiEvent`.

**Why:** `coreEventToApiEvent` is an **explicit allowlist** — it rebuilds the API
object field-by-field, so any field not copied there is silently dropped at the HTTP
boundary even though core produces it. Worse, the event/replay routes zod-parse their
response against the generated schema, so if the field is `required` in OpenAPI but
missing from the mapper, the route throws and returns 500 (not a quiet omission).

**How to apply:** Whenever you touch the event shape, grep `coreEventToApiEvent` and
confirm the new field is mapped before testing. Verify end-to-end with
`curl localhost:80/api/copilot/event?symbol=AAPL` and the replay endpoint, not just
unit tests — the mapper gap only shows up over the wire.
