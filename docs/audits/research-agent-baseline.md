# Research-Agent Baseline — Phase 0 Evidence Map

> Mandatory first deliverable of the Day-Trading Research-Agent Layer implementation brief (v1.0.0, §1).
> Records what actually exists in the repository before any implementation change. Every claim carries
> a file path.
>
> **Revision note:** the first draft of this audit was produced against commit `2848692`, a stale
> clone. Remote `main` had advanced ~20 commits (PRs #16–#28) and invalidated several findings.
> This revision re-audits against current `main`. The stale-clone episode is itself evidence for the
> brief's §1 rule: never infer repository state — inspect it.

| | |
|---|---|
| **Audit date** | 2026-07-12 (revised same day after rebase) |
| **Repository** | `Jmoney1214/Market-Insight-Engine` |
| **Absolute path** | `/home/user/Market-Insight-Engine` |
| **Active branch** | `claude/market-analysis-agent-search-hzybu1` |
| **Base commit** | `0e0d9e299ec040a740da6027b0be72be15574345` (current `origin/main`) |
| **Worktree state** | Clean apart from this PR's docs |
| **CI** | `.github/workflows/ci.yml` — typecheck, unit tests (`pnpm -w test`, vitest), backtest (`node:test`). All green on this PR's head |

---

## 1. What this repository is (current main)

No longer a mock-data MVP. FinDesk has evolved into a market-data platform plus a research-only
trading-desk copilot (`docs/architecture.md`):

| Package | Path | Role |
|---|---|---|
| `@workspace/api-server` | `artifacts/api-server` | Express 5 API: provider clients → rate limiter → Zod normalizer → L1 mem/L2 Postgres cache; SSE streaming; `/api/v1/*` agent API; `/api/copilot/*` |
| `@workspace/desk` | `artifacts/desk` | **Trading Desk terminal** (`/desk/`, `Terminal.tsx`) — read-only research terminal with a permanent no-trading guardrail |
| `@workspace/findesk` | `artifacts/findesk` | Report/dashboard web app at `/` |
| `@workspace/copilot-core` | `lib/copilot-core` | **CopilotEvent contract**, detectors, features, gates, feed quality, **edge scoreboard** |
| `@workspace/copilot-committee` | `lib/copilot-committee` | **Analyst committee — ten lenses**: bullCase, bearCase, catalyst, memory, orderFlow, pattern, position, regime, riskCritic, technical; orchestrator + guardrails + deterministic fallback (`COPILOT_LLM_PROVIDER=none`) |
| `lib/integrations-anthropic-ai`, `-gemini-ai`, `-openai-ai-server` | | LLM provider integrations behind a selection layer |
| `@workspace/db` | `lib/db` | Drizzle over Postgres — **hosted on a dedicated Supabase project** (`findesk`, RLS enabled, no public REST; direct Postgres via session pooler; `replit.md:14`) |
| `@workspace/api-spec` / `api-zod` / `api-client-react` | `lib/` | OpenAPI single source of truth → Orval codegen (shared spec covers copilot endpoints) |
| `mockup-sandbox`, `scripts` | | Unchanged support packages |

**Database schema** (`lib/db/src/schema/`): `reports` (now with `source` provenance column),
`watchlist`, `breakoutCandidates`, `historyLog`, `journalEntries`, `scorecard`, `strategyRegistry`,
`universe`, `validationState`.

**Data providers:** FMP Premium (750 calls/min) and Alpaca SIP (REST + WebSocket) are live, paid,
and rate-limit/cache managed. A cross-source verifier adjudicates Alpaca-vs-FMP disagreements on
1-min tape (PR #17). Daily universe snapshots fix survivorship bias (PR #16).

**The mock is gone:** `POST /api/analyze` calls `buildReport()`
(`artifacts/api-server/src/routes/analysis.ts:24`) and persists `reports.source` provenance;
coin-flip ratings were removed in "Report provenance" (commit `618e001`).

## 2. Authoritative instruction files

| File | Content |
|---|---|
| `docs/architecture.md` | Build & data-pipeline architecture: one data plane, contract-first, quota-as-budget, per-section degradation |
| `.agents/memory/MEMORY.md` + 13 topic notes | Operational invariants: CopilotEvent 4-edit contract chain, measurement integrity (only `MANUAL_CONFIRMED` + whitelisted action can validate an edge), replay gating, deterministic committee testing, live-source rules |
| `.claude/agents/` | Three build/verification agents: `backtest-runner.md`, `pine-reviewer.md`, `replay-grader.md` |
| `replit.md` | Stack + Supabase hosting details + data-rules invariant |
| `lib/api-spec/openapi.yaml` | Shared API contract (FinDesk + Desk + copilot) |

## 3. Existing agent definitions

- **Committee lenses (10)** in `lib/copilot-committee/src/agents/` — LLM-backed with deterministic
  fallback, guardrail-wrapped, tested (`committee.test.ts`, `guardrails.test.ts`,
  `providerSelection.test.ts`).
- **Build-time agents (3)** in `.claude/agents/` (backtest-runner, pine-reviewer, replay-grader).
- **None of the brief's five research agents exist** (Lead, Catalyst Verifier, Source Guardian,
  Macro, Capital-Structure) — no equivalents found.

## 4. Existing market and research providers

FMP, Alpaca SIP (REST/WS/SSE), keyless Yahoo v8 chart (report fallback), Nasdaq keyless
earnings-surprise endpoint, TradingView (Pine↔Node parity via MCP, PR #21). LLM: OpenAI, Gemini,
Anthropic integration libs. **Absent:** SEC EDGAR, FRED/BLS/BEA, company-IR, licensed news — the
brief's primary-source adapter set does not exist.

## 5. Supabase

**Exists as the hosted Postgres** (project `findesk`, us-east-1; RLS enabled with no policies, so
tables are unreachable via Supabase public REST — direct Postgres only). The brief's "Supabase
operational brain" therefore maps to real infrastructure. What does *not* exist yet: the research/
evidence/governance schema layout, append-only enforcement, and migration files (schema is applied
via `drizzle push`; PR #25 added guardrails against dropping externally-owned tables).

## 6. Existing contract types

- OpenAPI → Orval (Zod + react-query) — healthy, spec-first, shared across FinDesk/Desk/copilot.
- **CopilotEvent** contract in `lib/copilot-core/src/event.ts` with an explicit boundary-mapper
  allowlist (`.agents/memory/copilot-event-contract.md`).
- **None of the brief's research contracts exist** (CandidateSeed, Claim, SourceAudit,
  CandidatePacket, PacketDependencyManifest, …), and there is no claim-level provenance or
  source-audit machinery anywhere.

## 7. Existing tests and their results

Vitest suites in api-server (`alpacaData`, `buildReport`, `classify`, `copilotData`, `history`,
`indicators`, `scorecard`, `copilot/explain`, `copilot/journal`), desk (`use-replay-store`,
`journal-actions`, `render-safety`, `safety`, `trigger-alerts`), copilot-core (`edgeScoreboard`,
`event`, `features`), copilot-committee; plus a `node:test` backtest job. CI (typecheck + unit +
backtest): **green** on this PR's head commit.

## 8. Duplicate, stale, or damaged definitions

- `replit.md` retains some template sections alongside real invariants — partially stale.
- `docs/architecture.md` §2 describes a target `lib/market-data` extraction not yet performed
  (providers still live in api-server) — plan, not damage.
- No conflicting or damaged definitions found.

## 9. Missing credentials (by provider name only)

Configured (present per docs/tests; values not inspected): FMP, Alpaca (SIP), Supabase DB password,
OpenAI / Gemini / Anthropic keys. **Missing for the research layer:** SEC EDGAR declared
User-Agent, FRED API key, BLS v2 key, BEA key; licensed-news providers (deferred procurement).

## 10. Benchmark-registry verification

- **`B0_CURRENT_CREW` — VERIFIED.** It is this repository's current `main`: deterministic candidate
  selection (breakout candidates → morning scan), Alpaca SIP truth, FMP enrichment, Supabase-hosted
  persistence, ten committee lenses + guardrails, edge scoreboard with measurement-integrity gating,
  journal idempotency, no execution authority. **Freeze for the benchmark: commit `0e0d9e2`.**
- `B1_EXISTING_SYSTEM_RECONFIG` — partially maps to this repo (committee readers, desk agents,
  no-settings-UI, no-promotion rules). Its `Context OS` and `CODEX-STOCKS` planes remain absent.
- `CODEX-STOCKS` repo: **not accessible in this session's repository scope**, but the federated-vs-attached
  competitive brief (2026-07-12) reports it exists remotely (inspected commit `4a7f630`), alongside a
  Context Engineering OS router repo. The earlier "does not exist" finding is therefore corrected to
  "exists, outside this session's access." **Blocking decision before Phase 1:** CODEX-STOCKS remains
  the research owner (federated) or Market formally absorbs it (attached). The in-repo
  `artifacts/research-service` placement in the buildout plan is **provisional on that decision** —
  two research authorities must never operate simultaneously.
- Companion repo `Brain-stocks`: unchanged; crypto bot; out of scope (pattern reference only).

## 11. Proposed file-by-file changes for Phase 1

See `docs/plans/research-layer-buildout.md` §5–7. Phase 1 creates `lib/research-contracts`:

```
lib/research-contracts/
  package.json, tsconfig.json      new @workspace/research-contracts package
  src/contracts/*.ts               Zod v4 definitions — THE single source of truth
  src/schemas/*.schema.json        GENERATED from Zod (z.toJSONSchema), checked in;
                                   CI fails on drift between source and generated output
  src/canonical.ts                 RFC 8785 canonical JSON + SHA-256; every hash preimage
                                   omits the object's own hash field
  src/validate.ts                  strict validation helpers (finalize-then-validate)
  test/*.test.ts                   valid/invalid fixtures per contract; hash-stability tests
```

Two review findings from PR #29 are incorporated as design rules:

1. **Single source of truth:** contracts are authored once in Zod; JSON Schema files are generated
   artifacts (kept in-repo for language-neutral consumers and CI-checked for drift). No
   hand-maintained parallel definitions.
2. **Self-referential hash fields:** every hashed contract keeps `canonicalSha256` **required** in
   its final schema; pre-hash drafts are internal TypeScript types (`Omit<T,'canonicalSha256'>`),
   never validated as contract instances. Validation runs on finalized objects only; the hash
   preimage is the canonicalized object with its own hash field omitted (brief §10.12 rule).

Acceptance: all fixtures validate/reject correctly; generated schemas match committed schemas;
hash stable across key order; existing CI (typecheck + unit + backtest) stays green.
