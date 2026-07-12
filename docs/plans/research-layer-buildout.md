# Day-Trading Research Layer — Build-Out Plan

> The adaptation of the Day-Trading Research-Agent Layer implementation brief (v1.0.0, 2026-07-11)
> to this repository as it actually exists. The brief is the design authority; this document is the
> executable mapping. Where the two differ, the difference and its reason are stated explicitly.
>
> Companion documents: `docs/audits/research-agent-baseline.md` (Phase 0 evidence map) ·
> `docs/decisions/` (one ADR per pattern imported from reference systems).

**One-sentence purpose:** convert deterministic scanner candidates into source-grounded,
time-bounded, versioned CandidatePackets that the deterministic Market-Insight core consumes —
without allowing an LLM to manufacture market facts, signals, risk values, or trade authority.

---

## 1. Non-negotiable boundaries (inherited verbatim from the brief)

- No agent can create or alter a trade signal, price, quote, score, risk value, gate, or hard block.
- No research agent can access a broker or order tool. **Broker execution is permanently prohibited.**
- No missing value is silently estimated; no conflicting value is silently averaged.
- No agent output enters strategy truth. No agent grades its own findings.
- Every external claim requires a SourceAudit before it can enter a packet as supported. **Fail closed.**
- The completeness gate is a decision table in code. A model is never asked whether a packet is complete.
- Social posts are never event proof. An allowlisted domain is never automatically trusted.
- Every time-sensitive fact carries its applicable source/event/retrieval time and `asOf`.

## 2. Mapping the brief to this repository

Current `main` (`0e0d9e2`) already contains a working desk system — the B0 crew: Alpaca SIP + FMP
data plane, breakout-candidate scanner, ten-lens copilot committee, CopilotEvents, edge scoreboard,
Supabase-hosted Postgres, CI (baseline audit §1, §10). The research layer therefore **extends a
live system rather than replacing a mock**. The mapping:

