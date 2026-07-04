# FinDesk — Build & Data-Pipeline Architecture

Design for taking FinDesk from "live report on demand" to a **market-data
platform**: maxing the paid FMP Premium (750 calls/min) and Alpaca SIP
subscriptions, serving a live dashboard, and exposing a clean API that any
number of research agents can consume without burning quota.

Not investment advice; FinDesk is a research/display tool, not an execution
system. The quant-research backtest engine is a separate, independent project
with its own Alpaca access (see the data-rules invariant in `replit.md`).

---

## 1. Big picture

```
                       ┌──────────────────────────── api-server ────────────────────────────┐
  FMP Premium (REST)   │                                                                    │
  ───────────────────► │  Provider clients ──► Rate limiter ──► Normalizer (Zod) ──► CACHE  │
  Alpaca SIP (REST)    │   fmp.ts / alpaca.ts   (token bucket)    (api-zod types)   L1 mem  │
  ───────────────────► │                                                          L2 Postgres│
  Alpaca SIP (WS)      │        │                                                     │     │
  ═══════════════════► │  Streamer (trades/quotes/bars) ──► fan-out ──► SSE /stream   │     │
                       │        │                                                     │     │
                       │  Pre-warmer (watchlist refresh loop)◄────────────────────────┘     │
                       │                                                                    │
                       │  ┌──────────── consumers of the same cached service ────────────┐  │
                       │  │  /analyze (report assembler)   │   /api/v1/* (agent API)     │  │
                       │  └────────────────────────────────┴─────────────────────────────┘  │
                       └────────────────────────────────────────────────────────────────────┘
                                   │                                    │
                             findesk web app                    research agents
                          (dashboard + TV widgets)           (typed REST consumers)
```

Principles:

1. **One data plane.** The report assembler, the dashboard, and every research
   agent read from the same cached market-data service. Nothing calls a vendor
   directly except the provider clients.
2. **Contract-first.** Every new endpoint is added to `lib/api-spec/openapi.yaml`
   first; orval codegen produces the Zod schemas and typed React/agent clients.
3. **Quota is a budget, not a wall.** The rate limiter + cache turn 750/min into
   effectively unlimited reads for hot symbols; the budget is spent on cache
   misses and pre-warming only.
4. **Per-section graceful degradation** stays: any vendor failure downgrades one
   section, never the whole response.

---

## 2. Package layout (target)

```
lib/
  market-data/            # NEW workspace lib — the data plane (framework-free)
    src/
      providers/fmp.ts        # moved from api-server, unchanged interfaces
      providers/alpaca.ts
      providers/config.ts
      indicators.ts
      cache.ts                # two-tier cache (L1 LRU memory, L2 Postgres)
      rateLimiter.ts          # token bucket per provider
      service.ts              # public facade: getQuote/getBars/getFundamentals/…
      stream.ts               # Alpaca WS consumer + subscriber registry
  api-spec/                # OpenAPI source of truth (+ /api/v1 agent surface)
  api-zod/ api-client-react/  # generated
  db/                      # + market_cache table, watchlist reused as warm-list
artifacts/
  api-server/              # routes only: /analyze, /reports, /watchlist, /api/v1/*, /stream
  findesk/                 # dashboard consumes /api/v1 + SSE + TV widgets
```

Why a lib: the data plane gets reusable from scripts and future artifacts, and
`api-server` shrinks to route handlers. (Migration is mechanical — move files,
fix imports; the quant-research engine does NOT import this lib, by design.)

---

## 3. The pipeline, stage by stage

### 3.1 Provider clients (exists)
Thin, null-safe fetchers. Every response is validated/coerced at the edge;
`Error Message` payloads, 402s, and timeouts return `null` upward.

### 3.2 Rate limiter (new)
Token bucket per provider: FMP 700/min (headroom under 750), Alpaca 9k/min.
Calls queue when the bucket is dry rather than erroring. A `priority` flag lets
interactive requests (user clicked Analyze) jump ahead of pre-warm traffic.

### 3.3 Two-tier cache (new — the core of "max potential")

| Data class | TTL | Rationale |
|---|---|---|
| Real-time quote/snapshot | 30 s | dashboard freshness without hammering |
| Intraday bars (1–15 min) | 2 min | streaming covers the gap |
| Daily bars / technicals | 1 h (24 h after close) | recompute cheap, data static |
| News | 5 min | headline cadence |
| Ratios/TTM metrics, profile | 24 h | changes daily at most |
| Statements, balance/cash-flow | 7 d | changes quarterly |
| Earnings/dividend calendar | 12 h | slow-moving |
| Insider/13F | 24 h | filing cadence |

- **L1**: in-process LRU (fast path, per autoscale instance).
- **L2**: Postgres `market_cache(key, payload jsonb, fetched_at, ttl)` — shared
  across autoscale instances, survives restarts, and doubles as an audit trail.
- Read path: L1 → L2 → rate-limited fetch → write both. Stale-while-revalidate:
  serve stale up to 2× TTL while a background refresh runs, so agents never wait.

Effect: a warm symbol costs **0 vendor calls** per report/agent query; 13 calls
per `/analyze` becomes 13 per symbol per TTL window, shared by every consumer.

### 3.4 Batcher (new)
Watchlist/dashboard reads use batch endpoints — FMP `batch-quote`, Alpaca
multi-symbol snapshot (`?symbols=A,B,C`) — one call for N symbols. The service
facade coalesces concurrent single-symbol requests into one batch (10 ms window).

