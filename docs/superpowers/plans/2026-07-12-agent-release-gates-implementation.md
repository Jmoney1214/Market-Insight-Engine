# Agent Research Release Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved authenticated, fully traced, Supabase-backed three-agent research slice and keep every new research packet unpublishable until the exact version fingerprint passes five full-suite trials and receives an explicit human approval.

**Architecture:** Keep one product and one Express runtime. Put stable contracts and hashing in `lib/research-contracts`, keep orchestration/authentication in `artifacts/api-server`, make committed Supabase SQL the sole DDL authority for the private control-plane schemas, and expose review actions only through the protected Desk/API. The deterministic scanner, `CopilotEvent`, committee lenses, gates, journal, and scoreboard remain strategy truth and receive research packets only as read-only context.

**Tech Stack:** TypeScript 5.9, Node 20, Express 5, Zod 4, node-postgres/Drizzle query mapping, Supabase CLI/Postgres/pgTAP, OpenAI official SDK Responses API, Anthropic official SDK Messages API, React 19, TanStack Query, Zustand, Vitest, Supertest, Playwright, pnpm 10.

## Global Constraints

- Work only in `/Users/justinetwaru/Projects/Market-Insight-Engine-agent-release-gates` on `codex/agent-release-gates`; never edit the source checkout or its running server.
- Do not read, copy, print, or commit `.env` files or provider/database credentials.
- Do not mutate remote Supabase until the plan reaches an explicit `REMOTE SUPABASE APPROVAL GATE` and the user approves the exact SQL/action in that turn.
- Protect every `/api` operation except `GET /api/healthz` and `GET /api/copilot/healthz`.
- Human, service, and manifest-bound agent application credentials have no required expiry; provider and Supabase infrastructure keys are not application identities.
- Before every live run, require an authenticated Alpaca request with `feed=sip`; never fall back to IEX, Yahoo, delayed data, cache, or fixtures.
- Probe FMP only for a manifest-declared FMP task; a required FMP failure blocks the run.
- Use OpenAI for the Market Research Lead, Anthropic for Catalyst Verifier, and the provider opposite the author for Source Guardian/model grading.
- No provider may grade output it authored. No model grade is a human approval.
- Persist requested and observed model IDs, prompts, skills, manifests, tool schemas/implementations, policies, code/config hashes, complete redacted traces, usage, computed cost, latency, retries, errors, and evidence lineage.
- Keep canonical learning/evaluation cases in Supabase; worker agents may retrieve `TRAINING` only and may propose `CANDIDATE`, but only a human may promote/quarantine/supersede.
- The active suite contains at least 20 cases: one known-catalyst positive and one no-catalyst negative for each of the ten required instrument classes.
- Publication requires five consecutive full-suite passing batches, all zero-tolerance thresholds, passing human grades for every case bundle, and a signed human decision bound to fingerprint + policy + suite + rubric + trial-matrix hashes.
- Agents never receive broker, order, DDL, shell, unrestricted HTTP, filesystem, email, or arbitrary browser tools and never write signals, gates, scores, risk values, or execution state.
- Every task follows red-green-refactor, runs its focused tests, then runs the phase gate before committing.
- After each phase, run full workspace tests, full typecheck, read-only Supabase connectivity, and a live SIP probe; add FMP/model/browser checks only when that capability exists.
- The current disk has been observed near capacity and the committed lockfile is stale relative to workspace overrides. Do not start dependency/Docker work until `df -h` shows at least 5 GiB free.

## Recurring Phase Verification

Task 0 is the environment/baseline prerequisite. After every completed implementation task from Task 1 onward, rerun `pnpm -w test`, `pnpm run typecheck`, `node tools/research/audit_runtime_sources.mjs`, and a real connector check before commit. Through Task 6 use:

```bash
node tools/research/verify_live_connectors.mjs --alpaca-sip --fmp profile:AAPL
```

The `profile:AAPL` argument is the explicit FMP smoke-task declaration; tasks that declare no FMP family omit `--fmp`. From Task 7 onward use the typed verifier:

```bash
pnpm --filter @workspace/scripts exec tsx src/verify-live-connectors.ts --alpaca-sip --fmp profile:AAPL
```

After Gate 2 is applied, also run `verify-live-phase.ts` so the same checks are persisted as `LIVE_SMOKE`. From Task 8 onward add one real OpenAI and Anthropic call; from Task 12 onward add the browser test. Any unavailable credential, non-SIP response, required FMP/model failure, test failure, or audit failure blocks the phase—never replace it with cached, fixture, delayed, or mock success.

---

## File Structure Map

### Shared contracts

- `lib/research-contracts/src/auth.ts`: principal, scope, credential, session, and route-policy contracts.
- `lib/research-contracts/src/run.ts`: run modes/states/outcomes, preflight results, and stable errors.
- `lib/research-contracts/src/version.ts`: configured/observed snapshots and release fingerprint inputs.
- `lib/research-contracts/src/trace.ts`: model/tool/attempt/usage/cost trace contracts.
- `lib/research-contracts/src/evidence.ts`: immutable evidence nodes, typed links, claims, audits, and graph verdicts.
- `lib/research-contracts/src/evaluation.ts`: cases, suite manifest, trial batches, grades, release/packet decisions.
- `lib/research-contracts/src/packet.ts`: candidate seed, agent outputs, and candidate packet.
- `lib/research-contracts/src/canonical.ts`: deterministic JSON canonicalization and SHA-256/HMAC helpers.

### Database and migrations

- `supabase/migrations/*`: sole DDL authority for private schemas, roles, grants, RLS, triggers, and locked decision/publication functions.
- `supabase/tests/*.sql`: pgTAP authorization, append-only, transition, lineage, suite, and concurrency tests.
- `supabase/seed/learning_case_import.sql`: synthetic local-only rows for SQL mechanics; never canonical live cases.
- `lib/db/src/controlPlane/pools.ts`: named least-privilege pools.
- `lib/db/src/controlPlane/authRepository.ts`: credential/session/request-audit persistence.
- `lib/db/src/controlPlane/runRepository.ts`: run creation and state transitions.
- `lib/db/src/controlPlane/versionRepository.ts`: configured/observed snapshot persistence.
- `lib/db/src/controlPlane/traceRepository.ts`: call intent/response/event persistence and orphan reconciliation.
- `lib/db/src/controlPlane/evidenceRepository.ts`: immutable evidence graph persistence.
- `lib/db/src/controlPlane/evaluationRepository.ts`: case/suite/trial/decision queries and locked functions.
- `lib/db/src/controlPlane/decisionRepository.ts`: typed principal/case/release/packet decision functions.

### API authentication and orchestration

- `artifacts/api-server/src/auth/*`: credential verification, sessions/CSRF, route registry, middleware, resource authorization, and idempotency.
- `artifacts/api-server/src/research/preflight/*`: SIP/FMP/model provider checks.
- `artifacts/api-server/src/research/versioning/*`: manifest loader and configured/observed fingerprint snapshots.
- `artifacts/api-server/src/research/tracing/*`: redaction, call intent/response capture, retries, cost, and reconciliation.
- `artifacts/api-server/src/research/tools/*`: dedicated read-only market/FMP/primary-source tools.
- `artifacts/api-server/src/research/agents/*`: Lead, Catalyst Verifier, Source Guardian, opposing graders, prompts, and skills.
- `artifacts/api-server/src/research/evaluation/*`: deterministic graders, suite validator, five-trial runner, and release gate.
- `artifacts/api-server/src/research/testing/factories.ts`: typed test-only builders for runs, manifests, snapshots, matrices, and provider responses.
- `artifacts/api-server/src/routes/auth.ts`, `research.ts`, `evaluation.ts`, `governance.ts`: protected API surfaces.

### Desk, MCP, and verification

- `artifacts/desk/src/auth/*`: in-memory permanent-key exchange and cookie/CSRF session state.
- `artifacts/desk/src/components/AgentReleaseReviewPanel.tsx`: compact protected review panel.
- `artifacts/desk/src/hooks/use-agent-release-review.ts`: review queue/matrix/decision queries.
- `artifacts/mcp-gateway/src/server.ts`: service credential, exact API paths, and idempotency propagation.
- `scripts/src/verify-live-connectors.ts`: Phase 0 redacted SIP/FMP proof.
- `scripts/src/verify-live-phase.ts`: persisted Phase 3+ `LIVE_SMOKE` verifier.
- `scripts/src/bootstrap-auth.ts`: one-time audited human principal/credential issuance.
- `.github/workflows/ci.yml`: deterministic unit/type/SQL gates.
- `.github/workflows/live-smoke.yml`: manual protected live connector/model/browser gate.

---

### Task 0: Restore a Reproducible Isolated Baseline

**Files:**
- Modify: `pnpm-lock.yaml`
- Test: existing workspace suites

**Interfaces:**
- Consumes: committed `pnpm-workspace.yaml` overrides and current workspace package manifests.
- Produces: a lockfile accepted by `pnpm install --frozen-lockfile` and a clean worktree baseline.

- [ ] **Step 1: Verify operational prerequisites without modifying the repository**

Run:

```bash
df -h .
git status --short
pnpm --version
node --version
supabase --version
docker --version
```

Expected: at least 5 GiB free; branch is `codex/agent-release-gates`; only this plan may be uncommitted; pnpm major 10; Node is 20 or newer (CI remains pinned to 20); Supabase and Docker are available. Run `docker info` and require a live daemon. If disk is below 5 GiB, Docker is stopped, or the Supabase CLI is older than 2.81.3, stop and request the specific environment action instead of bypassing the check.

After the operator approves the environment action, upgrade the existing Homebrew Supabase installation with `brew upgrade supabase`, start Docker Desktop, rerun the commands above, and record the observed versions in the task evidence. Do not install or upgrade global tooling without that approval.

- [ ] **Step 2: Regenerate only the isolated lockfile**

Run:

```bash
pnpm install --lockfile-only --no-frozen-lockfile
pnpm install --frozen-lockfile
```

Expected: both commands exit 0; no file except `pnpm-lock.yaml` changes.

- [ ] **Step 3: Prove the inherited baseline**

Run:

```bash
pnpm -w test
pnpm run typecheck
node --test tools/research/test/*.test.mjs
```

Expected: current 276 workspace tests pass, typecheck passes, and the standalone research tests pass. If counts grow because another task landed, require zero failures rather than the historical count.

- [ ] **Step 4: Verify the existing frozen-install CI gate remains intact**

The current unit and typecheck jobs already run `pnpm install --frozen-lockfile`. Verify both occurrences remain:

```bash
rg -n 'pnpm install --frozen-lockfile' .github/workflows/ci.yml
```

Expected: exactly the existing unit-test and typecheck install steps are listed; no CI edit is required in Task 0.

- [ ] **Step 5: Commit**

```bash
git add pnpm-lock.yaml
git commit -m "chore: restore reproducible workspace install"
```

### Task 1: Establish Live-versus-Historical Source Truth

**Files:**
- Create: `artifacts/api-server/src/lib/sourcePolicy.ts`
- Create: `artifacts/api-server/src/lib/sourcePolicy.test.ts`
- Modify: `artifacts/api-server/src/routes/copilot/event.ts`
- Modify: `artifacts/api-server/src/routes/copilot/explain.ts`
- Modify: `artifacts/api-server/src/routes/copilot/event.test.ts`
- Modify: `artifacts/api-server/src/routes/copilot/explain.test.ts`
- Modify: `artifacts/desk/src/hooks/use-terminal-store.ts`
- Modify: `artifacts/desk/src/hooks/use-replay-store.ts`
- Modify: `artifacts/desk/src/pages/Terminal.tsx`
- Modify: `artifacts/desk/src/components/SymbolPicker.tsx`
- Modify: `lib/api-spec/openapi.yaml`
- Modify generated: `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`
- Modify: `artifacts/mcp-gateway/src/server.ts`
- Create: `tools/research/audit_runtime_sources.mjs`
- Create: `tools/research/runtime_source_classifications.json`
- Create: `tools/research/verify_live_connectors.mjs`
- Create: `tools/research/test/runtime_source_audit.test.mjs`
- Create: `tools/research/test/live_connector_probe.test.mjs`
- Test: `artifacts/api-server/src/lib/sourcePolicy.test.ts`
- Test: `artifacts/desk/src/hooks/use-replay-store.test.ts`
- Test: `artifacts/mcp-gateway/src/server.test.ts`

