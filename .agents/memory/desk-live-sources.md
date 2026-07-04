---
name: Desk copilot live sources
description: Copilot data-source options (fixture / yahoo_delayed / alpaca_live) and the hermetic-test gotcha now that real provider keys exist in the dev env
---

- Copilot sources: `fixture` (keyless, deterministic), `yahoo_delayed` (keyless, delayed), `alpaca_live` (key-gated, real-time with real bid/ask so the spread gate is meaningful).
- **Rule:** the Alpaca adapter may only ever touch `data.alpaca.markets` (market data). The trading host `api.alpaca.markets` is a forbidden string enforced by the safety scan — permanent no-trading constraint.
- **Rule:** the ALPACA_FEED default must stay `sip` and be read from the shared provider config module, not re-defaulted locally.
  **Why:** FinDesk and the desk copilot share a data-rules invariant (SIP, split-adjusted, RTH) — a locally different default would make the two surfaces silently disagree on the same bars if the env var is ever unset.
- Alpaca bars need explicit RTH session slicing (09:30–16:00 ET via Intl with America/New_York, keep only the latest session's date) to mirror Yahoo's `range=1d` behavior; a multi-day lookback covers weekends/holidays.
- **Gotcha:** real ALPACA_*/FMP_API_KEY secrets now exist in the dev environment — any test asserting "no provider keys" behavior must blank the env vars BEFORE importing the module under test (provider config reads env at import time). This silently broke a previously green test the day the user added their keys.
- Earnings-time chain: FMP calendar (when keyed; stable URL then legacy v3) → keyless Nasdaq earnings-surprise → Yahoo crumb fallback. Every stage best-effort/null.
