# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run test` — run unit tests (Vitest; indicators, scorecard grading, report fallback)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
  - Hosted DB: dedicated Supabase project `findesk` (ref `ganihlwaijdxpigssyab`, us-east-1, free tier). Schema already applied (reports, watchlist, scan_scorecard) with RLS enabled/no policies so tables are NOT reachable via Supabase's public REST API — the app connects via direct Postgres only. Use the session-pooler connection string (IPv4-safe): `postgresql://postgres.ganihlwaijdxpigssyab:<DB_PASSWORD>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`. The DB password is set/reset in the Supabase dashboard (Settings → Database) — never committed.
- Market data (paid plans; Alpaca is the primary server-side spine):
  - `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY` — Alpaca market data (real-time price, daily bars → technicals, news). **Primary source.**
  - `ALPACA_FEED` — `sip` (default, paid consolidated) or `iex`.
  - `FMP_API_KEY` — **optional** enrichment for server-computed fundamentals/valuation/analyst targets. Not required; the free tier hits quota (402) walls, so it is off by default and the app degrades gracefully without it.
  - TradingView needs no key — charts, technicals, and fundamentals are rendered as embedded TradingView widgets client-side (no server data API exists for TradingView).

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
- **Fundamentals data layer:** when a (paid-tier) `FMP_API_KEY` is set, the report carries a `fundamentals` block (OpenAPI `Fundamentals` schema) — balance sheet, cash flow, analyst-ratings consensus/breakdown, and estimates — for dashboard cards and research agents. Fetchers live in `lib/providers/fmp.ts`; assembled in `buildReport.ts`; rendered by `components/report/fundamentals-section.tsx`. Each field degrades to `null` per-endpoint (e.g. analyst estimates need a higher FMP tier), so the block never breaks the report.
- **Data source split:** Alpaca (paid SIP) is the required server-side spine for price/technicals/news. TradingView supplies charts/technicals/fundamentals as client-side embed widgets (`artifacts/findesk/src/components/tradingview.tsx`) — it has no server data API. FMP is optional enrichment only.
- **Shared data-rules invariant:** FinDesk and the separate `quant-research` backtest engine both follow identical rules — **SIP feed, split-adjusted, RTH, labels-unverified** — so their numbers on the same bars must agree ("engine vs FinDesk agree" is a standing cross-check). The two are decoupled: the research engine has its own direct, offline-cacheable Alpaca access and must never depend on FinDesk; FinDesk serves the live/agent ecosystem.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After pulling schema changes (e.g. the `scan_scorecard` table), run `pnpm --filter @workspace/db run push` before starting the server — the scorecard writes fail (non-fatally, logged) until the table exists.
- The scan scheduler (refresh 07:00–16:00 ET, record picks 08:15–09:30, grade after 16:15) runs inside the api-server process. On autoscale it only runs while an instance is alive; use a reserved VM for guaranteed pre-open scans.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