**Interfaces:**
- Produces: `resolveSourcePolicy(input: SourcePolicyInput): SourcePolicyDecision`.
- Produces a repository-wide runtime-source reachability audit with mandatory `TEST_ONLY`, `REPLAY_ONLY`, or `UI_DONOR` classification for fixture/mock/demo assets.
- `SourcePolicyDecision` permits live SIP or a named canonical historical case revision/evidence hash; it fails with `LIVE_SOURCE_REQUIRED`, `REPLAY_SCOPE_REQUIRED`, or `CANONICAL_CASE_REQUIRED` otherwise.

- [ ] **Step 1: Write the failing source-policy tests**

```ts
import { describe, expect, it } from "vitest";
import { resolveSourcePolicy } from "./sourcePolicy.js";

describe("resolveSourcePolicy", () => {
  it("defaults omitted live source to Alpaca SIP", () => {
    expect(resolveSourcePolicy({ mode: "LIVE", source: undefined, canReplay: false })).toEqual({
      ok: true,
      source: "alpaca_live",
      provenanceMode: "LIVE_SIP",
    });
  });

  it("rejects fixture data in LIVE mode", () => {
    expect(resolveSourcePolicy({ mode: "LIVE", source: "fixture", canReplay: true })).toMatchObject({
      ok: false,
      code: "LIVE_SOURCE_REQUIRED",
    });
  });

  it("permits historical fixtures only with replay scope", () => {
    expect(resolveSourcePolicy({
      mode: "REPLAY",
      source: "fixture",
      canReplay: true,
      caseRevisionId: "case-revision-1",
      evidenceHash: "sha256:historical-evidence",
    })).toMatchObject({
      ok: true,
      provenanceMode: "HISTORICAL_FIXTURE",
      caseRevisionId: "case-revision-1",
    });
  });

  it("rejects an unversioned repository fixture as historical truth", () => {
    expect(resolveSourcePolicy({ mode: "RESEARCH", source: "fixture", canReplay: true })).toMatchObject({
      ok: false,
      code: "CANONICAL_CASE_REQUIRED",
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/sourcePolicy.test.ts
```

Expected: FAIL because `sourcePolicy.ts` does not exist.

- [ ] **Step 3: Implement the pure policy**

```ts
export type SourcePolicyInput = {
  mode: "LIVE" | "REPLAY" | "RESEARCH";
  source: "fixture" | "yahoo_delayed" | "alpaca_live" | undefined;
  canReplay: boolean;
  caseRevisionId?: string;
  evidenceHash?: string;
};

export type SourcePolicyDecision =
  | { ok: true; source: "alpaca_live"; provenanceMode: "LIVE_SIP" }
  | { ok: true; source: "fixture"; provenanceMode: "HISTORICAL_FIXTURE"; caseRevisionId: string; evidenceHash: string }
  | { ok: false; status: 400 | 403; code: "LIVE_SOURCE_REQUIRED" | "REPLAY_SCOPE_REQUIRED" | "CANONICAL_CASE_REQUIRED" };

export function resolveSourcePolicy(input: SourcePolicyInput): SourcePolicyDecision {
  const source = input.source ?? (input.mode === "LIVE" ? "alpaca_live" : "fixture");
  if (input.mode === "LIVE") {
    return source === "alpaca_live"
      ? { ok: true, source, provenanceMode: "LIVE_SIP" }
      : { ok: false, status: 400, code: "LIVE_SOURCE_REQUIRED" };
  }
  if (source !== "fixture") return { ok: false, status: 400, code: "LIVE_SOURCE_REQUIRED" };
  if (!input.canReplay) return { ok: false, status: 403, code: "REPLAY_SCOPE_REQUIRED" };
  if (!input.caseRevisionId || !input.evidenceHash) {
    return { ok: false, status: 400, code: "CANONICAL_CASE_REQUIRED" };
  }
  return { ok: true, source, provenanceMode: "HISTORICAL_FIXTURE", caseRevisionId: input.caseRevisionId, evidenceHash: input.evidenceHash };
}
```

- [ ] **Step 4: Install a temporary fail-closed historical boundary until verified auth exists**

Export the policy and prove every mode/source/scope combination in `sourcePolicy.test.ts`. In `event.ts` and `explain.ts`, make omitted/`LIVE` source resolve only to Alpaca and reject all `fixture`, `REPLAY`, and `RESEARCH` requests with `503 BRAIN_AUTH_NOT_READY` before any fixture import/read. Do not invent optional `req.auth`; Task 4 replaces this temporary denial with verified replay scope plus the canonical-case port. Update route tests to prove no live or pre-auth request reaches bundled fixture data.

- [ ] **Step 5: Make the Desk live by default and label replay explicitly**

Before changing runtime defaults, enumerate every discovered fixture/mock/demo path in `runtime_source_classifications.json` with exactly one of `TEST_ONLY`, `REPLAY_ONLY`, or `UI_DONOR` plus rationale/owner. Implement `audit_runtime_sources.mjs` to walk production import graphs and route/client configuration, reject unclassified/stale entries, and fail if a `LIVE` route can reach any of them or if a replay asset is reachable without the case-revision/evidence-hash boundary. It must inspect source files only and never import or execute application modules.

Change the persisted terminal default to:

```ts
symbol: "AAPL",
source: "alpaca_live",
```

Expand `DeskMode` to `"LIVE" | "RESEARCH" | "REPLAY"`, set initial mode to `LIVE`, and make `LIVE` read-only market research rather than execution. `RESEARCH` and `REPLAY` use historical brain cases and render `HISTORICAL` in the header.

- [ ] **Step 6: Update OpenAPI, regenerate clients, and correct MCP replay paths**

Set the event/explain `source` default to `alpaca_live`; document the forthcoming live-fixture rejection and provenance fields. Change MCP replay calls from `/api/replay/*` to `/api/copilot/replay/*`, require the actual date/step parameters, and remove stale mock-field caveat warnings.

Run:

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/mcp-gateway test
pnpm --filter @workspace/desk test
pnpm --filter @workspace/api-server test
```

Expected: generated contracts compile; MCP paths match Express; live defaults never resolve to fixtures.

- [ ] **Step 7: Add and run the read-only Phase-0 connector verifier**

`verify_live_connectors.mjs` accepts an Alpaca SIP probe plus an optional explicit FMP endpoint-family task. It uses only Node's built-in `fetch`, always sets Alpaca `feed=sip`, rejects 401/403/429/5xx/schema errors, prints a redacted status/timestamp/schema summary, and never imports broker/order clients. It calls FMP only when the CLI task declares `profile`, `news`, or `quote`; tests inject fetch and prove there is no fallback.

Run:

```bash
node --test tools/research/test/runtime_source_audit.test.mjs tools/research/test/live_connector_probe.test.mjs
node tools/research/audit_runtime_sources.mjs
node tools/research/verify_live_connectors.mjs --alpaca-sip --fmp profile:AAPL
```

Expected: static reachability audit passes; real Alpaca SIP and the declared FMP profile probe pass. Missing credentials or a non-SIP/provider failure blocks the phase; do not substitute fixtures or mocks.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/lib/sourcePolicy.ts artifacts/api-server/src/lib/sourcePolicy.test.ts artifacts/api-server/src/routes/copilot/event.ts artifacts/api-server/src/routes/copilot/explain.ts artifacts/api-server/src/routes/copilot/event.test.ts artifacts/api-server/src/routes/copilot/explain.test.ts artifacts/desk/src artifacts/mcp-gateway/src lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated tools/research/audit_runtime_sources.mjs tools/research/runtime_source_classifications.json tools/research/verify_live_connectors.mjs tools/research/test/runtime_source_audit.test.mjs tools/research/test/live_connector_probe.test.mjs
git commit -m "feat: establish live and historical source policy"
```

### Task 2: Add Shared Research Control Contracts and Canonical Hashing

**Files:**
- Create: `lib/research-contracts/package.json`
- Create: `lib/research-contracts/tsconfig.json`
- Create: `lib/research-contracts/src/auth.ts`
- Create: `lib/research-contracts/src/run.ts`
- Create: `lib/research-contracts/src/version.ts`
- Create: `lib/research-contracts/src/trace.ts`
- Create: `lib/research-contracts/src/evidence.ts`
- Create: `lib/research-contracts/src/evaluation.ts`
- Create: `lib/research-contracts/src/packet.ts`
- Create: `lib/research-contracts/src/canonical.ts`
- Create: `lib/research-contracts/src/contracts.test.ts`
- Create: `lib/research-contracts/src/index.ts`
- Modify: `tsconfig.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces strict Zod schemas and inferred types for all control-plane boundaries.
- Produces `canonicalJson(value): string`, `sha256Canonical(value): string`, and `hmacCanonical(value, key): string`.

- [ ] **Step 1: Write failing canonicalization and contract tests**

```ts
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Canonical, PrincipalSchema, RunStateSchema } from "./index.js";

it("hashes equivalent objects identically", () => {
  expect(sha256Canonical({ b: 2, a: 1 })).toBe(sha256Canonical({ a: 1, b: 2 }));
  expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
});

it("orders non-ASCII object keys by UTF-16 code units independent of locale", () => {
  const value = { "€": 6, "\r": 0, "1": 1, "😀": 7, "A": 2, "é": 5, "a": 4, "_": 3 };
  expect(Object.keys(JSON.parse(canonicalJson(value)))).toEqual(["\r", "1", "A", "_", "a", "é", "€", "😀"]);
});

it("rejects unknown principal fields and illegal run states", () => {
  expect(() => PrincipalSchema.parse({ kind: "human", principalId: "p1", subject: "desk", scopes: [], extra: true })).toThrow();
  expect(RunStateSchema.safeParse("PUBLISHED").success).toBe(false);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/research-contracts test
```

Expected: FAIL because the package and exports do not exist.

- [ ] **Step 3: Create the package and exact core enums**

Set package name `@workspace/research-contracts`, ESM exports through `dist/index.js`, scripts `build`, `typecheck`, and `test`, runtime dependency `zod: catalog:`, and workspace-aligned dev dependencies `@types/node: catalog:`, `typescript: ~5.9.3`, and `vitest: ^4.1.9`. Make the TypeScript project composite so the root reference graph builds it before consumers.

Use strict schemas:

```ts
export const PrincipalKindSchema = z.enum(["human", "service", "agent"]);
export const RunModeSchema = z.enum(["LIVE", "LIVE_SMOKE", "REPLAY", "EVALUATION"]);
export const RunStateSchema = z.enum(["RECEIVED", "PREFLIGHT", "RUNNING", "GRADING", "GATE_CHECK", "TERMINAL"]);
export const ResearchOutcomeSchema = z.enum(["COMPLETE", "PARTIAL", "BLOCKED", "FAILED", "CANCELED", "TIMED_OUT", "BUDGET_EXCEEDED"]);
export const CaseStateSchema = z.enum(["CANDIDATE", "GRADED", "GOLDEN", "SUPERSEDED"]);
export const CasePartitionSchema = z.enum(["TRAINING", "VALIDATION", "HOLDOUT", "QUARANTINED"]);
```

All object schemas use `.strict()`. Define discriminated unions for principals, provider preflight results, trace kinds, evidence nodes/links, agent outputs, grader results, and typed decisions exactly as named in the design spec.

- [ ] **Step 4: Implement deterministic canonicalization**

```ts
import { createHash, createHmac } from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, normalize(child)]));
  }
  return value;
}

