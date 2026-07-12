# ADR 0002 — Variant Inventory (follow-up to ADR 0001)

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-07-12 |
| **Parent** | ADR 0001 — One Canonical Build (this is the per-variant inventory it called for) |

## Purpose

ADR 0001 consolidated everything to one canonical product and required a written inventory of
every other variant before archiving. This is that inventory: what each variant is, what it's
good for, what's wrong with it, and its assigned role. Roles here refine — and where noted,
supersede — the coarse category table in ADR 0001.

## Inventory

| Variant | Architectural approach | Strongest qualities | Main limitations | Assigned role |
|---|---|---|---|---|
| Context Engineering OS | Lightweight Python business command center, task router, source governance, static neural UI | Clear bounded-context vision; finance handoff; UNKNOWN-safe research policies | Product spec retains contradictory legacy finance sections; duplicated code with CODEX-STOCKS; **unauthenticated all-interface development server** | Separate business control plane; routes finance tasks outward; frozen outside the launch path |
| CODEX-STOCKS | Python market-research and provider orchestration | Candidate discovery, catalyst research, provider fallback, source governance | Large monolithic services; duplicated Context code; HUD is mostly visualization, not a real agent runtime; contradictory generated artifact | Finance research / candidate-discovery **reference** only; research authority is absorbed by the canonical build (ADR 0001) |
| **Market-Insight-Engine** | Contract-first TypeScript monorepo | Pure deterministic core, committee, OpenAPI/Zod/generated clients, Postgres, replay, journal, history, two product UIs | Workstation branch is damaged and divergent from main; some advanced branch work conflicts with newer main fixes | **Canonical trading-desk product** after repository recovery (fresh clone from `0e0d9e2`) |
| trading-desk-copilot | Flat Python product monolith | Good single `CopilotEvent` boundary, live API/UI, manual positions, journal, replay | Local-file state, duplicate journal paths, weak artifact provenance, partially unavailable committee roles | Algorithm donor (Python-family spine only if a Python line is ever revived — it is not on the launch path) |
| best-trading-bot | Quant/research fork of the Python copilot | Strongest Python gates, long-only discipline, regime work, cost/overfit utilities, reproducibility scripts | Several inconsistent backtest engines; dead orchestrator; **no demonstrated edge**; validation artifacts can cross-contaminate variants | Quant-validation donor, never a second live brain; isolate its validation artifacts from other variants |
| tdc-merge-review | Additive copy combining best-trading-bot with Research Lab | Broadest Python inventory; typed pandas Research Lab | Broken `.git` worktree pointer; Research Lab not connected to production signals; multiple fill contracts | Merge manifest / reference specimen only; archive after inventory |
| trading-desk-copilot2 | React/Vite UI plus tRPC/Express proxies | Strong visual shell, hosted-product patterns, auth/persistence scaffolding | Core trading surfaces are mocked/random; Python proxy lacks production controls; **UI computes trading values** (violates the deterministic-core boundary) | UI-pattern donor only; no logic extraction |
| tradingview-mcp | Desktop automation over Chrome DevTools/private TradingView APIs | Broad supervised TradingView/Pine/layout tooling | Private API/DOM fragility, unrestricted evaluation, destructive UI behavior, singleton race risk | Supervised development and parity tool only; permanently outside strategy truth |
| tradingview-bridge | TradingView webhook → Worker/D1 → REST/MCP | Correct asynchronous integration shape | Critical Worker source/schema are dataless — auth, idempotency, retention, and rate limiting **unverified** | Parked; candidate persisted signal-ingress adapter only after a real audit |
| tradingview-terminal | React Charting Library terminal | Plausible human chart-review surface | Missing licensed library/data proxy; **client-exposed notification key**; fail-open notifications; timestamp/session defects | Parked; optional manual UI, never a strategy engine |
| stock-market-analysis | Latitude PromptL example | Prompt experimentation | Not a product runtime or validated market system | Archive/reference |
| All GIT HUBS | Unversioned vendor/reference dump | SDK, agent, n8n, Latitude, and workflow examples | Dataless files, duplicate snapshots, **prompt-leak corpora**, unpinned executable workflows, **secret-bearing Lightspeed material** | Quarantine; adopt selected projects only as pinned dependencies; never feed corpora to agents |

## Immediate security actions (independent of any build decision)

1. **Rotate the Lightspeed credentials** found in `All GIT HUBS` — treat any secret in an
   unversioned dump as compromised. Purge the material after rotation.
2. **Rotate the client-exposed notification key** in `tradingview-terminal` and remove it from
   client-shipped code.
3. **Never run Context Engineering OS's development server bound to all interfaces** outside a
   trusted network — it is unauthenticated. Bind to loopback until auth exists.
4. Keep the prompt-leak corpora quarantined: they must never enter any agent context, fixture
   set, or evaluation dataset of the canonical build.

## Cross-contamination rule

`best-trading-bot`'s validation artifacts (cached fixtures, sweep outputs, result JSONs) must not
be copied between variants — results memos derived from them are not reproducible evidence
(ADR 0001, competitive-brief finding). Any number imported into the canonical build's docs
requires the committed harness, data manifest, and trade ledger that produced it.

## Supersession notes vs ADR 0001

- `trading-desk-copilot` (Python) is confirmed as **algorithm donor**; the "Python-family spine"
  role is recorded but dormant — there is one canonical product and it is TypeScript.
- `tradingview-bridge` / `tradingview-terminal` move from generic "Park" to parked-with-conditions
  (audit gate, key rotation) as above.
- All other roles match ADR 0001.