| Brief concept | Implementation here | Why |
|---|---|---|
| `CODEX-STOCKS` repo (research owner) | **Provisional:** new workspace package **`artifacts/research-service`** | CODEX-STOCKS exists remotely (competitive brief 2026-07-12, commit `4a7f630`) but is outside this session's access. **Ownership decision gate before Phase 1** (§9.0): federate (CODEX stays research owner) or absorb (this package becomes canonical). The versioned contract boundary makes either outcome mechanical; two research authorities must never run at once |
| Shared contracts repo | New package **`lib/research-contracts`** | Same contract-first culture as `lib/api-spec` and `lib/copilot-core`; consumed by research-service and api-server |
| Existing deterministic scanner | **Exists** — breakout candidates → morning scan (`lib/db/src/schema/breakoutCandidates.ts`, PR #28) | Add a thin emitter that maps accepted scan candidates into `CandidateSeed` contracts; do not build a second scanner |
| Temporal durable workflow | **Postgres-backed state machine** (v1) with the brief's exact states/outcomes; Temporal adoption is a later swap | One fewer platform before value ships; states/contracts are Temporal-shaped already |
| Supabase operational brain | **Exists literally** — dedicated Supabase project hosts the Postgres (`replit.md:14`, RLS on, direct-Postgres only) | Add the research/evidence/operations schema layout with append-only enforcement and real migration files (today: `drizzle push`) |
| S3 Object Lock evidence store | **Deferred.** V1: append-only tables + RFC 8785/SHA-256 hashes on every object | The hashing discipline lands now; WORM storage is a bolt-on later |
| mTLS/JWT outbox→inbox delivery | **Transactional outbox/inbox in Postgres** behind the same `PacketDeliveryRequest/Receipt` contracts, consumed in-process in v1 | Idempotency keys, durable receipts, and supersession semantics exist from day one even without a wire; mTLS/JWT activates when the services split |
| Market-Insight deterministic core | **Exists** — `copilot-core` (detectors, features, gates, edge scoreboard) + deterministic committee fallback | The packet consumer feeds verified research context INTO this core; research output never writes signals, gates, or scores |
| "Deterministic committee output" | **Exists** — `lib/copilot-committee` ten lenses + guardrails + orchestrator | The brief's committee concept is already built; CandidatePackets become a new, provenance-audited input to it |
| CopilotEvent → Market Desk UI | **Both exist** — `copilot-core/src/event.ts` + `artifacts/desk` Terminal | Verified packets are referenced **beside** CopilotEvent (packet ID + hash), **never inside the event's deterministic trigger/gate hash path** — research context must not be able to alter what fires or blocks. Desk renders sources/UNKNOWNs/conflicts from the referenced packet. Any event-shape change respects the 4-edit contract chain in `.agents/memory/copilot-event-contract.md` |
| LLM runtime | **Exists** — `integrations-anthropic-ai` / `-gemini-ai` / `-openai-ai-server` behind provider selection with deterministic fallback | Research agents reuse this layer; the brief's OpenAI-SDK prescription is satisfied by the gateway pattern, not a new framework |
| ClickHouse / Datadog / Kafka / enterprise procurement | **All deferred** per the brief's own "measured gap" rule | No measured gap yet |

**What the brief adds that nothing in the repo does today:** claim-level source auditing
(Source Guardian + SourceAudit), primary-source adapters (SEC EDGAR, FRED/BLS/BEA, company IR),
the deterministic completeness gate, hash-frozen CandidatePackets with dependency manifests,
conditional macro/capital-structure diligence, agent manifests as the sole permission source, and
the research-run state machine. That is the actual build.

**Out of scope entirely:** `Brain-stocks` (crypto bot — pattern reference only), broker execution,
portfolio construction, autonomous strategy promotion, the committee/debate layer (see §8, arm B5),
Context Engineering OS.

## 3. Pipeline (end to end)

```
LANE 1 · DISCOVER (deterministic)
  Scanner (gap / relative-volume / news-activity screens over licensed market data)
    → CandidateSeed        hashed, time-bounded, security identity (CIK/FIGI), expires in minutes
    → Research Intake      schema + symbol identity + market session + idempotency validation
                           creates ResearchRun

LANE 2 · ORCHESTRATE (deterministic, durable)
  ResearchWorkflow state machine:
    RECEIVED → VALIDATING_INPUT → PLANNING → RESEARCHING → AUDITING_SOURCES
    → RESOLVING_CONFLICTS → CHECKING_COMPLETENESS → PACKAGING → VALIDATING_PACKET
    → DELIVERING → TERMINAL
  Separate fields (never overloaded):
    researchOutcome:    COMPLETE | PARTIAL | BLOCKED | FAILED | CANCELED | TIMED_OUT | BUDGET_EXCEEDED
    publicationStatus:  NOT_ELIGIBLE | ELIGIBLE | PENDING | ACCEPTED | REJECTED | SUPERSEDED
  ResearchPlan: Lead proposes → deterministic policy validates → immutable once running
  Conditional router: versioned trigger rules decide whether macro/capital agents run — never the model

LANE 3 · RESEARCH (agents — research and narration only)
  Market Research Lead        every run   plans, invokes specialists as typed tools, assembles packet
  Catalyst Verifier           every run   event truth: what/which entity/when published/occurred/knowable
  Macro Context Analyst       conditional Fed/CPI windows, regime moves, macro reason codes
  IPO & Capital-Structure     conditional IPO/SPAC/offering/shelf/lock-up lifecycle triggers

LANE 4 · VERIFY (fail closed)
  Source Guardian             audits every claim: passage entailment, source class, timing,
                              syndication lineage, corrections   → SourceAudit (SUPPORTED |
                              PARTIALLY_SUPPORTED | CONFLICTED | UNSUPPORTED | UNKNOWN)
  Completeness & Policy Gate  the brief §7.3 decision table, implemented as code + DB constraints
    → CandidatePacket         immutable, RFC 8785 + SHA-256 canonical hash, versioned revision,
                              expiring, frozen PacketDependencyManifest; supersession, never mutation

LANE 5 · PERSIST & CONSUME
  Postgres (research/evidence/operations schemas, append-only where required)
    → Market-Insight consumer  recomputes packet + manifest + dependency hashes, enforces expiry,
                               rejects unknown major versions; maps packet → Report jsonb
    → FinDesk UI               sources, times, conflicts, UNKNOWNs visible; Playwright-verified
```

## 4. Agent roster (five, no more)

A sixth agent requires evaluation evidence of a materially different input contract, output
contract, source set, permission boundary, failure mode, or owner (brief §2.1).

| Agent | Runs | Mission | Hard limits | Failure mode |
|---|---|---|---|---|
| `market-research-lead` | Every accepted seed | Plan, invoke specialists as typed tools, assemble packet | Cannot invent fields, alter audit verdicts, or publish past a failed gate | `RETURN_PARTIAL_OR_BLOCKED` |
| `catalyst-verifier` | Always | Did the event happen; what exactly; which legal entity; publication vs event vs first-knowable time; new/stale/corrected | No trade language; no price inference; sentiment is never event proof | `RETURN_UNKNOWN` |
| `source-guardian` | Every external claim | Claim↔passage entailment, source class, temporal validity, syndication lineage, corrections/retractions | Cannot rewrite claims or delete evidence; allowlist ≠ trusted | `FAIL_CLOSED` |
| `macro-context-analyst` | Deterministic macro trigger | Bounded macro context: scheduled releases, reported vs consensus, vintages, regime references | No causal certainty from correlation; reads regime, never authors it | `RETURN_NOT_REQUIRED / UNKNOWN` |
| `capital-structure-diligence-analyst` | Deterministic lifecycle trigger | Filing-grounded float, dilution, lock-ups, warrants, registrations, upcoming dates | Float estimates labeled ESTIMATED with method; filing presence ≠ effectiveness | `RETURN_UNKNOWN` per field |

Every agent runs from a schema-validated YAML manifest (`agent-manifests/`): allowlisted tools,
read/write scopes, model policy, budgets (`maximum_tool_calls`, `maximum_model_calls`, deadline),
declared failure mode, eval-suite reference. The manifest is the **sole** permission source;
startup rejects wildcard tools, broker/order/shell/DDL/browser tools, and manifest/instruction
hash mismatches.

## 5. Contracts and data model

### v1 contract set (in `lib/research-contracts`)

Core (Phase 1): `MessageEnvelope`, `CandidateSeed`, `ResearchRequest`, `ResearchPlan`,
`SourceDocument`, `Claim`, `CatalystRecord`, `SourceAudit`, `ProviderCoverage`, `UnknownField`,
`Conflict`, `PacketDependencyManifest`, `CandidatePacket`, `ResearchError`.

Added with their phases: `CatalystVerificationRequest`, `SourceAuditRequest`,
`MacroContextRequest`, `CapitalStructureDiligenceRequest`, `MacroContext`,
`CapitalStructureDiligence` (Phases 5–7); `PacketDeliveryRequest/Receipt` (Phase 10, in-process);
`BrowserVerificationRequest/Result` (Phase 11); governance contracts (`EntitlementPolicy`,
`ApprovalRequest/Decision`, `KillSwitchState`, `ReleaseGatePolicy`) as their phases arrive.

Rules (brief §10): JSON Schema draft 2020-12, `additionalProperties:false`, semver with fail-closed
unknown majors, RFC 8785 canonicalization, each object's hash computed with its own hash field
omitted, dependency-manifest entries sorted by `objectType, objectId, objectVersion`.
`UNKNOWN` ≠ `NOT_REQUIRED` ≠ `NOT_APPLICABLE`, everywhere.

Two rules adopted from PR #29 review findings:

- **Single source of truth:** contracts are authored once as Zod v4 definitions
  (`src/contracts/*.ts`); the `*.schema.json` files are generated via `z.toJSONSchema`, checked in
  for language-neutral consumers, and CI fails on drift. No hand-maintained parallel schema.
- **Self-referential hashes:** `canonicalSha256` is **required** on finalized contract instances;
  pre-hash drafts are internal `Omit<T,'canonicalSha256'>` types and are never validated as
  contract instances (finalize-then-validate). The hash preimage is the canonicalized object with
  its own hash field omitted, so hash computation and strict validation never conflict.

Imported field decisions (see `docs/decisions/` for provenance):

- `CandidatePacket.researchMode: FAST | STANDARD | DEEP` — recorded from day one (DeepFund).
- Specialist outputs are **condensed structured factors**, never article dumps (ContestTrade).
- Every deterministic calculation carries numeric provenance: inputs, input source IDs,
  function + version, configuration hash, timestamp, result hash (FinRobot).
- Per-agent budgets: model calls, tool calls, elapsed seconds, cost (TradingAgents).
- Agent memory is `current_run_only` in v1; cross-run retrieval is a gated experiment arm (FinMem,
  and `Brain-stocks/tests/test_vector_db_context_poisoning.py` as the cautionary prior art).

### Database schemas (Drizzle migrations, Phase 2)

```
research:   candidate_seeds, research_requests, research_runs, research_plans, specialist_runs,
            catalyst_records, macro_contexts, capital_structure_diligence, candidate_packets,
            provider_coverage, unknown_fields, conflicts
evidence:   source_documents, source_versions, claims, claim_evidence, source_audits,
            source_exclusions, duplicate_clusters, corrections
operations: workflow_events, agent_runs, tool_calls, tool_results, errors, retries
governance: agent_versions, configuration_versions, source_policies, tool_registry (later phases)
```

Packet, audit, and evidence tables are **append-only** (INSERT-only policies + triggers).
Corrections create new rows linked by supersession; nothing is updated in place.

## 6. Authority map (one owner per truth)

| Truth | Authority |
|---|---|
| Live US quotes & trades | Alpaca SIP (adapter interface + fixtures first; key optional in v1) |
| Depth, history, replay | Databento — **deferred procurement**, adapter interface reserved |
| Filings & capital structure | SEC EDGAR (declared User-Agent, ≤10 req/s, bulk ZIPs for history) |
| Macro releases | Issuing agency; FRED/ALFRED for series + vintages |
| Signals, risk, gates, hard blocks | Market-Insight deterministic core (code) |
| Memory, provenance, audit | Postgres, append-only |
| Immutable evidence | Hashes now; WORM object storage later |
| Order placement | **NO ONE — prohibited, permanently** |

## 7. Build phases

Adapted from the brief's 15 phases; each independently reversible; acceptance gates before advancing.

| # | Phase | Delivers | Acceptance |
|---|---|---|---|
| 0 | **Baseline evidence map** ✅ | `docs/audits/research-agent-baseline.md` | This PR |
| 1 | **Shared contracts** | `lib/research-contracts`: core schemas, Zod types, RFC 8785 + SHA-256 utility, Ajv strict validation, fixture tests | All fixtures validate/reject correctly; hash stable across key order; typecheck green |
| 2 | DB migrations | Drizzle schemas above; append-only triggers; state-machine constraints | Migration tests; UPDATE/DELETE denied on append-only tables |
| 3 | Manifests & policy | 5 agent manifests (YAML), manifest JSON Schema, startup validator, tool registry | Invalid/wildcard/forbidden-tool manifests fail CI |
| 4 | Adapters + seed emitter | SEC EDGAR, FRED/BLS/BEA, company-IR adapters (fixture-first); **CandidateSeed emitter over the existing breakout/morning-scan pipeline**; market data reuses the existing FMP/Alpaca data plane | Fixture tests pass; live calls opt-in; secrets redacted; seeds validate + dedupe on idempotency key |
| 5 | Deterministic spine + draft-only Catalyst Verifier | Intake → state machine → stub research → gate, end to end; then first agent, **publication disabled**; golden eval baseline | Spine runs a seed to TERMINAL deterministically; catalyst golden set scored and recorded |
| 6 | Source Guardian + Lead + gate | Claim/evidence/audit pipeline; completeness decision table (every row tested); packet assembly + hashing; publication first eligible | Every packet claim audited; adversarial source fixtures pass; gate table 100% covered |
| 7 | Conditional specialists | Deterministic router + macro + capital-structure agents | No unnecessary invocations; vintage/filing fixtures pass |
| 8 | Consumer boundary + UI | Packet consumer feeding copilot-core/committee as audited context; CopilotEvent extended with research fields (4-edit contract chain); Desk terminal renders sources/UNKNOWNs/conflicts | Boundary tests: tampered/expired/unknown-major packets rejected; research output cannot write signals/gates/scores; Playwright assertions pass |
| 9+ | Hardening track | Security/adversarial fixtures, benchmark harness (§8), observability, entitlement registry, kill switches, shadow mode per signed gate policy | Per brief §17–19 |

## 8. Experiment registry (12 arms, one platform)

The benchmark registry is implemented as **configurations of this platform, not separate
codebases** — shared adapters, contracts, persistence, eval harness, and an identical frozen
CandidateSeed feed, so every measured delta is attributable to the flagged difference and not to
implementation quality. `B2L` (lean profile: Lead + Catalyst Verifier + Source Guardian, Postgres
state, current-run memory) is the substrate and is what Phases 1–6 build.

| Arm | Configuration on the platform |
|---|---|
| `D0_DETERMINISTIC_ONLY` | Agents disabled; scanner + deterministic enrichment only. **Every arm reports vs D0.** |
| `B2_INSTITUTIONAL_RESEARCH_LAYER` | Full five-agent configuration (this plan) |
| `B3_AGENTIC_TRADING_MIMIC` | Validated-plan + registry flags (weakest arm as an accuracy hypothesis; mostly ops) |
| `B4_FINROBOT_MIMIC` | Pipeline-depth flag: added Modeling/Synthesis stages |
| `B5_TRADING_AGENTS_MIMIC` | Debate flag: Bull/Bear/Judge after synthesis — advisory only, downstream of the gate |
| `B6_DEEPFUND_MIMIC` | Planner-vs-parallel routing flag |
| `B7_CONTEST_TRADE_MIMIC` | DEEP mode: dual independent Catalyst Verifiers + conflict resolver |
| `B8_FINMEM_MIMIC` | Memory flag: `A` current-run-only vs `B` gated cross-run retrieval |
| `B9_QUANT_AGENT_MIMIC` | Reader-narration flag over deterministic indicator/pattern/trend/risk lenses |
| `B10_COMPOSITE_HYBRID` | Winning flag combination — **built last, after single-flag ablations** |
| `B0_CURRENT_CREW` | **Verified — it is this repo's current `main`.** Freeze at commit `0e0d9e2` (prompts, committee lenses, schema, fixtures) as the principal control (baseline audit §10) |
| `B1_EXISTING_SYSTEM_RECONFIG` | Partially maps to this repo's governance (committee readers, desk agents, no-promotion rules); its Context OS / CODEX-STOCKS planes remain absent |

Metrics per arm (research quality, not profitability): factual accuracy vs adjudicated golden set,
unsupported-claim rate, stale-as-new rate, false-catalyst rate, primary-source rate, UNKNOWN
handling, wrong-entity rate, latency p50/p95, cost per packet.

## 9. Standing decisions

0. **BLOCKING — research ownership topology.** CODEX-STOCKS exists remotely (competitive brief
   2026-07-12, commit `4a7f630`); Context Engineering OS exists as an outer business router. Before
   Phase 1 ships, the owner must decide: **federate** (CODEX-STOCKS remains research owner; this
   repo implements only the packet consumer boundary) or **absorb** (this plan's
   `artifacts/research-service` becomes canonical and CODEX-STOCKS is retired after parity is
   proved — preserve the remote until then). The contracts in Phase 1 are identical under both
   outcomes, so Phase 1 may proceed; Phase 2+ placement may not. Two research authorities must
   never operate simultaneously.
1. **Cache is not audit.** The market-data cache (L1/L2), the evidence store, and operational logs
   are separate concerns with different stores, retention, entitlement, and mutation policies. The
   cache is mutable and disposable; evidence rows are append-only and hashed; neither substitutes
   for the other.
2. **Per-agent identity, not a shared bearer token.** Every agent invocation carries its own
   principal (manifest ID + version) through the tool gateway and into audit rows; a shared service
   token defeats scope enforcement and attribution. Wire-level auth (mTLS/JWT) arrives when the
   services split, but per-agent attribution exists from Phase 3.
3. **Agent runtime: resolved.** Research agents reuse the repo's existing provider-selection layer
   (`lib/integrations-anthropic-ai` / `-gemini-ai` / `-openai-ai-server`) with the committee's
   deterministic-fallback pattern (`COPILOT_LLM_PROVIDER=none` in tests). No new agent framework;
   manifests + tool gateway wrap the existing integrations.
4. **Reference code is never copied** — patterns are reimplemented in TypeScript
   (AgenticTrading is OpenMDW-1.0; all six references are research-grade). One ADR per imported
   pattern in `docs/decisions/`.
5. **Enterprise procurement follows measured gaps**, not the brief's P0 list: SEC/FRED/BLS/BEA
   (free) and one market-data key are sufficient through Phase 8.
6. **Licensing/entitlement review** (data vendor display/non-display/model-input rights) is with
   counsel; the `EntitlementPolicy` gateway lands before any licensed feed does.
