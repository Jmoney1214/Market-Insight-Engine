---
name: FinDesk data sourcing & report typing
description: How FinDesk analyze reports get real data, plus a zod-version typing gotcha
---

# FinDesk report data sourcing

The `/api/analyze` flow builds reports from **live market data + AI**, not mocks.

- **Market data is keyless** via Yahoo Finance v8 chart endpoint:
  `https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=1y&interval=1d`.
  It returns regularMarketPrice, the daily close array (for RSI14 / MA50 / MA200 /
  support / resistance / golden cross / trend), 52w high/low, longName, exchange.
  **Why:** the v7 quote endpoint returns Unauthorized without a key, and Stooq failed.
  **How to apply:** compute technicals from the close array; don't reach for a paid quote API.

- **AI analysis** uses the OpenAI integration (Replit AI Integrations proxy,
  `AI_INTEGRATIONS_OPENAI_*` env) via the `lib/integrations-openai-ai-server`
  template, chat.completions with `json_object` response format, zod-validated
  output + one retry.

- **Honest placeholder flags:** news and filings keep `isPlaceholder: true`
  (AI writes illustrative content, shown with the existing "Integration pending"
  badge) because they are not live-sourced. financials / valuation / technical
  use `isPlaceholder: false` (real or AI-grounded in live numbers).
  `overallRating` is kept equal to `actionPlan.rating`.
  **Why:** never present non-live content as sourced; no silent mock fallback —
  analyze returns real status codes (e.g. 404 for an unknown ticker).

## Typing gotcha: report shape

Type the built report with the generated **`Report` TS interface** from
`@workspace/api-zod` (`import { GetReportResponse, type Report } from "@workspace/api-zod"`),
and use `GetReportResponse.parse(...)` only for runtime validation.

**Why:** `z.infer<typeof GetReportResponse>` using `zod/v4`'s `z` namespace
resolves to `unknown` (the api-zod package was built against a different zod
instance), which silently breaks `.companyName` / `.overallRating` field access.
