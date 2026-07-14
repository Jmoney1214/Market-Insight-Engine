# @workspace/mcp-gateway

Read-only [MCP](https://modelcontextprotocol.io) gateway that exposes the Market-Insight desk
API as tools for AI agents (Claude Code, Cursor, Codex). This is the surface that lets an
operator agent pull the Morning Scan, build CopilotEvents, run the committee explain, and read
the journal/scoreboard — without touching server internals or the database.

## Security model (v2)

- **Read-only by design.** No tool can mutate desk state: `POST /analyze`, journal writes, and
  watchlist writes are deliberately not exposed. Mutations stay human-only until per-agent
  tokens/scopes exist (buildout plan §9; QuantDinger's agent-token model is the reference).
  A test (`server.test.ts`) fails if a mutating tool is ever added to the surface.
- **HTTP proxy only.** The gateway calls the running api-server over HTTP; it imports no server
  code and holds no DB credentials.
- **Dedicated service identity required.** Set `MIE_API_CREDENTIAL` to the permanent credential
  issued to the separately approved MCP service principal. Every protected tool fails before
  fetch when it is absent. Only the two health requests are public.
- **No provider or database keys.** Alpaca, FMP, model-provider, and Supabase infrastructure
  keys are never accepted as MCP application identity.
- **Stable idempotency.** Quota-spending/event-generating calls carry a fresh UUID for one MCP
  tool invocation; bearer auth and idempotency are injected only by the gateway transport.
- Two tools spend money and are labeled as such: `get_premarket_scan` with `refresh=true`
  (provider quota) and `explain_event` (LLM budget, ~12s uncached).

## Run

```bash
pnpm --filter @workspace/mcp-gateway run build
MIE_API_BASE=http://127.0.0.1:8080 \
MIE_API_CREDENTIAL='<issued-service-credential>' \
node artifacts/mcp-gateway/dist/index.js
```

## Hook up Claude Code

```bash
claude mcp add market-insight-desk \
  --env MIE_API_BASE=http://127.0.0.1:8080 \
  --env MIE_API_CREDENTIAL='<issued-service-credential>' \
  -- node <repo>/artifacts/mcp-gateway/dist/index.js
```

Then ask things like: "what's on the morning scan?", "build the copilot event for RGTI from
alpaca_live", "explain SOFI and compare with the journal's gap-fade outcomes".

## Tools

| Tool | Desk endpoint | Notes |
|---|---|---|
| `desk_health` | `/healthz` + `/copilot/healthz` | |
| `get_premarket_scan` | `/scan/premarket` | `refresh=true` spends quota |
| `get_scan_scorecard` | `/scan/scorecard` | graded scan outcomes |
| `get_universe_snapshot` | `/scan/universe-snapshot` | by date |
| `get_copilot_event` | `/copilot/event` | live Alpaca SIP only; idempotency required |
| `explain_event` | `/copilot/explain` | committee; ~12s uncached |
| `get_copilot_history` | `/copilot/history` | |
| `get_journal` | `/copilot/journal` | read-only |
| `get_edge_scoreboard` | `/copilot/scoreboard` | |
| `get_validation_state` | `/copilot/validation` | |
| `get_strategy_registry` | `/copilot/strategies` | |
| `get_replay_session` / `get_replay_event` | `/copilot/replay/*` | exact case revision + evidence hash required |
| `list_reports` / `get_report` | `/reports` | persisted non-mock reports only |
| `get_watchlist` | `/watchlist` | read-only |
