# Universe Service — Design Spec

**Date:** 2026-07-17
**Sub-project:** 1 of 12 (Opportunity Engine program — see the target-architecture memory)
**Status:** design, pending user review → implementation plan

---

## Overview

The **Universe Service** is the foundation layer of the dual-door opportunity engine. It maintains one authoritative `symbols` master: the set of instruments the engine is **allowed to scan**, plus the metadata every downstream engine reads. It is a deterministic service — no LLM (per the architecture rule: deterministic services do the market math; LLMs only interpret unstructured information).

It answers exactly one question: *"Is this instrument eligible to trade, and what do I need to know about it?"* It does **not** score, discover, rank, or gate on liquidity — those are separate sub-projects.

This replaces the current fused screener (`fmp.getScreenerUniverse`, `scan.ts:189`), which incorrectly bakes liquidity (`volume>2M`) and size (`marketCap>500M`) into the universe — coupling "allowed to scan" with "tradeable today," which the architecture separates onto distinct axes.

## Purpose & fit

- **Consumers:** the Movement Detector (Door A), the Event Engine (Door B), the Tradeability Engine, and the ranking layer all read the eligible set + metadata from this service.
- **Tuned to the operator's edge:** the operator is a retail momentum scalper on **low-float sub-$10 (down to sub-$1) NASDAQ/AMEX runners** — the day's biggest % gainers, news pops and squeezes. The universe stays broad-eligible; the metadata is chosen so the *movement door + ranking* can hunt low-float runners one layer down. **Float is first-class metadata.**

## Scope

**In scope:**
- The `symbols` master table (eligibility + metadata).
- The deterministic eligibility gate.
- The metadata-sourcing pipeline (Alpaca assets + FMP + SEC EDGAR).
- Two refresh jobs: nightly full rebuild + pre-open daily refresh.
- The read interface consumed by downstream engines.

**Out of scope (other sub-projects):**
- Liquidity/spread/depth gating → Tradeability Engine (sub-project 6).
- Movement/runner scoring and ranking → Movement Detector (sub-project 3).
- Live halt / SSR-trigger state → real-time Market-Data Plane (sub-project 2).
- Any strategy, entry/exit, or risk logic.

## Locked design decisions

| Decision | Value | Rationale |
|---|---|---|
| Responsibility | Pure structural eligibility; liquidity/size/float are **metadata only** | Tradeability is a separate axis |
| Price band | **$1 – $50** (floor $1, ceiling $50) | Operator narrowed from $150; $1 floor avoids sub-$1 traps (no-margin, manipulation, delist risk) |
| Exchanges | **NYSE, NASDAQ, NYSE American (AMEX)** | Operator's actual runners (STIM, ELVA, BIYA…) list on NASDAQ/AMEX; dropping AMEX would silently lose them |
| Security type | US **common stock** only; **include dual-class** (BRK.B); exclude ETF/fund/warrant/unit/preferred/ADR-issue | The old `^[A-Z]{1,5}$` regex is wrong — it drops dual-class and keeps preferreds |
| Float | **First-class**, bucketed: NANO <5M · LOW 5–20M · MID 20–75M · HIGH >75M; `low_float` bool (<20M) | Low/nano float is the operator's squeeze edge |
| Hard-to-borrow | Surfaced as a **squeeze signal** (trapped shorts) as well as a short-side locate constraint | `easy_to_borrow=false` on a low-float name is bullish-squeeze fuel |
| Offering/dilution | `dilution_risk` (NONE/LOW/HIGH) as a **risk flag**, never an eligibility kill | A fresh ATM/shelf both creates the move and can crush the squeeze — risk engine weights it |
| Recent IPO | `is_recent_ipo` (IPO ≤ 90 days) | A category of runners the operator trades; flags thin history downstream |
| Cadence | Nightly full rebuild (~6–8 PM ET, EOD-settled) + pre-open (~7 AM ET) daily-field refresh | Universe is the slow clock; real-time doors own intraday |

## Architecture & components

### 1. `symbols` table (new)

Keep the existing `universe_snapshot` table as the thin point-in-time record it already is (survivorship-safe backtests). Add a `symbols` master:

| Group | Columns |
|---|---|
| Identity | `symbol` (pk), `name`, `exchange`, `security_type` |
| Eligibility | `eligible` (bool), `ineligible_reason`, `first_seen`, `delisted_at` |
| Price | `last_price`, `prev_close` |
| Float (first-class) | `float_shares`, `shares_outstanding`, `float_pct`, `float_bucket` (NANO/LOW/MID/HIGH), `low_float` (bool) |
| Liquidity (metadata) | `avg_volume`, `avg_dollar_volume`, `market_cap` |
| Broker/tradability | `tradable`, `shortable`, `easy_to_borrow`, `marginable`, `fractionable` |
| Risk flags | `ssr_flag`, `dilution_risk` (NONE/LOW/HIGH), `recent_offering`, `recent_split`, `is_recent_ipo`, `ipo_date`, `earnings_date` |
| Classification | `sector`, `industry`, `sympathy_tickers` (text[]) |
| Freshness | `last_full_refresh`, `last_daily_refresh`, `stale_since`, `metadata_incomplete` (bool) |

### 2. Eligibility gate (deterministic, ordered — first failure wins the reason)

1. **Broker asset check** (Alpaca `/v2/assets`): `status=active` AND `tradable=true` AND `class=us_equity` AND `exchange ∈ {NYSE, NASDAQ, AMEX}` → else `ineligible_reason = NOT_BROKER_TRADABLE`.
2. **Security type** = common stock (dual-class allowed): exclude ETF/fund/warrant/unit/preferred/ADR-issue → else `NON_COMMON`.
3. **Price band**: `$1 ≤ last_price ≤ $50` → else `OUT_OF_BAND`.
4. **Quote freshness**: a usable recent quote exists → else `STALE_QUOTE`.