export const canonicalJson = (value: unknown) => JSON.stringify(normalize(value));
export const sha256Canonical = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export const hmacCanonical = (value: unknown, key: string) => createHmac("sha256", key).update(canonicalJson(value)).digest("hex");
```

Use RFC 8785/JCS UTF-16 code-unit property ordering—never locale collation. Reject non-JSON inputs (`undefined`, functions, symbols, non-finite numbers, `bigint`) before hashing so hashes are cross-runtime stable.

- [ ] **Step 5: Wire workspace references and run tests**

```bash
pnpm --filter @workspace/research-contracts test
pnpm run typecheck:libs
pnpm -w test
```

Expected: contract tests pass; the new package is part of the root TypeScript reference graph.

- [ ] **Step 6: Commit**

```bash
git add lib/research-contracts tsconfig.json pnpm-lock.yaml
git commit -m "feat: add research control contracts"
```

### Task 3: Create the Local Supabase Authentication Foundation

**Files:**
- Create via CLI: `supabase/config.toml`
- Create via CLI: `supabase/migrations/<timestamp>_create_isolated_schemas.sql`
- Create via CLI: `supabase/migrations/<timestamp>_create_credential_registry.sql`
- Create via CLI: `supabase/migrations/<timestamp>_create_auth_decision_functions.sql`
- Create via CLI: `supabase/migrations/<timestamp>_create_request_audit_and_idempotency.sql`
- Create: `supabase/tests/0001_schema_contract.sql`
- Create: `supabase/tests/0002_roles_grants_rls.sql`
- Create: `supabase/tests/0003_append_only.sql`
- Create: `supabase/tests/0004_auth_decision_chains.sql`
- Create: `supabase/tests/0005_sessions_request_audit.sql`
- Create: `supabase/tests/0006_idempotency.sql`
- Modify: `lib/db/package.json`
- Modify: `lib/db/drizzle.config.ts`

**Interfaces:**
- Produces private `governance` and `operations` schemas; typed principal/credential/session decision chains; `operations.api_request_audit`; durable `operations.idempotency_records`; locked SQL functions for bootstrap, verification, session creation/revocation, request audit, idempotency claim, and terminalization.
- Produces NOLOGIN capability roles `mie_api_read`, `mie_research_worker`, `mie_eval_runner`, `mie_reviewer`, `mie_migrator`, plus metadata-only `mie_catalog_inspector`; separately approved deployment provisioning creates LOGIN roles and grants them exactly one capability role.

- [ ] **Step 1: Initialize Supabase using the installed CLI**

Run:

```bash
supabase init
supabase migration new create_isolated_schemas
supabase migration new create_credential_registry
supabase migration new create_auth_decision_functions
supabase migration new create_request_audit_and_idempotency
```

Expected: CLI-generated timestamped files exist; do not invent timestamp filenames manually.

- [ ] **Step 2: Write failing pgTAP authorization tests**

The tests must assert schema/table/function presence, no `anon`/`authenticated`/`service_role` grants, denied direct `UPDATE`/`DELETE`, unique decision successors, and reviewer/worker separation. Include:

```sql
begin;
select plan(8);
select has_schema('governance');
select has_schema('operations');
select has_table('governance', 'principals');
select has_table('governance', 'api_credentials');
select has_table('governance', 'browser_sessions');
select has_table('operations', 'api_request_audit');
select function_returns('governance', 'verify_api_credential', array['text'], 'jsonb');
select throws_ok('update governance.api_credentials set credential_prefix = ''x''', 'P0001', 'append_only_violation');
select * from finish();
rollback;
```

- [ ] **Step 3: Run local Postgres and verify tests fail**

```bash
supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
supabase db reset --local
supabase test db supabase/tests/0001_schema_contract.sql --local
```

Expected: FAIL because the migrations do not yet define the objects.

- [ ] **Step 4: Implement the foundational schemas and immutable chains**

The migrations must create UUID-backed subjects and append-only decisions. Use this shape for each typed chain:

```sql
create table governance.credential_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references governance.api_credentials(credential_id),
  revision bigint not null check (revision > 0),
  verdict text not null check (verdict in ('ACTIVE','REVOKED')),
  supersedes_decision_id uuid unique references governance.credential_decisions(decision_id),
  actor_principal_id uuid not null references governance.principals(principal_id),
  request_id text not null,
  rationale text not null,
  decided_at timestamptz not null default now(),
  unique (credential_id, revision)
);
```

Create equivalent typed principal and browser-session decisions; immutable `principals`, `api_credentials`, and `browser_sessions`; a request-audit event table with `STARTED`/`COMPLETED`; durable idempotency claims bound to principal + operation + canonical input hash; and trigger functions that raise `append_only_violation` on direct update/delete.

- [ ] **Step 5: Add serialized credential/session functions and grants**

`verify_api_credential(raw_secret text)` returns only the active principal/credential/manifest binding after a constant-time digest comparison. Decision functions take `expected_revision` and lock the typed subject before appending. Idempotency claim/terminalization functions serialize the logical request, reject hash conflicts, and replay only completed responses. `mie_catalog_inspector` receives connection plus metadata/catalog visibility only—no application-table row reads or mutation. Do not expose plaintext secrets or functions to `anon`, `authenticated`, or `service_role`.

- [ ] **Step 6: Make Supabase SQL the only private-schema DDL authority**

Change `lib/db/package.json` so shared environments have no `push-force` script:

```json
{
  "scripts": {
    "push:public:local-only": "drizzle-kit push --config ./drizzle.config.ts"
  }
}
```

Keep the external-table filter until the live catalog audit explicitly adopts/renames existing `research_runs`. Add comments in `drizzle.config.ts` that private schemas are migration-owned.

- [ ] **Step 7: Run SQL gates**

```bash
supabase db reset --local
supabase test db supabase/tests --local
supabase db lint --local --fail-on error -s governance,operations
pnpm -w test
pnpm run typecheck
```

Expected: pgTAP and lint pass; full workspace stays green.

- [ ] **Step 8: Commit the local-only foundation**

```bash
git add supabase lib/db/package.json lib/db/drizzle.config.ts
git commit -m "feat: add local authentication database foundation"
```

### Task 4: Implement API Authentication, Route Policy, Sessions, and Idempotency

**Files:**
- Create: `lib/db/src/controlPlane/pools.ts`
- Create: `lib/db/src/controlPlane/context.ts`
- Create: `lib/db/src/controlPlane/authRepository.ts`
- Create: `lib/db/src/controlPlane/index.ts`
- Modify: `lib/db/src/index.ts`
- Create: `artifacts/api-server/src/auth/types.ts`
- Create: `artifacts/api-server/src/auth/credentialVerifier.ts`
- Create: `artifacts/api-server/src/auth/routePolicy.ts`
- Create: `artifacts/api-server/src/auth/resourcePolicy.ts`
- Create: `artifacts/api-server/src/auth/idempotency.ts`
- Create: `artifacts/api-server/src/auth/historicalCasePort.ts`
- Create: `artifacts/api-server/src/auth/sessions.ts`
- Create: `artifacts/api-server/src/auth/csrf.ts`
- Create: `artifacts/api-server/src/auth/middleware.ts`
- Create: `artifacts/api-server/src/auth/express.d.ts`
- Create: `artifacts/api-server/src/routes/auth.ts`
- Create: `artifacts/api-server/src/routes/governance.ts`
- Modify: `artifacts/api-server/src/app.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/routes/copilot/event.ts`
- Modify: `artifacts/api-server/src/routes/copilot/explain.ts`
- Modify: `artifacts/api-server/src/routes/copilot/replay.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Test: `artifacts/api-server/src/auth/credentialVerifier.test.ts`
- Test: `artifacts/api-server/src/auth/routePolicy.test.ts`
- Test: `artifacts/api-server/src/auth/sessions.test.ts`
- Test: `artifacts/api-server/src/auth/routeMatrix.test.ts`

**Interfaces:**
- Produces `authenticateRequest(req): Promise<PrincipalContext>` and `authorizeOperation(operationId, req, principal): Promise<void>`.
- Produces `routePolicyRegistry: Record<OperationId, RoutePolicy>` and `authorizeToolInvocation(agent, toolId, resource)`.
- Produces `withControlPlaneTransaction(capability, verifiedContext, work)`, which selects a named pool and sets request/principal/run/case context with transaction-local settings before any repository query.
- Produces injected `HistoricalCasePort.resolveReplayCase(caseRevisionId, evidenceHash, principal)`, with no repository-file fallback.
- Produces protected session/principal/credential routes from the approved spec.

- [ ] **Step 1: Write failing public-health/protected-route tests**

```ts
it("leaves only the two health operations public", async () => {
  await request(app).get("/api/healthz").expect(200);
  await request(app).get("/api/copilot/healthz").expect(200);
  await request(app).get("/api/reports").expect(401);
  await request(app).get("/api/copilot/history").expect(401);
});

it("returns 403 for a verified service without the operation scope", async () => {
  await request(app).get("/api/copilot/history")
    .set("Authorization", `Bearer ${serviceWithoutDeskRead}`)
    .expect(403);
});
```

- [ ] **Step 2: Run the route test and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/auth/routeMatrix.test.ts
```

Expected: FAIL because current routes are unauthenticated.

- [ ] **Step 3: Add named control-plane pools and injected repositories**

```ts
export type ControlPlanePools = {
  api: Pool;
  worker: Pool;
  evaluator: Pool;
  reviewer: Pool;
};

export function createControlPlanePools(env: NodeJS.ProcessEnv): ControlPlanePools {
  return {
    api: new Pool({ connectionString: requireEnv(env, "MIE_API_DATABASE_URL") }),
    worker: new Pool({ connectionString: requireEnv(env, "MIE_WORKER_DATABASE_URL") }),
    evaluator: new Pool({ connectionString: requireEnv(env, "MIE_EVAL_DATABASE_URL") }),
    reviewer: new Pool({ connectionString: requireEnv(env, "MIE_REVIEWER_DATABASE_URL") }),
  };
}
```

Tests inject repository fakes; production has no in-memory credential fallback.

Keep the existing `lib/db/src/index.ts` `DATABASE_URL` pool for legacy `public` product tables. Export the named control plane through a separate module; never replace the legacy pool or let a private-schema repository silently use it.

- [ ] **Step 4: Implement credential verification and request audit**

The middleware must write the request `STARTED` audit row before calling a protected handler, attach only database-verified principal context, and append `COMPLETED` on finish. If the start insert fails, return `503 AUDIT_UNAVAILABLE`.

```ts
export type PrincipalContext = {
  requestId: string;
  credentialId: string;
  principal: Principal;
  effectiveScopes: readonly Scope[];
};
```

Use the intersection of credential scopes, principal scopes, and agent manifest scopes; never trust identity headers.

- [ ] **Step 5: Implement one normative route registry**

Each entry names operation, method, Express path, auth mode, allowed kinds, scopes, idempotency, and resource predicate:

```ts
export const routePolicyRegistry = {
  healthCheck: publicPolicy("GET", "/healthz"),
  copilotHealthCheck: publicPolicy("GET", "/copilot/healthz"),
  listReports: protectedPolicy("GET", "/reports", ["human", "service"], ["desk:read"]),
  getCopilotEvent: protectedPolicy("GET", "/copilot/event", ["human", "service"], ["event:generate"], { idempotent: true }),
  explainCopilotEvent: protectedPolicy("GET", "/copilot/explain", ["human", "service"], ["event:generate", "committee:run"], { idempotent: true }),
} satisfies Record<string, RoutePolicy>;
```

Populate every existing and new OpenAPI operation. `routeMatrix.test.ts` must compare Express route registrations, OpenAPI operation IDs, and registry keys and fail on drift.

After verified auth is attached, route `event.ts` and `explain.ts` through `resolveSourcePolicy` with `canReplay = principal.effectiveScopes.includes("replay:read")`. Reject `fixture` in `LIVE`, default omitted live source to `alpaca_live`, and require the injected `HistoricalCasePort` to resolve the exact case revision/evidence hash from the canonical brain before any historical value is read. Until Task 6 supplies the production Supabase adapter, historical requests fail `503 BRAIN_UNAVAILABLE`; tests use an explicit fake. There is no optional-auth or bundled-fixture fallback.

- [ ] **Step 6: Implement human session and CSRF exactly**

`POST /api/auth/session` accepts a valid permanent human bearer, creates opaque session and 256-bit CSRF values, persists only digests, and sets browser-session `mie_session` (`HttpOnly; Secure; SameSite=Strict`, no required credential expiry) and `mie_csrf` (`Secure; SameSite=Strict`). Unsafe cookie requests require `X-CSRF-Token`, same origin, session binding, and constant-time digest match. Rotate CSRF at session creation and every permanent-key step-up. Configure CORS as an explicit same-origin allowlist with credentials enabled; bearer service/agent callers never receive browser cookies. `DELETE /api/auth/session` appends a session revocation.

- [ ] **Step 7: Implement idempotency**

Bind `Idempotency-Key` to principal ID + operation ID + canonical input hash. Return the stored response for an identical terminal request; return `409 IDEMPOTENCY_CONFLICT` for a different hash and `409 IDEMPOTENCY_IN_PROGRESS` for an active request.

- [ ] **Step 8: Add principal/credential governance and signed step-up decisions**

Implement bootstrap-compatible routes for issue/revoke. Consequential endpoints require both cookie session/CSRF and permanent-bearer step-up. Canonicalize the decision payload and store HMAC-SHA-256 attestation key ID/signature.

- [ ] **Step 9: Update OpenAPI and regenerate**

Declare bearer and cookie/CSRF schemes at the root; only health operations use `security: []`; document 401/403/409/503. Run:

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server test
pnpm run typecheck
```

