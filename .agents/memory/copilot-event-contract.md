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
`curl localhost:80/api/copilot/event?symbol=AAPL&source=yahoo_delayed` and the replay
endpoint, not just unit tests — the mapper gap only shows up over the wire. (The live
`source` query value is `yahoo_delayed`, not `live`; default is `fixture`.)

## Input-only gating context is the OPPOSITE case — no mapper edit

Out-of-band detector gating context (`priorClose`, `earningsTime`, `benchmarkReturnPct`)
lives ONLY on `BuildEventInput` + `TriggerContext`, never on the wire `CopilotEvent`.
Adding such a field needs just: extend both interfaces, thread it in `event.ts`
`detectTriggers(...)`, source it in `copilotData.ts` (live) while fixtures/replay leave
it null. It does NOT need an openapi/codegen/`coreEventToApiEvent` change, because the
*resulting triggers* ride the already-mapped `triggers[]` array. Keep it off `Features`
so it never leaks onto the snapshot. **Why:** these are dormant-gating inputs, not
outputs; the detector reports `detected:false` when null so fixtures never fabricate a
signal.