A symbol is `eligible=true` only if all four pass. Fail-closed: inability to confirm any gate = ineligible.

### 3. Security-type classifier

The gate's step 2 is a dedicated deterministic function, because no single provider gives a clean "is common stock" flag:
- Primary: FMP `getProfile` flags (`isEtf`, `isFund`, `isAdr`).
- Secondary: symbol-suffix heuristics for warrants/units/preferred (e.g. `W`/`.WS` warrant, `U`/`.U` unit, `-P`/`PR` preferred per exchange convention) — exclude.
- Dual-class common (BRK.B, GOOG/GOOGL) is **included**.
Returns `security_type` + a common/non-common verdict.

### 4. Alpaca assets client (new)

A small new client against the **trading API host** (`api.alpaca.markets`) — distinct from the market-data host (`data.alpaca.markets`) the existing provider already calls. Reuses the existing `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY`. Returns the asset list with `tradable`, `shortable`, `easy_to_borrow`, `marginable`, `fractionable`, `exchange`, `status`, `class`, and attributes (incl. `ipo`). Cached; refreshed on the schedule below.

### 5. Metadata-sourcing map

| Field(s) | Source | Refresh tier |
|---|---|---|
| eligibility, tradable/shortable/ETB/marginable/fractionable, exchange, ipo flag | Alpaca `/v2/assets` | daily |
| float_shares, shares_outstanding, market_cap, sector, industry, ADR/ETF flags | FMP `getProfile` | nightly |
| sympathy_tickers | FMP `getPeers` | nightly |
| earnings_date | FMP earnings-calendar | daily |
| dilution_risk, recent_offering, recent_split | SEC EDGAR (8-K / 424B / S-* / splits) | nightly |
| last_price, prev_close, avg_volume, avg_dollar_volume | Alpaca snapshot / daily bars | daily (pre-open) |

### 6. Refresh jobs

- **Nightly full rebuild (~6–8 PM ET):** pull the full asset list → classify security type → fetch fundamentals (float/shares/mktcap/sector) → compute float buckets → pull EDGAR corp-action flags → recompute eligibility → upsert `symbols` + write the daily `universe_snapshot`.
- **Pre-open daily refresh (~7 AM ET):** refresh daily-mutable fields (shortable/ETB, price/prev-close, earnings, SSR reset) → re-evaluate eligibility for names that crossed the price band overnight. Live halt/SSR-trigger is **not** here — that's the real-time layer.

## Data flow

```
Nightly:  Alpaca assets ─┐
          FMP profile  ──┼─► classify ─► compute buckets ─► eligibility gate ─► upsert symbols
          FMP peers    ──┤                                                       └─► universe_snapshot (PIT)
          EDGAR flags  ──┘
Pre-open: Alpaca assets (shortable/ETB) + snapshot (price) + FMP earnings ─► refresh daily fields ─► re-gate band-crossers
Read:     getEligibleUniverse() / getSymbolMeta(sym) / isEligible(sym)  ◄─── Door A, Door B, Tradeability, Ranking
```

## Interface

- `getEligibleUniverse(): SymbolMeta[]` — all `eligible=true` rows with metadata.
- `getSymbolMeta(symbol): SymbolMeta | null` — one symbol's full record.
- `isEligible(symbol): { eligible: boolean; reason: string | null }`.

## Error handling (fail-closed + degrade)

- **No broker asset match** → `eligible=false`, reason `NOT_BROKER_TRADABLE`. Cannot confirm tradable = out.
- **Missing FMP metadata** (profile/peers unavailable) → leave those fields null, set `metadata_incomplete=true`; eligibility can still hold if the gate passed on broker + price + type. Float-dependent downstream logic must treat null float as "unknown," never "zero."
- **Provider outage during a refresh** → keep the last-good `symbols` rows, stamp `stale_since`; **never wipe or empty the universe on a fetch failure.** A downstream reader can see staleness and degrade.
- **EDGAR unavailable** → dilution/offering flags default to `UNKNOWN`/false with `metadata_incomplete=true` (never fabricate a clean bill of health).

## Testing strategy

Deterministic — fixture asset lists + fixture profiles → assert the exact eligible set and reasons:
- Dual-class (BRK.B) → **included**, `security_type=common`.
- Warrant / unit / preferred / ETF fixtures → **excluded** with `NON_COMMON`.
- Price $0.90 and $60 → **excluded** `OUT_OF_BAND`; $1.00 and $50.00 → included (inclusive bounds).
- `tradable=false` asset → **excluded** `NOT_BROKER_TRADABLE`.
- An AMEX (NYSE American) runner fixture → **included**.
- Float 3M → `float_bucket=NANO`, `low_float=true`; 40M → `MID`, `low_float=false`.
- `easy_to_borrow=false` low-float name → retained + flagged (squeeze signal).
- Active ATM offering fixture → `dilution_risk=HIGH`, still `eligible=true`.
- FMP outage fixture → row retained, `metadata_incomplete=true`, float null (not 0).
- Provider outage on refresh → prior rows retained, `stale_since` stamped.

## Notes for downstream sub-projects (not built here)

The metadata this service exposes is chosen to feed the operator's playbook later: `float_bucket`/`low_float` and `easy_to_borrow` for the Movement door's runner ranking; `dilution_risk`/`is_recent_ipo`/`ssr_flag` for the Risk engine; and the eventual setup engines encode the VWAP/EMA9, never-chase, stops-must-execute rules. None of that logic lives in the Universe Service.
