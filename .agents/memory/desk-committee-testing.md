---
name: Desk committee / api-server deterministic testing
description: How to test the Trading Desk Copilot committee + api-server deterministically and keyless in this env, where all AI providers are configured.
---

# Deterministic, keyless committee tests

**Rule:** to force the committee down its deterministic (no-LLM) path in tests, set the
env var `COPILOT_LLM_PROVIDER` to a non-provider value (e.g. `"none"`). `selectProviderId()`
fails closed to `null` when it does not name a real provider, so `runCommittee` runs purely
deterministic — `provider` comes back `"deterministic"`, fast and reproducible.

**Why:** this Replit env has ALL THREE AI integrations configured (openai/gemini/anthropic).
You CANNOT simulate "no key" by emptying the `AI_INTEGRATIONS_*` vars — the integration
client throws at *import* time if they are blank, which crashes the suite before any test
runs. Steering provider *selection* (not credentials) is the only clean lever. This also
makes the same harness cover spec items "missing LLM key → deterministic fallback" and
"replay needs no API keys" honestly. The live-provider (openai) path must be verified
separately via e2e against the running server, not in the unit harness.

**How to apply:** in `artifacts/api-server/vitest.config.ts`, `test.env` sets
`COPILOT_LLM_PROVIDER: "none"` (plus `NODE_ENV: "production"` + `LOG_LEVEL: "silent"` so the
pino logger does not spawn a pino-pretty worker thread during tests). The server is authored
NodeNext (explicit `.js` specifiers on relative imports), so vitest needs
`resolve.extensionAlias: { ".js": [".ts", ".js"] }` to resolve those back to `.ts` sources.
supertest runs against the default-exported Express app, which never calls `listen()`.

# §22 forbidden-execution grep

The spec's safety grep legitimately matches only `lib/copilot-committee/src/vocab.ts`
(the ban-list definition) and the isolated banned-word test — §22 explicitly permits both.
Product source has zero execution paths. A broad grep for `paper[- ]?trad`/`simulat*` also
hits the safety *disclaimers* ("never executes, simulates, routes, or paper-trades") and the
benign `paper_validated` edge status — those are negations/labels, not execution code.