### 3.5 Pre-warmer (new)
A background loop keeps the **watchlist + recently-analyzed symbols** warm:
refresh quotes each 30 s (one batch call), fundamentals daily after market
close. Runs at `priority: low` through the same rate limiter, so it can never
starve interactive traffic.

### 3.6 Streamer (new)
One Alpaca WebSocket connection (`wss://stream.data.alpaca.markets/v2/sip`)
subscribed to trades/bars for watchlist symbols. Fan-out to browsers via
**SSE** (`GET /api/v1/stream?symbols=…`) — SSE over HTTP works with Express 5
and autoscale routing with no extra infra. The dashboard upgrades from
"price at analyze-time" to live ticks.

> Deployment note: Replit **autoscale** can scale to zero / run multiple
> instances. The WS consumer + pre-warmer should run in a single always-on
> process — either pin the deployment to a reserved VM, or accept
> stream-on-first-subscriber semantics on autoscale (connect WS lazily when the
> first SSE client attaches, drop when idle). Phase 1 ships the lazy variant;
> no infra change required.

---

## 4. Agent API surface (`/api/v1`) — the "tied to all research agents" part

All contract-first in `openapi.yaml`; all served from the cached data plane.
Read-only, JSON, typed clients generated for TS (and trivially callable from
Python agents).

| Endpoint | Backing data | Notes |
|---|---|---|
| `GET /api/v1/quote/{symbol}` | Alpaca snapshot (cache 30 s) | price, change, day range |
| `GET /api/v1/quotes?symbols=` | batch snapshot | watchlist/dashboard |
| `GET /api/v1/bars/{symbol}?tf=1D&limit=` | Alpaca SIP bars | daily + intraday |
| `GET /api/v1/technicals/{symbol}` | computed from bars | RSI/SMA/levels (shared code with report) |
| `GET /api/v1/fundamentals/{symbol}` | FMP statements/ratios/BS/CF | the `Fundamentals` block, standalone |
| `GET /api/v1/analyst/{symbol}` | FMP targets/grades/estimates | consensus + distribution |
| `GET /api/v1/news/{symbol}` | Alpaca news | decoded headlines |
| `GET /api/v1/calendar/earnings?from=&to=` | FMP earnings calendar | powers real Catalysts |
| `GET /api/v1/filings/{symbol}` | FMP SEC filings | powers real Filings section |
| `GET /api/v1/insiders/{symbol}` | FMP insider trades / 13F | "Smart Money" |
| `GET /api/v1/screener?…` | FMP screener passthrough (cached) | discovery for agents |
| `GET /api/v1/market/movers` | Alpaca most-actives + FMP sector perf | market overview |
| `GET /api/v1/stream?symbols=` | SSE from Alpaca WS | live ticks |

Auth: same-origin for the web app; agents get a simple bearer token
(`AGENT_API_TOKEN` env) checked by middleware — enough for a private
deployment, replaceable later.

The existing `/analyze` report becomes a *composition* of these services — same
data, zero duplicate fetching.

---

## 5. Report upgrades unlocked (kill the last mocks)

| Section | Today | Becomes |
|---|---|---|
| Catalysts | canned text | real next earnings date + last surprise + recent upgrades/downgrades |
| Filings | mock | latest 10-K/10-Q dates + links from FMP SEC filings |
| Snapshot | live | + dividend yield, next ex-div date |
| NEW: Smart Money | — | insider net buys (90 d), top institutional holders |
| NEW: Market context | — | sector performance, movers strip on home page |

`isPlaceholder` flags disappear section by section; the mock generator remains
only as the no-keys fallback.

---

## 6. Build phases (each = one reviewable commit series on the PR)

**Phase 1 — data plane (foundation)**
1. `lib/market-data` package; move providers; add `rateLimiter.ts`, `cache.ts`
   (L1+L2, `market_cache` table via Drizzle), `service.ts` facade; batcher.
2. Point `/analyze` at the facade. Behavior identical, calls now cached.
3. Vitest + unit tests for cache TTL/SWR, token bucket, indicators. First tests in repo; root `pnpm test`.

**Phase 2 — kill the mocks + agent API v1**
4. Earnings calendar + upgrades/downgrades → real Catalysts; SEC filings → real Filings.
5. `/api/v1` endpoints (quote/quotes/bars/technicals/fundamentals/analyst/news/calendar/filings) with bearer auth + OpenAPI + codegen.

**Phase 3 — live + discovery**
6. Alpaca WS streamer + SSE `/stream`; dashboard live prices + movers strip.
7. Screener, insiders/13F ("Smart Money"), market overview page.
8. Pre-warmer loop for watchlist symbols.

Ordering rationale: caching first (everything else multiplies through it),
contract/API second (agents unblock), streaming/discovery last (UX polish).

---

## 7. Budget math (why this maxes the plans)

- `/analyze` cold: ~13 FMP + 3 Alpaca calls. Warm: **0**.
- 100-symbol watchlist pre-warm: 1 batch quote call/30 s (Alpaca) ≈ 2 calls/min;
  fundamentals refresh ≈ 100 calls/day spread overnight.
- Agents: unlimited reads on warm symbols; a cold long-tail symbol costs one
  13-call burst — the 750/min budget supports ~55 *cold* symbols per minute,
  and the limiter queues gracefully past that.
- Streaming: 1 WS connection regardless of dashboard viewers (SSE fan-out).
```
