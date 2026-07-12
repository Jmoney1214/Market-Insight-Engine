# ADR 0001 — One Canonical Build: Market-Insight-Engine

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-07-12 |
| **Decides** | Buildout plan standing decision 0 (research ownership topology) and product consolidation |
| **Canonical baseline** | `main` @ `0e0d9e299ec040a740da6027b0be72be15574345` |

## Context

There is no complete working product. There is **one viable product foundation surrounded by
prototypes, research branches, integrations, mocks, and downloaded reference code**. Components
pass isolated tests, but no end-to-end workflow has been proven. Local checkouts on the primary
workstation are in poor shape (tracked deletions in Market-Insight-Engine and Context OS,
absent CODEX-STOCKS checkout, broken Git metadata in tdc-merge-review). Prior documents —
including the research-layer brief and the federated-vs-attached competitive brief — compared
architectures as if they were competing products. They are not; they are plans and parts.

## Decision

**Market-Insight-Engine is the only product.** Everything else is a donor, a tool, or an archive.
Stop merging builds; start from clean authoritative `main` (`0e0d9e2`) everywhere.

| Category | Projects | Decision |
|---|---|---|
| Canonical product | `Market-Insight-Engine` | Build and ship |
| Algorithm donors | `best-trading-bot`, `trading-desk-copilot` (Python) | Extract selected tests/ideas only, via ADR per extraction |
| Broken comparison copy | `tdc-merge-review` | Archive after inventory |
| UI donor | `trading-desk-copilot2` | Extract visual patterns only |
| Supervised tool | `tradingview-mcp` | Keep, permanently outside strategy truth |
| Future integrations | `tradingview-bridge`, `tradingview-terminal` | Park |
| Prompt/reference material | `stock-market-analysis`, `All GIT HUBS` | Quarantine/archive (contains unsafe prompt corpora — never feed into agents) |
| Other product experiments | Context Engineering OS, `CODEX-STOCKS` | **Freeze outside the launch path.** Preserve remotes untouched. CODEX-STOCKS remote (`4a7f630`) is kept until packet parity is proved; it is not developed as a competing research authority |

Rules:

1. **Nothing is deleted.** "Archive" means preserve it, document its role, and stop developing it
   as a competing product.
2. **Two research authorities never run simultaneously.** With this ADR, Market-Insight-Engine
   absorbs research ownership; CODEX-STOCKS is frozen, not raced.
3. **Donor extraction is one-way and documented** — an ADR in `docs/decisions/` per extraction,
   naming source, commit, and what was taken. Donor code is reimplemented, not merged.
4. **Benchmark control `B0` freezes at `0e0d9e2`** (prompts, committee lenses, schema, fixtures).

## Release gate R0 — prove the smallest complete loop first

No new architecture, agents, streaming systems, or repositories until this fixture-driven loop is
proven end to end:

```
fixture bars → deterministic scanner → CopilotEvent → safety gates
  → analyst committee → Desk UI → manual journal → edge scoreboard
```

Acceptance criteria, with status measured in a clean checkout at `0e0d9e2` (this CI environment,
2026-07-12):

| # | Criterion | Status |
|---|---|---|
| 1 | Clean checkout, clean `git status` | ✅ verified (this environment; workstation checkouts still need recovery) |
| 2 | Full tests and typecheck pass | ✅ verified — 271 tests / 27 files pass (copilot-core 100, committee 71, api-server 55, desk 45); typecheck green; CI backtest green |
| 3 | API health endpoint responds | ✅ verified — server boots without provider keys ("Scan scheduler not started (provider keys missing)"), `/api/healthz` → `{"status":"ok"}` |
| 4 | Fixture scan produces a deterministic event | ⬜ not yet exercised end-to-end |
| 5 | Committee returns real structured output | ◐ unit-verified (deterministic provider path); live provider path needs keys |
| 6 | Replay works without API keys | ◐ fixture-backed REPLAY is designed for this (`.agents/memory/desk-replay-gating.md`); tests pass; manual run pending |
| 7 | Desk renders the complete workflow in the browser | ⬜ needs a browser pass (Playwright) |
| 8 | No mock financial claims appear as real | ◐ `render-safety`/`safety` tests pass; full-sweep audit pending |
| 9 | No internal prompt scaffolding leaks | ◐ guardrail tests pass; full-sweep audit pending |
| 10 | No broker or order execution exists | ✅ verified — no order/broker code paths in the repo |

## Release gate R1 — exactly one research slice

Only after R0 passes, add the smallest slice of the research plan
(`docs/plans/research-layer-buildout.md`), and nothing else:

```
CandidateSeed → Market Research Lead → Catalyst Verifier → Source Guardian
  → verified CandidatePacket → read-only context beside CopilotEvent
```

- Packets are referenced **beside** CopilotEvent — never inside the deterministic trigger/gate
  hash path.
- Deferred until after R1, by decision, not by omission: caching/pre-warming expansion, streaming,
  macro agent, IPO/capital-structure agent, the 12-arm experiment registry, WORM storage,
  Temporal.

## Workstation recovery checklist (outside this environment's reach)

The damaged local checkouts live on the primary workstation and must be recovered there:

1. Fresh clone of `Market-Insight-Engine` from origin; do all new work on branches off `0e0d9e2+`.
2. Do not repair the damaged worktrees in place — preserve them (rename `*-damaged`) until any
   uncommitted work worth keeping has been inventoried, then archive.
3. Inventory each sibling folder against the table above; write the per-folder "what is kept"
   list into this file's follow-up ADR before archiving.
4. Push any surviving local-only branches to origin before archiving anything.