Expected: route matrix, session, CSRF, idempotency, and auth tests pass.

- [ ] **Step 10: Commit**

```bash
git add lib/db/src artifacts/api-server/src/auth artifacts/api-server/src/routes artifacts/api-server/src/app.ts lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat: authenticate and authorize every API operation"
```

### Task 5: Wire Authenticated Desk, FinDesk, and MCP Clients

**Files:**
- Modify: `lib/api-client-react/src/custom-fetch.ts`
- Modify: `lib/api-client-react/src/index.ts`
- Create: `lib/api-client-react/src/custom-fetch.test.ts`
- Modify: `lib/api-client-react/package.json`
- Create: `artifacts/desk/src/auth/AuthProvider.tsx`
- Create: `artifacts/desk/src/auth/RequireAuth.tsx`
- Create: `artifacts/desk/src/auth/AuthScreen.tsx`
- Create: `artifacts/desk/src/auth/auth.test.tsx`
- Modify: `artifacts/desk/src/App.tsx`
- Modify: `artifacts/desk/src/pages/Terminal.tsx`
- Modify: `artifacts/desk/src/components/JournalPanel.tsx`
- Modify: `artifacts/desk/src/components/PositionPanel.tsx`
- Create: `artifacts/findesk/src/auth/SessionGate.tsx`
- Modify: `artifacts/findesk/src/App.tsx`
- Modify: `artifacts/mcp-gateway/src/server.ts`
- Modify: `artifacts/mcp-gateway/src/server.test.ts`
- Modify: `artifacts/mcp-gateway/README.md`
- Create: `scripts/src/bootstrap-auth.ts`
- Create: `scripts/src/bootstrap-auth.test.ts`
- Modify: `scripts/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces `setCsrfTokenGetter(getter)` and per-request `idempotencyKey` support in `customFetch`.
- Produces `AuthProvider`/`useAuth` with `openSession`, `logout`, `refreshWhoAmI`, and no persistent plaintext human key.
- Produces `createServer(options: GatewayOptions)` with an injected service credential and fetch.
- Produces `registerDeskTools(server, options): McpServer`, which registers the existing health and protected Desk tools on the injected server.

- [ ] **Step 1: Write failing custom-fetch tests**

```ts
it("adds cookies and CSRF only to unsafe same-origin requests", async () => {
  setCsrfTokenGetter(() => "csrf-value");
  await customFetch("/api/watchlist", { method: "POST", body: "{}" });
  expect(fetchMock).toHaveBeenCalledWith("/api/watchlist", expect.objectContaining({
    credentials: "include",
    headers: expect.any(Headers),
  }));
  const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
  expect(headers.get("X-CSRF-Token")).toBe("csrf-value");
});
```

- [ ] **Step 2: Verify the test fails**

```bash
pnpm --filter @workspace/api-client-react exec vitest run src/custom-fetch.test.ts
```

Expected: FAIL because CSRF/session configuration is absent.

- [ ] **Step 3: Extend the client without storing human credentials**

Add:

```ts
export type CsrfTokenGetter = () => string | null;
let csrfTokenGetter: CsrfTokenGetter | null = null;
export const setCsrfTokenGetter = (getter: CsrfTokenGetter | null) => { csrfTokenGetter = getter; };
```

For browser-relative requests set `credentials: "include"`. Add `X-CSRF-Token` only for `POST|PUT|PATCH|DELETE` when no explicit bearer authorization is supplied. Allow callers to supply a stable `Idempotency-Key` through `CustomFetchOptions`.

- [ ] **Step 4: Build the Desk session gate**

`AuthProvider` calls generated `POST /auth/session` with the permanent bearer held only in the call stack, then clears the input, reads `mie_csrf` from `document.cookie`, configures the getter, and calls `whoami`. `RequireAuth` prevents `Terminal` from mounting before authentication.

```ts
export type AuthState =
  | { status: "checking" }
  | { status: "anonymous"; error?: string }
  | { status: "authenticated"; principal: WhoAmIResponse };
```

On 401, clear QueryClient and return to `anonymous`; on 403, preserve session and render the denied operation. Never use localStorage/sessionStorage for the permanent credential.

- [ ] **Step 5: Gate FinDesk with the same session contract**

Add a small `SessionGate` under `artifacts/findesk/src/auth` and prevent analyze/report/watchlist hooks from mounting until `whoami` succeeds. Reuse `@workspace/api-client-react`; do not copy secrets or create a second auth protocol.

- [ ] **Step 6: Give human mutations stable idempotency keys**

Generate one UUID when the user begins a logical journal/watchlist/report action and reuse it for network retries; generate a new UUID only for a new click/submission. Automatic polling GETs that mutate/spend quota must reuse a key for one query execution and rotate on a deliberate refetch.

- [ ] **Step 7: Refactor the MCP gateway around an injected service credential**

```ts
export type GatewayOptions = {
  apiBase: string;
  credential: string | null;
  fetch: typeof globalThis.fetch;
};

