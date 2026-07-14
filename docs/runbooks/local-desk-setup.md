# Local Desk Setup (macOS) — battle-tested 2026-07-12

Running the Market-Insight desk + MCP gateway on a Mac, exactly as debugged live.
Every pitfall below was actually hit; don't skip the notes.

## 0. Prerequisites

- **Node 24** (Homebrew `node@20` will fail — corepack's pnpm throws
  `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` on Node 20):

  ```bash
  brew install node@24
  brew unlink node@20   # if an older node is linked
  echo 'export PATH="/opt/homebrew/opt/node@24/bin:$PATH"' >> ~/.zshrc
  export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
  node -v               # must print v24.x before continuing
  ```

- **pnpm 10** (not 11 — and don't let corepack pick):

  ```bash
  corepack enable 2>/dev/null; corepack prepare pnpm@10 --activate 2>/dev/null || npm i -g pnpm@10
  ```

## 1. Clone and install

```bash
mkdir -p ~/Projects && cd ~/Projects
git clone https://github.com/Jmoney1214/Market-Insight-Engine.git
cd Market-Insight-Engine
pnpm install
```

pnpm v10 blocks dependency build scripts by default and warns about
`@google/genai, esbuild, protobufjs`. The esbuild bundle usually works anyway;
if `node ./build.mjs` complains about esbuild, run `pnpm approve-builds`
(press `a`, Enter, `y`) and `pnpm rebuild`.

## 2. Environment (`.env` in the repo root)

Variable names the server actually reads (`providers/config.ts`, `lib/db`):

```
FMP_API_KEY=            # FMP dashboard
ALPACA_API_KEY_ID=      # Alpaca dashboard (PK… = paper key; live key for live-account entitlement)
ALPACA_API_SECRET_KEY=
ALPACA_FEED=sip
DATABASE_URL=postgresql://postgres.<project-ref>:<DB_PASSWORD>@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

- `DATABASE_URL` uses the **Supabase session pooler** string (IPv4-safe). The DB
  password lives in Supabase → Settings → Database.
- **Percent-encode special characters in the password** (`$` → `%24`, `@` → `%40`,
  `#` → `%23`). Unencoded `$` gets eaten by the shell or the URL parser.
- Values live ONLY in `.env` (gitignored) and the Replit/production Secrets panel.
  Never commit them; never paste them into chats or issues.

Optional (agent identity):

```
AGENT_TOKENS=           # "desk-claude:<random>,codex:<random>" — names agents in the audit log
REQUIRE_AGENT_TOKEN=    # leave unset. 'true' rejects anonymous API calls — breaks browser UIs until they carry a credential
```

Give the gateway its identity by adding `--env MIE_API_TOKEN=<random>` (the same
token listed in `AGENT_TOKENS`) to the `claude mcp add` command.

Alerting is handled through TradingView (native app-push/email alerts), driven
by the supervised `tradingview-mcp` on the operator's machine — the desk server
sends no notifications itself.

## 3. Run the desk (Terminal A)

```bash
cd ~/Projects/Market-Insight-Engine
set -a; source .env; set +a
export PORT=8080
pnpm --filter @workspace/api-server run dev
```

Success = `Server listening port: 8080` **plus**
`Scan scheduler started (weekdays: refresh 07:00-16:00 ET, record 08:15-09:30, grade after close)`.
If you instead see `Scan scheduler not started (provider keys missing)`, the
`.env` didn't load — re-run the `set -a; source .env; set +a` line and restart.

Verify:

```bash
curl -s http://127.0.0.1:8080/api/healthz     # {"status":"ok"}
curl -s http://127.0.0.1:8080/api/reports | head -c 300
```

A 500 mentioning a missing `source` column means the DB schema is behind the
code — the provenance column migration must be applied (it exists in the
Supabase migration history as `add_reports_source_provenance_column`).

## 4. MCP gateway (Terminal B) — agents operating the desk

```bash
pnpm --filter @workspace/mcp-gateway run build

claude mcp add market-insight-desk \
  --env MIE_API_BASE=http://127.0.0.1:8080 \
  -- node "$HOME/Projects/Market-Insight-Engine/artifacts/mcp-gateway/dist/index.js"

claude mcp list   # expect: market-insight-desk … ✔ Connected
```

Smoke test in a fresh `claude` session:

> use market-insight-desk: check desk health, then build the copilot event for
> AAPL from fixture source

Fixture mode needs no keys. With keys, use `source alpaca_live` and
`get_premarket_scan` for the live chain. See `artifacts/mcp-gateway/README.md`
for the full tool list and the read-only security model.

## 5. Known good state

Weekends: `alpaca_live` builds from Friday's data and may raise quote-age /
market-quality flags — that is the pipeline being correct, not broken. The
scan board fills weekdays 08:15–09:30 ET and grades after the close.
