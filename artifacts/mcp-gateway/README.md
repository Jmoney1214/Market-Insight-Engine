# @workspace/mcp-gateway

Read-only [MCP](https://modelcontextprotocol.io) gateway that exposes the Market-Insight desk
API as tools for AI agents (Claude Code, Cursor, Codex). This is the surface that lets an
operator agent pull the Morning Scan, build CopilotEvents, run the committee explain, and read
the journal/scoreboard — without touching server internals or the database.

## Security model (v1)

- **Read-only by design.** No tool can mutate desk state: `POST /analyze`, journal writes, and
  watchlist writes are deliberately not exposed. Mutations stay human-only until per-agent
  tokens/scopes exist (buildout plan §9; QuantDinger's agent-token model is the reference).
  A test (`server.test.ts`) fails if a mutating tool is ever added to the surface.
- **HTTP proxy only.** The gateway calls the running api-server over HTTP; it imports no server
  code and holds no DB credentials.
- **Token pass-through ready.** Set `MIE_API_TOKEN` to forward a bearer token once the API
  enforces auth.
- Two tools spend money and are labeled as such: `get_premarket_scan` with `refresh=true`
  (provider quota) and `explain_event` (LLM budget, ~12s uncached).

## Run

```bash
pnpm --filter @workspace/mcp-gateway run build
MIE_API_BASE=http://127.0.0.1:8080 node artifacts/mcp-gateway/dist/index.js
```

## Hook up Claude Code

```bash
claude mcp add market-insight-desk \
  --env MIE_API_BASE=http://127.0.0.1:8080 \
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
| `get_copilot_event` | `/copilot/event` | `source=fixture` works keyless |
| `explain_event` | `/copilot/explain` | committee; ~12s uncached |
| `get_copilot_history` | `/copilot/history` | |
| `get_journal` | `/copilot/journal` | read-only |
| `get_edge_scoreboard` | `/copilot/scoreboard` | |
| `get_validation_state` | `/copilot/validation` | |
| `get_strategy_registry` | `/copilot/strategies` | |
| `get_replay_session` / `get_replay_event` | `/replay/*` | keyless fixtures |
| `list_reports` / `get_report` | `/reports` | placeholder caveat until mock isolation ships |
| `get_watchlist` | `/watchlist` | read-only |