export function createServer(options: GatewayOptions): McpServer {
  if (!options.apiBase) throw new Error("MIE API base is required");
  return registerDeskTools(new McpServer({ name: "market-insight-desk", version: "0.2.0" }), options);
}
```

Health tools work without a token. Every protected tool fails before fetch if the credential is missing. Send `Authorization: Bearer`, stable per-call idempotency where required, and exact `/api/copilot/replay/*` paths with required date/step.

- [ ] **Step 8: Implement one-time human bootstrap**

Expose `runBootstrapAuth(deps, { subject })`. It checks that no active human exists, atomically issues principal/credential/activation decisions, prints plaintext once, and refuses a second bootstrap. Do not accept secrets in argv.

- [ ] **Step 9: Run the client/auth phase gate**

Add `"test": "vitest run"` to `scripts/package.json` and add workspace-aligned devDependency `"vitest": "^4.1.9"` so bootstrap and later verifier tests run inside the workspace rather than through an undeclared global tool.

```bash
pnpm --filter @workspace/api-client-react test
pnpm --filter @workspace/desk test
pnpm --filter @workspace/findesk typecheck
pnpm --filter @workspace/mcp-gateway test
pnpm --filter @workspace/scripts test
pnpm --filter @workspace/api-spec run codegen
pnpm -w test
pnpm run typecheck
```

Expected: pre-auth protected hooks never mount; session/CSRF behavior passes; MCP token isolation and route contracts pass.

- [ ] **Step 10: Commit the authenticated clients on the local-green branch**

```bash
git add lib/api-client-react artifacts/desk/src artifacts/findesk/src artifacts/mcp-gateway scripts pnpm-lock.yaml
git commit -m "feat: authenticate desk and service clients"
```

- [ ] **Step 11: REMOTE SUPABASE APPROVAL GATE 1 — stop immediately before apply**

Generate the review artifact with `git show --stat --oneline HEAD` and `supabase db lint --local --fail-on error -s governance,operations`. Present the exact four foundational migrations, role/grant summary, pgTAP output, exact bootstrap/service-principal actions, and provisioning of one metadata-only catalog-inspector LOGIN used by Task 6. Ask for explicit approval for this exact apply/bootstrap/provision action in this turn. Do not call `supabase_apply_migration`, `supabase_execute_sql`, remote `psql`, or any mutating Supabase command before approval.

- [ ] **Step 12: After Gate 1 approval, apply and live-test auth only**

Use the separately approved Supabase operation to apply exactly the reviewed foundational migrations. Then run the bootstrap CLI once with the operator's explicit approval, reconstruct the credential/session/request-audit chain, and test both public health and protected 401/403/200 behavior. Present the MCP/API service-principal subject and exact scopes for a separate explicit human governance decision; if approved, issue its permanent credential through the audited function and test MCP bearer access. Do not treat any Supabase/provider key as that service identity, and do not create the research/evidence/evaluation tables yet.

### Task 6: Add the Complete Local Audit, Evidence, Evaluation, and Publication Schema

**Files:**
- Create via CLI: `supabase/migrations/<timestamp>_create_runs_versions_and_traces.sql`
- Create via CLI: `supabase/migrations/<timestamp>_create_evidence_graph.sql`
- Create via CLI: `supabase/migrations/<timestamp>_create_evaluation_suite.sql`
- Create via CLI: `supabase/migrations/<timestamp>_create_typed_release_decisions.sql`
- Create via CLI: `supabase/migrations/<timestamp>_create_publication_gate_functions.sql`
- Create via CLI: `supabase/migrations/<timestamp>_create_private_role_projections.sql`
- Create: `supabase/tests/0007_run_state_machine.sql`
- Create: `supabase/tests/0008_trace_and_evidence.sql`
- Create: `supabase/tests/0009_evaluation_partitions.sql`
- Create: `supabase/tests/0010_publication_gate.sql`
- Create: `supabase/inspect/remote_catalog.sql`
- Create: `supabase/inspect/control_plane_catalog.sql`
- Create: `supabase/inspect/research_runs-disposition.md`
- Create: `supabase/tests/fixtures/remote_public_baseline.sql`
- Create: `scripts/db/introspect-remote-readonly.sh`
- Create: `scripts/db/test-upgrade-from-sanitized-baseline.sh`
- Create: `lib/db/src/controlPlane/schema.ts`
- Create: `lib/db/src/controlPlane/runRepository.ts`
- Create: `lib/db/src/controlPlane/versionRepository.ts`
- Create: `lib/db/src/controlPlane/traceRepository.ts`
- Create: `lib/db/src/controlPlane/evidenceRepository.ts`
- Create: `lib/db/src/controlPlane/evaluationRepository.ts`
- Create: `lib/db/src/controlPlane/historicalCaseRepository.ts`
- Create: `lib/db/src/controlPlane/decisionRepository.ts`
- Modify: `lib/db/package.json`
- Create: `artifacts/api-server/src/controlPlane/auth.integration.test.ts`
- Create: `artifacts/api-server/src/controlPlane/runTransitions.integration.test.ts`
- Create: `artifacts/api-server/src/controlPlane/decisionRaces.integration.test.ts`
- Create: `artifacts/api-server/src/controlPlane/traceCrash.integration.test.ts`
- Create: `artifacts/api-server/src/controlPlane/evidenceGraph.integration.test.ts`
- Create: `artifacts/api-server/src/controlPlane/evaluationIsolation.integration.test.ts`
- Create: `artifacts/api-server/src/controlPlane/publicationGate.integration.test.ts`
- Create: `artifacts/api-server/vitest.integration.config.ts`
- Modify: `artifacts/api-server/vitest.config.ts`
- Modify: `artifacts/api-server/package.json`

**Interfaces:**
- Produces the remaining tables and locked SQL functions from design sections 9–12.
- Produces `RunRepository`, `TraceRepository`, `EvidenceRepository`, `EvaluationRepository`, and `DecisionRepository` ports.

- [ ] **Step 1: Capture the read-only live catalog before designing migrations**

Implement the catalog SQL/wrapper first. The wrapper requires `MIE_SUPABASE_INSPECT_URL`, rejects `postgres`/owner/migrator users, begins `TRANSACTION READ ONLY`, sets 10-second statement and 1-second lock timeouts, queries only `pg_catalog`, `information_schema`, policies, grants, triggers, indexes, roles/memberships, and migration history, then rolls back. It writes a sanitized ignored snapshot containing no URL, password, project ref, or row data.

Run:

```bash
scripts/db/introspect-remote-readonly.sh
```

Expected: a sanitized `.local/db-baseline/` snapshot exists. If a dedicated read-only credential is unavailable, stop; never substitute the supplied owner/service-role connection. Record whether `research_runs` exists, its owner/columns/constraints/indexes/grants, and the current migration history before writing phase-2 SQL.

- [ ] **Step 2: Record the authority disposition and create migration files through the CLI**

Write `research_runs-disposition.md` with one evidence-backed choice: adopt the existing table, migrate it under an explicit compatibility view, or deliberately rename the new private table. The plan must never create a conflicting second authority. Build `remote_public_baseline.sql` only from the sanitized structural snapshot; it contains no row data or secret literals.

```bash
supabase migration new create_runs_versions_and_traces
supabase migration new create_evidence_graph
supabase migration new create_evaluation_suite
supabase migration new create_typed_release_decisions
supabase migration new create_publication_gate_functions
supabase migration new create_private_role_projections
```

- [ ] **Step 3: Write failing run-transition tests**

```sql
begin;
select plan(5);
select lives_ok($$ select research.create_run('00000000-0000-0000-0000-000000000001', 'LIVE_SMOKE', 'idem-1') $$);
select lives_ok($$ select research.transition_run('00000000-0000-0000-0000-000000000001', 0, 'PREFLIGHT', null, null) $$);
select throws_ok($$ select research.transition_run('00000000-0000-0000-0000-000000000001', 0, 'RUNNING', null, null) $$, '40001', 'run_version_conflict');
select throws_ok($$ select research.transition_run('00000000-0000-0000-0000-000000000001', 1, 'GATE_CHECK', null, null) $$, 'P0001', 'illegal_run_transition');
select results_eq($$ select count(*) from operations.trace_events where kind = 'RUN_STATE_CHANGED' $$, array[1::bigint]);
select * from finish();
rollback;
```

- [ ] **Step 4: Write failing publication race/lineage tests**

Test append-only evidence, relation node-kind rules, acyclicity, active-suite minimum coverage, hidden holdout projections, unique decision successors, immutable human case-bundle grades, and a stale approve/revoke/publish race. The packet function must reject any mismatch among release fingerprint, policy, suite, rubric, trial matrix, packet hash, contract major, and graph-validator hash.

- [ ] **Step 5: Implement tables and transition/trace functions**

Create `research.research_runs`, `governance.run_version_snapshots`, and `operations.trace_events`. The transition function locks by run ID, checks `row_version`, enforces the exhaustive matrix, updates once, and inserts `RUN_STATE_CHANGED` in the same transaction.

Trace intents require a deterministic `attempt_id`; responses close exactly one intent. `operations.reconcile_orphan_call_intents()` marks unclosed attempts `UNKNOWN_EXTERNAL_OUTCOME`, and any such run is non-publishable.

- [ ] **Step 6: Implement evidence graph and evaluation tables**

Create immutable evidence nodes/links; `SUPERSEDES` links are the only supersession authority. Add a deterministic validator version/hash. Create case revisions, typed case decisions, immutable suite manifests, trial series/batches/results, `evaluation.human_case_grades`, release decisions, and exact packet publication decisions. A human case grade binds series ID + case revision ID + exact five-batch bundle hash + PASS/FAIL + rationale + actor/credential/request/attestation; it is appended only through a serialized function and cannot be overwritten. Implement `HistoricalCaseRepository` against the worker-safe canonical projection and wire it into `createApp`; a revision/hash mismatch or non-`TRAINING` replay authorization returns no historical values.

- [ ] **Step 7: Implement role projections and locked publication**

Worker views exclude expected labels and grader reasoning. Eval views expose assigned holdout material. Reviewer views expose the full review contract. Use security-invoker views and role grants; test by `SET ROLE` for every capability.

`governance.publish_packet(...)` locks the active release-decision subject, rechecks every hash, and atomically inserts the packet-publication decision plus report link. Concurrent revocation must win or force a serialization conflict; stale approval never publishes.

- [ ] **Step 8: Prove upgrade behavior from the sanitized live baseline**

`test-upgrade-from-sanitized-baseline.sh` creates an isolated scratch database inside local Supabase, applies `remote_public_baseline.sql`, applies every committed migration in order, runs `control_plane_catalog.sql`, and drops the scratch database. Assert the recorded `research_runs` disposition, owners, grants, constraints, indexes, and compatibility surface; clean-reset success alone is insufficient.

- [ ] **Step 9: Run local SQL and repository integration gates**

Exclude `**/*.integration.test.ts` from the ordinary API Vitest config. The integration config includes only that pattern, uses the local Supabase URLs/roles emitted by the approved local setup, and has no hard-coded synthetic database URL. Add package script `"test:integration:db": "vitest run --config vitest.integration.config.ts"`.

```bash
supabase db reset --local --no-seed
supabase test db supabase/tests --local
supabase db lint --local --fail-on error -s governance,research,operations,evidence,evaluation
scripts/db/test-upgrade-from-sanitized-baseline.sh supabase/tests/fixtures/remote_public_baseline.sql
pnpm --filter @workspace/api-server run test:integration:db
pnpm -w test
pnpm run typecheck
```

Expected: every pgTAP and repository integration test passes, including role isolation and concurrency.

- [ ] **Step 10: Commit local schema and repositories**

```bash
git add supabase lib/db/src/controlPlane lib/db/package.json artifacts/api-server/src/controlPlane artifacts/api-server/vitest.config.ts artifacts/api-server/vitest.integration.config.ts artifacts/api-server/package.json scripts/db
git commit -m "feat: add append-only research audit plane"
```

### Task 7: Implement Fail-Closed Run Lifecycle and Live Provider Preflights

**Files:**
- Create: `artifacts/api-server/src/research/run/lifecycle.ts`
- Create: `artifacts/api-server/src/research/run/lifecycle.test.ts`
- Create: `artifacts/api-server/src/research/preflight/types.ts`
- Create: `artifacts/api-server/src/research/preflight/alpacaSip.ts`
- Create: `artifacts/api-server/src/research/preflight/alpacaSip.test.ts`
- Create: `artifacts/api-server/src/research/preflight/fmp.ts`
- Create: `artifacts/api-server/src/research/preflight/fmp.test.ts`
- Create: `artifacts/api-server/src/research/preflight/modelProviders.ts`
- Create: `artifacts/api-server/src/research/run/coordinator.ts`
- Create: `artifacts/api-server/src/research/testing/factories.ts`
- Modify: `artifacts/api-server/src/lib/alpacaData.ts`
- Modify: `artifacts/api-server/src/lib/providers/fmp.ts`
- Create: `scripts/src/verify-live-connectors.ts`
- Create: `scripts/src/verify-live-phase.ts`
- Modify: `scripts/package.json`

**Interfaces:**
- Produces `probeAlpacaSip(deps): Promise<SipPreflightResult>` and `probeFmp(task, deps): Promise<FmpPreflightResult>`.
- Produces `RunCoordinator.start(input, principal): Promise<ResearchRunResult>`.

- [ ] **Step 1: Write the Alpaca classification tests**

Define `fakeSipDeps(status, body)` in `research/testing/factories.ts` as an injected fetch/calendar/clock fixture that records the requested URL and returns the supplied response. Import it in the test so the assertion also proves `feed=sip` was requested and no fallback fetch occurred.

```ts
it.each([
  [200, { latestQuote: { t: "2026-07-10T19:59:00Z" } }, "SIP_REALTIME"],
  [401, { message: "unauthorized" }, "AUTH_FAILED"],
  [403, { message: "subscription does not permit querying recent SIP data" }, "SIP_DELAYED_ONLY"],
  [429, {}, "RATE_LIMITED"],
  [500, {}, "PROVIDER_UNAVAILABLE"],
])("classifies SIP probe status %s", async (status, body, expected) => {
  expect((await probeAlpacaSip(fakeSipDeps(status, body))).status).toBe(expected);
});
```

- [ ] **Step 2: Verify focused tests fail**

```bash
pnpm --filter @workspace/api-server exec vitest run src/research/preflight
```

Expected: FAIL because preflight modules do not exist.

- [ ] **Step 3: Implement the mandatory SIP capability request**

Always request a small latest quote/snapshot with explicit `feed=sip`. Preserve response status/body classification after redaction. Require `SIP_REALTIME`; all other outcomes block. Use market calendar context so a closed market does not become a false provider failure. Do not consult `ALPACA_FEED` or fall back.

- [ ] **Step 4: Implement task-specific FMP preflight**

```ts
export type FmpRequirement = { endpointFamily: "profile" | "news" | "quote"; probeSymbol: string };
```

If the manifest declares none, return `NOT_REQUIRED`. Otherwise exercise the same stable endpoint family and distinguish 403, 429, 5xx, schema error, and timeout. Required failure blocks; do not replace FMP with another source.

- [ ] **Step 5: Implement exact run transitions and budgets**

The start coordinator order is: authorize → audit writable → create `RECEIVED` → `PREFLIGHT` → SIP → required FMP/model providers → `RUNNING`. On preflight failure it transitions directly to `TERMINAL`; on success it returns a run handle at `RUNNING` for the agent workflow. It may never skip directly from successful `RUNNING` to `TERMINAL`: Task 9 advances to `GRADING`, and Task 11 advances to `GATE_CHECK` then `TERMINAL`. All transitions call the repository's optimistic function; retries stay inside state and emit trace events. Task 8 inserts configured/observed version snapshots without changing this exhaustive order.

- [ ] **Step 6: Implement Phase 0 and Phase 3 verifier scripts**

`verify-live-connectors.ts` makes read-only SIP and declared FMP calls and writes a redacted hashed local artifact. `verify-live-phase.ts` creates `mode=LIVE_SMOKE`, persists preflight trace events, terminalizes, and verifies reconstruction. Neither script has any broker/order client.

- [ ] **Step 7: Run focused and full gates**

```bash
pnpm --filter @workspace/api-server exec vitest run src/research/preflight src/research/run
pnpm --filter @workspace/scripts test
pnpm -w test
pnpm run typecheck
```

Then run the live SIP probe. Run FMP only for the declared FMP smoke task. Expected: live SIP is `SIP_REALTIME`; no fallback calls occur.

- [ ] **Step 8: Commit the fail-closed lifecycle on the local-green branch**

```bash
git add artifacts/api-server/src/research/run artifacts/api-server/src/research/preflight artifacts/api-server/src/research/testing artifacts/api-server/src/lib scripts/src scripts/package.json
git commit -m "feat: fail closed on live provider preflights"
```

- [ ] **Step 9: REMOTE SUPABASE APPROVAL GATE 2 — stop immediately before apply**

Present the exact phase-2 migrations, sanitized read-only catalog diff, clean-reset and upgrade-path results, adopted/renamed disposition for any existing `research_runs`, roles/grants, publication function, and one bounded persisted SIP/FMP `LIVE_SMOKE` preflight. Ask for explicit approval for this exact apply/provision/smoke action in this turn. Do not apply, provision LOGIN-role secrets, or create the smoke run before approval.

- [ ] **Step 10: After Gate 2 approval, apply and reconstruct Phase 2 only**

Apply exactly the approved migrations and separately provision least-privilege LOGIN roles. Run catalog/grant/trigger/append-only reconstruction and the approved `LIVE_SMOKE` preflight run from the clean commit. Call remote Supabase advisors after apply and stop on any security/performance error. Do not proceed on advisor failure.

### Task 8: Persist Manifests, Versions, Model Calls, Traces, and Cost

**Files:**
- Create: `agent-manifests/market-research-lead.json`
- Create: `agent-manifests/catalyst-verifier.json`
- Create: `agent-manifests/source-guardian.json`
- Create: `agent-manifests/model-grader-openai.json`
- Create: `agent-manifests/model-grader-anthropic.json`
- Create: `artifacts/api-server/src/research/agents/prompts/market-research-lead.md`
- Create: `artifacts/api-server/src/research/agents/prompts/catalyst-verifier.md`
- Create: `artifacts/api-server/src/research/agents/prompts/source-guardian.md`
- Create: `artifacts/api-server/src/research/agents/prompts/model-grader-openai.md`
- Create: `artifacts/api-server/src/research/agents/prompts/model-grader-anthropic.md`
- Create: `artifacts/api-server/src/research/agents/skills/entity-resolution.md`
- Create: `artifacts/api-server/src/research/agents/skills/catalyst-timing.md`
- Create: `artifacts/api-server/src/research/agents/skills/source-entailment.md`
- Create: `artifacts/api-server/src/research/agents/skills/evaluation-rubric.md`
- Create: `artifacts/api-server/src/research/tools/schemas.ts`
- Create: `artifacts/api-server/src/research/tools/schemas.test.ts`
- Create: `artifacts/api-server/src/research/versioning/manifestSchema.ts`
- Create: `artifacts/api-server/src/research/versioning/loadManifest.ts`
- Create: `artifacts/api-server/src/research/versioning/fingerprint.ts`
- Create: `artifacts/api-server/src/research/versioning/versioning.test.ts`
- Create: `artifacts/api-server/src/research/providers/types.ts`
- Create: `artifacts/api-server/src/research/providers/openai.ts`
- Create: `artifacts/api-server/src/research/providers/anthropic.ts`
- Create: `artifacts/api-server/src/research/providers/providers.test.ts`
- Create: `artifacts/api-server/src/research/tracing/redact.ts`
- Create: `artifacts/api-server/src/research/tracing/priceCatalog.ts`
- Create: `artifacts/api-server/src/research/tracing/callExecutor.ts`
- Create: `artifacts/api-server/src/research/tracing/callExecutor.test.ts`
- Modify: `lib/integrations-openai-ai-server/src/client.ts`
- Modify: `lib/integrations-anthropic-ai/src/client.ts`
- Modify: `artifacts/api-server/src/lib/committeeProvider.ts`

**Interfaces:**
- Produces `loadAgentManifest(id)`, `configuredFingerprint(input)`, and `observedSnapshot(input)`.
- Produces provider-neutral `ResearchModelProvider.callStructured<T>(request): Promise<ModelCallResult<T>>`.
- Produces `executeTracedCall(intent, fn)` with intent-before-dispatch and response/error closure.

- [ ] **Step 1: Write failing version reset tests**

Add `configuredSnapshotFactory()` and `withVersionChange(snapshot, field)` to `research/testing/factories.ts`; the latter must change exactly one canonical version input and leave all others byte-identical.

```ts
it.each(["model", "prompt", "skill", "tool", "manifest", "policy", "code", "config"])(
  "changes the release fingerprint when %s changes",
  (field) => {
    const base = configuredSnapshotFactory();
    expect(fingerprint(withVersionChange(base, field))).not.toBe(fingerprint(base));
  },
);
```

- [ ] **Step 2: Write failing trace crash tests**

Test crash before dispatch (intent exists/no provider call), crash after provider acceptance (orphan intent), crash before response commit (orphan), successful response (closed intent), retry events, redaction, and deterministic micro-USD from a versioned catalog.

- [ ] **Step 3: Verify tests fail**

```bash
pnpm --filter @workspace/api-server exec vitest run src/research/versioning src/research/tracing src/research/providers
```

Expected: FAIL because manifests/providers/executor are absent.

- [ ] **Step 4: Add strict immutable manifests**

Write all five prompt resources, four narrow skill resources, and strict schemas for every allowed tool ID first. Each JSON manifest then includes ID/semver, owning service, provider/task model environment variable, exact prompt/skill hashes, tool schema hashes plus implementation versions, strict output schema hash, required providers, maximum calls/retries/time/tokens/micro-USD, source policy, failure mode, and eval suite version. Manifest loading fails if any resource/schema is absent or its bytes do not match the declared hash. Reject wildcard or broker/order/shell/DDL tools at startup. Task 9 implements handlers against these already-frozen schemas; the configured git commit records the implementation bytes.

- [ ] **Step 5: Use official standard provider configuration**

Refactor integrations to lazy factories that prefer `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` and optional official base URLs, while preserving explicitly configured integration base URLs for the deterministic committee. Require `RESEARCH_OPENAI_MODEL` and `RESEARCH_ANTHROPIC_MODEL`; do not invent defaults or silently switch providers.

- [ ] **Step 6: Implement strict provider-neutral calls**

OpenAI uses `client.responses.create` with strict JSON schema/tools and stores response ID, `x-request-id`, requested/returned model, call IDs, usage/cache/reasoning fields, and status. Anthropic uses `client.messages.create`/parse with strict tool/output schemas and stores message ID, `_request_id`, model, stop reason, tool-use IDs/results, cache usage, and structured errors. Set SDK retries to zero so coordinator retries are visible.

- [ ] **Step 7: Implement configured/observed snapshots and price catalog**

Create `CONFIGURED` before calls from canonical static versions. Append `OBSERVED` at terminalization with exact returned model IDs and provider request IDs. An unexpected returned model blocks publication. Compute cost in integer micro-USD from the captured catalog version; never rewrite historical cost.

- [ ] **Step 8: Run unit gates**

```bash
pnpm --filter @workspace/api-server exec vitest run src/research/versioning src/research/tracing src/research/providers
pnpm -w test
pnpm run typecheck
```

Expected: manifests/resources/tool schemas, version resets, crash recovery, provider adapters, redaction, and cost tests pass without live calls.

- [ ] **Step 9: Commit the exact version resources and adapters**

```bash
git add agent-manifests artifacts/api-server/src/research/agents/prompts artifacts/api-server/src/research/agents/skills artifacts/api-server/src/research/tools/schemas.ts artifacts/api-server/src/research/tools/schemas.test.ts artifacts/api-server/src/research/versioning artifacts/api-server/src/research/providers artifacts/api-server/src/research/tracing artifacts/api-server/src/research/testing lib/integrations-openai-ai-server lib/integrations-anthropic-ai artifacts/api-server/src/lib/committeeProvider.ts
git commit -m "feat: persist agent versions and model traces"
```

- [ ] **Step 10: HUMAN GOVERNANCE APPROVAL GATE — stop immediately before agent issuance**

On the clean committed fingerprint and after Gate 2 has been applied, present the five exact manifest IDs/hashes, owning service, scopes, no-expiry credential policy, and two bounded OpenAI/Anthropic `LIVE_SMOKE` calls with their maximum budgets and run/trace tables. Ask the operator to approve/reject each exact agent-principal/credential action and the two smoke writes with permanent-key step-up. Do not register, issue, or create either smoke run before those explicit decisions.

- [ ] **Step 11: Issue approved agents and run live model smoke on the clean fingerprint**

For approved actions, store only credential digests and show plaintext once to the authorized runtime secret channel. Provider API keys remain provider infrastructure and never authenticate an agent. Require one real OpenAI and one real Anthropic `LIVE_SMOKE` call under the correct manifest-bound agent identities. If either credential/model is unavailable, stop and ask for it; do not substitute a mock or another provider. Verify complete trace reconstruction against the committed fingerprint.

### Task 9: Build Dedicated Evidence Tools and the Three Worker Agents

**Files:**
- Create: `artifacts/api-server/src/research/tools/types.ts`
- Create: `artifacts/api-server/src/research/tools/authorizeToolInvocation.ts`
- Create: `artifacts/api-server/src/research/tools/alpacaMarketData.ts`
- Create: `artifacts/api-server/src/research/tools/fmpEnrichment.ts`
- Create: `artifacts/api-server/src/research/tools/entityResolver.ts`
- Create: `artifacts/api-server/src/research/tools/primarySourceFetch.ts`
- Create: `artifacts/api-server/src/research/tools/tools.test.ts`
- Create: `artifacts/api-server/src/research/evidence/graph.ts`
- Create: `artifacts/api-server/src/research/evidence/graph.test.ts`
- Create: `artifacts/api-server/src/research/learning/trainingRetriever.ts`
- Create: `artifacts/api-server/src/research/learning/trainingRetriever.test.ts`
- Create: `artifacts/api-server/src/research/agents/marketResearchLead.ts`
- Create: `artifacts/api-server/src/research/agents/catalystVerifier.ts`
- Create: `artifacts/api-server/src/research/agents/sourceGuardian.ts`
- Create: `artifacts/api-server/src/research/agents/agents.test.ts`
- Modify: `artifacts/api-server/src/research/run/coordinator.ts`
- Modify: `artifacts/api-server/src/lib/providers/fmp.ts`

**Interfaces:**
- Produces dedicated tool IDs `market.get_sip_snapshot`, `fmp.get_profile`, `fmp.get_news`, `entity.resolve_security`, and `source.fetch_primary`.
- Produces `retrieveTrainingExamples(query, principal)` through the worker-safe Supabase projection; it cannot address validation, holdout, quarantined, or candidate cases.
- Produces `runMarketResearchLead`, `runCatalystVerifier`, `runSourceGuardian`, and an immutable `CandidatePacketDraft`.

- [ ] **Step 1: Write failing permission tests**

```ts
it("rejects undeclared and prohibited tools", async () => {
  await expect(authorizeToolInvocation(lead, "broker.submit_order", {})).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
  await expect(authorizeToolInvocation(catalyst, "source.fetch_primary", { url: "https://example.invalid" })).rejects.toMatchObject({ code: "SOURCE_NOT_ALLOWED" });
});

