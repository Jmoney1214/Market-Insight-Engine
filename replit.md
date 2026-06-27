# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Live market data (optional; falls back to mock per-section when absent):
  - `FMP_API_KEY` — Financial Modeling Prep (fundamentals, financials, valuation, analyst targets, news)
  - `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY` — Alpaca market data (real-time price + technicals)
  - `ALPACA_FEED` — `sip` (default, paid consolidated) or `iex` (free)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- `/analyze` builds reports via `artifacts/api-server/src/lib/buildReport.ts`, which fuses live data from FMP (`lib/providers/fmp.ts`) and Alpaca SIP (`lib/providers/alpaca.ts`) into the exact shape produced by `mockData.ts`.
- Graceful degradation is per-section: missing/failed provider → that section falls back to mock and its `isPlaceholder` flag reflects whether the data is real. With no keys at all, the app returns a full mock report.
- Price prefers Alpaca SIP real-time trade; technicals (RSI/SMA/support/resistance/golden cross) are computed locally in `lib/providers/indicators.ts` from Alpaca daily bars. Fundamentals, valuation, analyst targets, and news come from FMP's `stable` API.
- Provider API keys are read from env only (`lib/providers/config.ts`) — never committed.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