it("requires the permanent agent credential to match manifest and owning service", async () => {
  await expect(createAgentInvocation({ rawCredential: guardianCredential, manifestId: "catalyst-verifier", service: researchService })).rejects.toThrow("agent_credential_manifest_mismatch");
});
```

- [ ] **Step 2: Write failing evidence and agent adversarial tests**

Cover wrong ticker/CIK/legal entity/ADR parent/security class, stale-as-new timestamps, publication-versus-event time, correction/retraction, syndicated duplicates, unsupported material claims, non-entailing citations, no-catalyst abstention, and required `UNKNOWN`.

- [ ] **Step 3: Verify tests fail**

```bash
pnpm --filter @workspace/api-server exec vitest run src/research/tools src/research/evidence src/research/learning src/research/agents
```

Expected: FAIL because tools and agents do not exist.

- [ ] **Step 4: Implement dedicated read-only tools**

All tool handlers accept a verified `AgentPrincipal`, validate strict Zod input, call `authorizeToolInvocation`, open the least-privilege worker transaction/provider adapter, and execute through `executeTracedCall`. No handler accepts arbitrary method/body or arbitrary domain.

`source.fetch_primary` permits SEC/FDA/government domains plus an issuer IR domain previously linked to the resolved legal entity and frozen in source policy. FMP news/profile may discover candidates/issuer URLs but cannot independently support a material catalyst.

- [ ] **Step 5: Implement exact entity and temporal records**

```ts
export type CatalystRecord = {
  symbol: string;
  legalEntityName: string;
  cik: string | null;
  securityClass: string;
  eventType: string;
  publishedAt: string;
  eventAt: string | null;
  firstKnowableAt: string;
  freshness: "NEW" | "STALE" | "CORRECTED" | "RETRACTED" | "UNKNOWN";
  sourceEvidenceIds: string[];
};
```

Never merge conflicting times or entities; create a `CONFLICTED` audit and block the material claim.

- [ ] **Step 6: Implement controlled training retrieval and Market Research Lead**

`retrieveTrainingExamples` queries only the worker-safe `TRAINING` projection using bounded instrument class, catalyst polarity, and failure tags. It returns frozen evidence/policy feedback but never expected evaluation labels, grader prompts/reasoning, or arbitrary case IDs. Test guessed IDs from every other partition and require no rows or `403` without revealing existence.

The Lead receives a strict `CandidateSeed`, the retrieved `TRAINING` examples, and typed tool descriptions. It emits a bounded plan and draft claims through OpenAI structured output. It cannot publish, grade, or mutate market state.

- [ ] **Step 7: Implement Catalyst Verifier**

Anthropic verifies event existence, exact legal entity/security, published/event/first-knowable times, stale/new/corrected state, and primary-source evidence. Missing proof returns `UNKNOWN`; it never emits trade language.

- [ ] **Step 8: Implement Source Guardian with opposite-provider routing**

For every material claim, route the audit to the provider opposite the author. Require exact passage entailment and timing. The Guardian may return `SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONFLICTED`, `UNSUPPORTED`, or `UNKNOWN`; it cannot rewrite the claim to pass.

- [ ] **Step 9: Freeze the packet evidence graph**

Persist source versions, passages, claims, audits, and typed links; call the deterministic graph validator; create a packet draft containing graph hash, dependency manifest, expiry, configured/observed snapshots, and all unknown/conflict fields. Atomically transition the successful run from `RUNNING` to `GRADING`; on agent/graph failure terminalize with the typed failure reason. Do not call publication yet.

- [ ] **Step 10: Run focused and full local gates**

```bash
pnpm --filter @workspace/api-server exec vitest run src/research/tools src/research/evidence src/research/learning src/research/agents
pnpm -w test
pnpm run typecheck
```

Expected: permission, adversarial entity/timing/source, training isolation, agent schema, and evidence graph tests pass without a live remote write.

- [ ] **Step 11: Commit the three worker agents on the local-green branch**

```bash
git add artifacts/api-server/src/research artifacts/api-server/src/lib/providers/fmp.ts
git commit -m "feat: add source-grounded research agents"
```

- [ ] **Step 12: REMOTE SUPABASE LIVE-SHADOW APPROVAL GATE — stop immediately before run creation**

Present the clean commit/fingerprint, exact candidate symbol/task, declared FMP family, three agent manifests, provider calls, maximum token/call/cost/time budgets, and remote run/trace/evidence tables that will be appended. Ask for explicit approval for this one shadow run in this turn. Do not create the run before approval.

- [ ] **Step 13: Run the approved live shadow candidate**

Run exactly one candidate through SIP + declared FMP + OpenAI Lead + Anthropic Catalyst + opposite-provider Guardian. Verify complete traces/evidence, reconstruct every claim-to-passage edge, and confirm the packet remains shadow/locked with no strategy or publication write.

### Task 10: Build the Supabase Learning Brain, Graders, and Five-Trial Runner

**Files:**
- Create: `artifacts/api-server/src/research/evaluation/suitePolicy.ts`
- Create: `artifacts/api-server/src/research/evaluation/suitePolicy.test.ts`
- Create: `artifacts/api-server/src/research/evaluation/deterministicGrader.ts`
- Create: `artifacts/api-server/src/research/evaluation/deterministicGrader.test.ts`
- Create: `artifacts/api-server/src/research/evaluation/opposingModelGrader.ts`
- Create: `artifacts/api-server/src/research/evaluation/opposingModelGrader.test.ts`
- Create: `artifacts/api-server/src/research/evaluation/trialRunner.ts`
- Create: `artifacts/api-server/src/research/evaluation/trialRunner.test.ts`
- Create: `artifacts/api-server/src/research/evaluation/releasePolicy.ts`
- Create: `artifacts/api-server/src/research/evaluation/releasePolicy.test.ts`
- Create: `scripts/src/import-learning-cases.ts`
- Create: `scripts/src/build-golden-suite.ts`
- Create: `scripts/src/verify-suite-coverage.ts`
- Create: `supabase/seed/learning_case_import.sql`
- Modify: `scripts/package.json`

**Interfaces:**
- Produces `validateSuiteManifest`, `gradeDeterministically`, `gradeWithOpposingProvider`, `runTrialSeries`, and `evaluateRelease`.
- Produces case ingestion as `CANDIDATE` only; human decisions control `GOLDEN` and partition.

- [ ] **Step 1: Write failing minimum-suite tests**

Add `suiteManifestFactory(overrides)`, `manifestWithNineteenCases()`, and `manifestMissingCorrectionCoverage()` to `research/testing/factories.ts`. Build all three from the same typed 20-case baseline so the tests differ only in the stated omission.

```ts
it("requires positive and negative coverage for all ten instrument classes", () => {
  const result = validateSuiteManifest(manifestWithNineteenCases());
  expect(result).toEqual(expect.objectContaining({ ok: false, code: "SUITE_COVERAGE_INCOMPLETE" }));
});

it("requires each critical failure in three cases and two classes", () => {
  expect(validateSuiteManifest(manifestMissingCorrectionCoverage()).ok).toBe(false);
});
```

- [ ] **Step 2: Write failing five-consecutive-trial tests**

Test that ordinals 1–5 all pass every case; one failure invalidates the entire series; a new series starts at ordinal 1; cached provider responses cannot count twice; any version/suite/rubric/policy change relocks.

- [ ] **Step 3: Write failing grader separation tests**

OpenAI-authored outputs may only use Anthropic grader manifest and vice versa. Worker principals cannot read hidden expected labels/grader reasoning. Human grades and publication decisions are distinct rows.

- [ ] **Step 4: Verify tests fail**

```bash
pnpm --filter @workspace/api-server exec vitest run src/research/evaluation
```

Expected: FAIL because the evaluation modules do not exist.

- [ ] **Step 5: Implement the deterministic graders and zero-tolerance policy**

Code graders validate schema, manifest, auth, trace closure, graph reconstruction, entity/security identity, times, freshness, corrections, exact passage support, provider outages, and abstention. Any false catalyst, wrong entity, stale-as-new event, unsupported material claim, missed correction/retraction, or non-supporting citation is a critical failure.

- [ ] **Step 6: Implement opposing-provider graders**

Each grader is a manifest-bound agent principal with `evaluation:grade` and assigned-case `evaluation:holdout-read`. Persist its prompt/skill/model/tool versions and complete traces. It can append only its grade.

- [ ] **Step 7: Implement the metric exactly**

```ts
const agreement = matchingApplicableNonCriticalVerdicts / allApplicableNonCriticalVerdicts;
const passesAgreement = agreement >= 0.95;
```

Exclude `NOT_APPLICABLE` only when the golden label agrees; count `UNKNOWN` as a verdict. Require five full-suite batches, human PASS for every case bundle, budgets, trace/lineage 100%, and all zero-tolerance counts zero.

- [ ] **Step 8: Implement controlled case acquisition**

The import script accepts a frozen source/evidence bundle, validates hashes/entity/times/licensing metadata, and inserts only `CANDIDATE`. It never selects a partition or expected score automatically. The suite builder accepts only human-promoted `GOLDEN` revisions.

Use live connectors and primary sources to prepare at least 20 candidate bundles covering large-, mid-, small-, micro/low-float, biotech/FDA, recent IPO, SPAC/de-SPAC, ADR/foreign issuer, ETF/macro proxy, and general no-catalyst control, with a positive and negative in every class. Do not invent case labels from model output.

- [ ] **Step 9: Run the complete local evaluation gate**

```bash
pnpm --filter @workspace/api-server exec vitest run src/research/evaluation
pnpm --filter @workspace/scripts test
supabase test db supabase/tests/0009_evaluation_partitions.sql supabase/tests/0010_publication_gate.sql --local
pnpm -w test
pnpm run typecheck
```

Expected: all deterministic/adversarial tests pass; no worker can read holdout labels; self-grading is impossible.

- [ ] **Step 10: Commit the local evaluation implementation**

```bash
git add artifacts/api-server/src/research/evaluation scripts/src scripts/package.json supabase/seed
git commit -m "feat: add controlled learning and release evaluations"
```

- [ ] **Step 11: REMOTE SUPABASE DATA APPROVAL GATE 3 — stop immediately before insertion**

Present the exact candidate case IDs, symbols/classes, frozen source URLs/hashes, proposed labels, critical-failure coverage, and proposed partitions plus the exact import command. Ask for explicit approval for this insertion action in this turn. Do not insert, promote, partition, or activate any canonical remote case before approval.

- [ ] **Step 12: After Gate 3 approval, insert candidates only**

Run the approved import once; it may append only `CANDIDATE` revisions. Reconstruct their source/evidence hashes. Do not grade, promote, partition, or activate them before the protected Desk panel exists in Task 12. Those later mutations require their own explicit human actions and attestations.

### Task 11: Expose Protected Research, Evaluation, Governance, and Publication APIs

**Files:**
- Create: `artifacts/api-server/src/routes/research.ts`
- Create: `artifacts/api-server/src/routes/research.test.ts`
- Create: `artifacts/api-server/src/routes/evaluation.ts`
- Create: `artifacts/api-server/src/routes/evaluation.test.ts`
- Complete: `artifacts/api-server/src/routes/governance.ts`
- Create: `artifacts/api-server/src/routes/governance.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/auth/routePolicy.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Modify generated: `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`
- Create: `artifacts/api-server/src/research/run/researchWorkflowCoordinator.ts`
- Create: `artifacts/api-server/src/research/run/researchWorkflowCoordinator.test.ts`
- Create: `artifacts/api-server/src/research/run/publicationCoordinator.ts`
- Create: `artifacts/api-server/src/research/run/publicationCoordinator.test.ts`
- Test: `artifacts/api-server/src/controlPlane/publicationGate.integration.test.ts`

**Interfaces:**
- Implements the normative routes listed in design section 14.
- Produces `POST /research/runs`, run trace/evidence reads, trial start/matrix reads, human case-bundle grades, review queue, case decisions, release decisions, and principal/credential decisions.
- Produces `ResearchWorkflowCoordinator.execute(input, principal)` and `PublicationCoordinator.finalize(runId, packetDraft)`, the only application path from `GRADING` through `GATE_CHECK` to terminal shadow/publication status.

- [ ] **Step 1: Write failing route authorization/resource tests**

```ts
it("does not treat a valid run id as authorization", async () => {
  await request(app).get(`/api/research/runs/${holdoutRunId}/traces`)
    .set("Authorization", `Bearer ${workerCredential}`)
    .expect(403);
});

it("requires human step-up for publication approval", async () => {
  await request(app).post(`/api/governance/fingerprints/${fingerprint}/approve`)
    .set("Cookie", humanSessionCookie)
    .set("X-CSRF-Token", csrf)
    .send(validApproval)
    .expect(401);
});
```

- [ ] **Step 2: Write failing publication integration tests**

Test locked publish rejection, machine-eligible-without-human rejection, exact approved hash success, stale suite/policy/model/packet mismatch rejection, and concurrent revoke/publish serialization.

- [ ] **Step 3: Verify tests fail**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/research.test.ts src/routes/evaluation.test.ts src/routes/governance.test.ts src/research/run/researchWorkflowCoordinator.test.ts src/research/run/publicationCoordinator.test.ts
pnpm --filter @workspace/api-server run test:integration:db
```

Expected: FAIL because routes are missing/incomplete.

- [ ] **Step 4: Implement research run and authorized detail endpoints**

`POST /research/runs` requires idempotency and starts publication-locked. It invokes `ResearchWorkflowCoordinator`: Task 7 preflight to `RUNNING`, Task 9 agents/graph to `GRADING`, deterministic trace/schema/identity/freshness/lineage grading, then `GATE_CHECK`. Detail routes apply principal kind, run mode, partition, ownership, and field projection below the handler. Page full trace/evidence; summaries never include secrets or hidden labels.

- [ ] **Step 5: Implement evaluation endpoints**

Only human/eval service may start a trial series. Matrix reads require `evaluation:read` and authorized evaluation resource. Return critical failures before aggregates and include exact fingerprint/policy/suite/rubric/matrix hashes.

Add `POST /api/evaluation/trial-series/:seriesId/cases/:caseRevisionId/human-grade`. It requires human kind + `evaluation:grade` + reviewer resource access + session/CSRF + permanent-bearer step-up + idempotency. The body contains exact five-batch bundle hash, `PASS|FAIL`, and rationale; the route calls the serialized `EvaluationRepository.appendHumanCaseGrade` and returns immutable grade ID, actor/credential/request IDs, revision, and attestation. Tests reject wrong series/case/hash, non-human graders, duplicate-conflict keys, and overwrite attempts.

- [ ] **Step 6: Implement typed governance decisions**

Case promote/quarantine/supersede, release approve/reject/relock/revoke, and principal/credential issue/revoke require human kind + scope + session/CSRF + permanent-bearer step-up + idempotency. Return immutable decision ID/revision/attestation.

- [ ] **Step 7: Enforce publication only through the locked DB function**

No route performs `INSERT` into packet/report tables directly. At `GATE_CHECK`, `PublicationCoordinator` loads the active release decision and calls `evaluateRelease` against the run's exact configured/observed fingerprint, policy, suite, rubric, and matrix hashes. If no exact active approval exists, it persists the packet as shadow-only and transitions `GATE_CHECK -> TERMINAL` with research outcome `COMPLETE` plus publication status `HUMAN_APPROVAL_REQUIRED`, `RELEASE_RELOCKED`, or `RELEASE_REVOKED`. If approval matches, `DecisionRepository.publishAndTerminalize` opens one database transaction, calls locked `governance.publish_packet`, then calls `research.transition_run(..., 'TERMINAL', 'COMPLETE', null)` before commit. Retries use the same idempotency/packet hash and cannot double-publish. Existing deterministic endpoints remain available behind auth.

- [ ] **Step 8: Update OpenAPI/codegen and route coverage**

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server run test:integration:db
pnpm --filter @workspace/api-client-react test
pnpm run typecheck
```

Expected: Express/OpenAPI/policy registries have one-to-one operation coverage; all IDOR and publication tests pass.

- [ ] **Step 9: Commit**

```bash
git add artifacts/api-server/src/routes artifacts/api-server/src/auth artifacts/api-server/src/research/run lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat: expose protected research governance APIs"
```

### Task 12: Build and Browser-Verify the Protected Desk Review Panel

**Files:**
- Create: `artifacts/desk/src/components/AgentReleaseReviewPanel.tsx`
- Create: `artifacts/desk/src/components/AgentVersionCard.tsx`
- Create: `artifacts/desk/src/components/TrialMatrix.tsx`
- Create: `artifacts/desk/src/components/EvidenceLineage.tsx`
- Create: `artifacts/desk/src/components/HumanDecisionDialog.tsx`
- Create: `artifacts/desk/src/hooks/use-agent-release-review.ts`
- Create: `artifacts/desk/src/lib/agent-release-view-model.ts`
- Create: `artifacts/desk/src/lib/agent-release-view-model.test.ts`
- Modify: `artifacts/desk/src/pages/Terminal.tsx`
- Create: `artifacts/desk/e2e/agent-release-review.spec.ts`
- Create: `artifacts/desk/e2e/helpers.ts`
- Create: `artifacts/desk/playwright.config.ts`
- Modify: `artifacts/desk/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces one compact panel for the five new worker/grader principals only.
- Produces explicit case-grade and publication-decision dialogs with rationale and permanent-key step-up.

- [ ] **Step 1: Write failing view-model tests**

Define typed `matrixFactory()` and `matrixWithCriticalFailure()` builders in the test file. The critical fixture must differ only by one explicit critical result and must retain all exact release hashes.

```ts
it("shows critical failures before aggregate metrics", () => {
  const vm = toReleaseReviewViewModel(matrixWithCriticalFailure());
  expect(vm.sections[0].kind).toBe("critical-failures");
  expect(vm.canApprovePublication).toBe(false);
});

it("never lists deterministic committee lenses as agents", () => {
  expect(toReleaseReviewViewModel(matrix).agents.map((a) => a.id)).toEqual([
    "market-research-lead",
    "catalyst-verifier",
    "source-guardian",
    "model-grader-openai",
    "model-grader-anthropic",
  ]);
});
```

- [ ] **Step 2: Verify tests fail**

```bash
pnpm --filter @workspace/desk exec vitest run src/lib/agent-release-view-model.test.ts
```

Expected: FAIL because the review model does not exist.

- [ ] **Step 3: Build the compact panel**

Render lock state, exact versions/hashes, SIP/FMP/model preflights, five-batch matrix by instrument/failure class, code/opposing-model/human grades, critical failures, trace cost/latency/retries, claim→audit→passage→source lineage, and candidate case queue. Keep it collapsed by default so it remains a small Desk panel.

- [ ] **Step 4: Implement explicit auditable actions**

Human PASS/FAIL case-bundle grading, promotion/quarantine/supersede, and approve/reject/relock/revoke open a dialog requiring rationale and permanent credential step-up. A grade dialog displays and submits the exact series, case revision, and five-batch bundle hash. Show returned decision/grade ID, actor, credential ID, request ID, revision, policy hash or bundle hash, timestamp, and attestation verification. Never infer approval from a model result.

- [ ] **Step 5: Add browser tests**

Implement `loginAsReviewer(page)` in `e2e/helpers.ts` by opening a test-only session through the local test server's injected auth repository; it must not embed or persist a real credential.

Add exact Desk devDependency `"@playwright/test": "1.61.1"` and a `"test:e2e": "playwright test"` script, then regenerate the isolated lockfile. Install the matching Chromium binary for local/CI browser proof; do not rely on an undeclared global Playwright runtime.

```ts
test("human can review but cannot approve a failed release", async ({ page }) => {
  await loginAsReviewer(page);
  await page.getByRole("button", { name: "Agent Release Review" }).click();
  await expect(page.getByText("CRITICAL FAILURE")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve publication" })).toBeDisabled();
});
```

Also test anonymous denial, non-reviewer denial, five-agent list, lineage drill-down, human PASS/FAIL grade persistence after refresh, case decision persistence, successful eligible approval with step-up, and absence of prompt/secret leakage.

- [ ] **Step 6: Run unit/type/browser gates and inspect the rendered panel**

```bash
pnpm --filter @workspace/desk test
pnpm --filter @workspace/desk typecheck
pnpm --filter @workspace/desk exec playwright test e2e/agent-release-review.spec.ts
```

Expected: tests pass. Inspect a full-page screenshot at desktop and narrow widths; verify no clipping, unreadable hashes, hidden action state, or unprotected route flash.

- [ ] **Step 7: Commit**

```bash
git add artifacts/desk pnpm-lock.yaml
git commit -m "feat: add protected agent release review panel"
```

- [ ] **Step 8: Require explicit Desk actions for the canonical suite**

On the committed panel, the operator reviews each candidate's frozen sources, opposing grade, entity/timing evidence, and proposed label. Only the operator's individual step-up clicks may append adjudication decisions, promote to `GOLDEN`, choose `TRAINING|VALIDATION|HOLDOUT`, quarantine, supersede, and activate the immutable suite. After those decisions, run `pnpm --filter @workspace/scripts exec tsx src/verify-suite-coverage.ts` and stop unless all ten positive/negative class pairs and every critical-failure coverage rule pass. The implementation agent must not click or synthesize these approvals on the operator's behalf.

### Task 13: Complete CI, Live Shadow Evaluation, and Release Proof

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/live-smoke.yml`
- Create: `scripts/src/verify-agent-release.ts`
- Create: `scripts/src/verify-agent-release.test.ts`
- Modify: `scripts/package.json`
- Create: `docs/runbooks/agent-release-gates.md`
- Modify: `docs/plans/research-layer-buildout.md`
- Modify: `docs/audits/research-agent-baseline.md`

**Interfaces:**
- Produces one deterministic release-verification command and one manual live workflow.
- Produces a runbook for bootstrap, remote approvals, failures, revocation, relock, and recovery.

- [ ] **Step 1: Write a failing release-verifier test**

Define a typed `verificationStateFactory(overrides)` in the test file that starts with every named proof present, then applies explicit overrides.

```ts
it("fails when any required proof is missing", async () => {
  const result = await verifyAgentRelease(verificationStateFactory({ browserProof: null }));
  expect(result).toEqual(expect.objectContaining({ ok: false, missing: ["browserProof"] }));
});
```

- [ ] **Step 2: Implement the verifier**

Require: clean branch, frozen install, unit/type/build, pgTAP/lint, role isolation, trace reconstruction, live SIP, task-specific FMP, both model providers, exact 20+ case suite coverage, five passing full-suite batches, zero critical counts, human case grades, signed exact release approval, locked-version rejection, approved packet publication, research/strategy-truth separation, browser proof, and no broker/order code path.

Add `"verify:agent-release": "tsx ./src/verify-agent-release.ts"` to `scripts/package.json`. The command reads only explicitly named proof artifact paths and connection settings, emits one redacted JSON summary, and exits nonzero if any proof is absent or inconsistent.

- [ ] **Step 3: Add deterministic CI**

Pin the Supabase CLI version, start local Postgres, reset migrations, run pgTAP/lint/database integration tests, then existing backtest/unit/typecheck/build jobs. CI receives no live provider credentials and must not claim live proof.

```yaml
- uses: supabase/setup-cli@v1
  with:
    version: 2.109.1
- run: supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
- run: supabase db reset --local --no-seed
- run: supabase test db supabase/tests --local
- run: pnpm --filter @workspace/api-server run test:integration:db
- run: node tools/research/audit_runtime_sources.mjs
```

Verify this action/version against current official Supabase documentation immediately before implementation; if it changed, update the plan execution note and pin the current official equivalent.

- [ ] **Step 4: Add the manual protected live workflow**

`workflow_dispatch` uses protected environment secrets for Supabase role URLs, Alpaca, FMP, OpenAI, Anthropic, agent credentials, and decision attestation. It runs SIP first, stops on failure, runs FMP only for declared tasks, creates `LIVE_SMOKE`, runs both providers, executes one five-batch full-suite series, and uploads only redacted verification summaries.

- [ ] **Step 5: Commit the verifier, workflows, runbook, and pre-proof documentation**

Correct stale architecture descriptions and document the procedures without claiming a live pass. Commit before release proof so the fingerprint and clean-branch requirement are stable.

```bash
git add .github scripts/src scripts/package.json docs
git commit -m "chore: enforce agent release verification"
```

- [ ] **Step 6: Execute the deterministic local sequence on the clean commit**

```bash
pnpm install --frozen-lockfile
supabase db reset --local --no-seed
supabase test db supabase/tests --local
supabase db lint --local --fail-on error -s governance,research,operations,evidence,evaluation
pnpm -w test
pnpm run typecheck
pnpm run build
node --test tools/research/test/*.test.mjs
pnpm --filter @workspace/desk exec playwright test
pnpm --filter @workspace/scripts verify:agent-release -- --deterministic-only
```

Expected: every deterministic proof passes before live calls. Any failed step stops release.

- [ ] **Step 7: REMOTE SUPABASE LIVE-RUN APPROVAL GATE 4 — stop immediately before writes**

Present the clean commit/fingerprint, exact protected workflow inputs, active suite/policy/rubric hashes, planned five batches and live shadow run, provider/task matrix, estimated budgets, and the tables/functions that will receive run/trace/evidence/trial rows. Ask for explicit approval for this exact live remote-write action in this turn. Do not dispatch the workflow or create remote runs/trials before approval.

- [ ] **Step 8: After Gate 4 approval, run the live five-batch full-suite evaluation series**

For the exact configured fingerprint/policy/suite/rubric, run one series of five complete batches plus one fully reconstructable live shadow cycle. Preserve all results. Any case failure invalidates the series and requires a new series at ordinal 1. Obtain and persist a human PASS/FAIL grade for each case's five-batch bundle through the protected endpoint.

- [ ] **Step 9: Obtain the explicit human release decision and run the full verifier**

Only after machine eligibility, use the Desk panel with permanent-key step-up to sign approve/reject. Verify the decision attestation and exact hashes. Prove a locked fingerprint cannot publish, the approved fingerprint can publish one packet through the coordinator/DB function, and a subsequent relock/revoke blocks future packets. Run `pnpm --filter @workspace/scripts verify:agent-release` and require success.

- [ ] **Step 10: Record redacted proof references and final commit**

Correct the stale “ten-agent/LLM-backed” descriptions: existing committee roles are deterministic lenses; the five listed principals are the only new agents. Document live/fixture provenance, auth bootstrap, remote approval boundaries, failure reasons, release hashes, no-broker constraint, and only redacted immutable proof IDs/hashes. Do not commit provider outputs, secrets, or hidden case labels.

```bash
git add docs/plans/research-layer-buildout.md docs/audits/research-agent-baseline.md
git commit -m "docs: record agent release proof"
```

---

## Mandatory Phase Gates

| After task | Gate |
|---|---|
| 1 | Original checkout/server untouched; runtime mock reachability classified; live source defaults fail closed; historical access requires canonical revision/hash; read-only Alpaca SIP and declared FMP proof pass |
| 5 | Every API except two health checks protected; permanent human/service credentials audited; local SQL green; remote auth applied only after Gate 1 approval |
| 7 | Full private schemas locally green; remote phase-2 SQL applied only after Gate 2 approval; live SIP/FMP `LIVE_SMOKE` persisted |
| 8 | Five manifest-bound agent credentials exist only through explicit human decisions; exact versions and complete OpenAI/Anthropic traces/cost/retries reconstruct |
| 9 | Three worker agents produce a shadow packet with primary-source lineage and no strategy writes |
| 10 | 20+ case matrix, hidden partitions, no self-grading, deterministic thresholds, and human case grades work; remote case mutations only after Gate 3 approval |
| 12 | Protected small Desk panel browser-verified; explicit actions remain auditable after refresh |
| 13 | Gate 4 approved the exact live writes; one five-batch full-suite series passes; exact human release approval works; locked/revoked versions cannot publish |

## Final Acceptance Commands

```bash
git status --short
git diff --check
pnpm install --frozen-lockfile
supabase db reset --local --no-seed
supabase test db supabase/tests --local
supabase db lint --local --fail-on error -s governance,research,operations,evidence,evaluation
pnpm -w test
pnpm run typecheck
pnpm run build
node --test tools/research/test/*.test.mjs
pnpm --filter @workspace/desk exec playwright test
pnpm --filter @workspace/scripts verify:agent-release
```

Expected: clean status after the final commit; no diff errors; every deterministic, SQL, type, build, browser, connector, model, trace, evidence, evaluation, and publication proof passes. Remote Supabase history contains only separately approved migrations/data decisions. The original checkout and running server remain unchanged.
