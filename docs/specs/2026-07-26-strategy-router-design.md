# Strategy Router — Design Spec v0.1

**Date:** 2026-07-26  ·  **Status:** approved, Phase 1 building

## Goal
A morning command that measures each ticker's **character** and routes it to the strategy
that fits — **the WHY (measurable character) picks the strategy** — gated by validation status.
Real orders only from lanes that survived a holdout test.

## Approach
Reuse `tools/research/` infra (cached SIP fetch, DB, holdout harness) rather than a standalone script.

## Location — `tools/router/`
| File | Job |
|---|---|
| `config.mjs` | 87-name universe · thresholds · `LANES` table (code, pine file, status) |
| `classify.mjs` | indicators + metric pack + routing tree (look-ahead safe) |
| `store.mjs` | JSON writer (+ Supabase sink in Phase 2) |
| `scan.mjs` | CLI entry: fetch → classify → store → print |

**Reuses:** `data.mjs` (`alpacaBars`, `fmpEarnings`, `stampMetadata`), `lib/db` (Phase 2), `class_backtest.mjs` (promotes PAPER→LIVE).

## Data sources (all Alpaca SIP + FMP, keys in `.env`)
| Signal | Source | Call |
|---|---|---|
| Donchian20 · EMA50/200+slope · ADX14 · ATR14 · Mom3M · %52wHigh · $vol | Alpaca SIP daily | `alpacaBars(syms,'1Day',…)` |
| gap% · price (Phase 3) | Alpaca SIP snapshots | new `snapshots()` |
| RVOL premarket (Phase 3) | Alpaca SIP 1-min ext-hrs | new `premarketVol()` |
| earnings catalyst (Phase 3) | FMP | `fmpEarnings(today,today)` |

## Lanes (character → strategy → status)
| Code | Lane | Character | Pine file | Status |
|---|---|---|---|---|
| 1 | TrendRider | uptrend, breaking/near 20d high, ADX≥25 | `Trend_Rider.pine` | **LIVE** (holdout-validated) |
| 2 | MeanRev | range-bound, ADX<20, hugs MA | `morning_scan_largecap_scalper.pine` | PAPER |
| 3 | Momentum | gap≥3% + RVOL≥1.5 (premarket) | ORB / `morning_scan_strategy.pine` | PAPER |
| 4 | JumpDay | overnight move ≥5% | `morning_scan_jumpday_long.pine` | PAPER |
| 0 | Cash | no edge | — | — |

**Gate:** real orders only from LIVE lanes (TrendRider today). PAPER lanes switch on only after `class_backtest.mjs` passes them on a holdout.

## Storage
1. **JSON (source of truth):** `tools/router/scans/router-YYYY-MM-DD.json` — pack + routed list + `stampMetadata` provenance.
2. **Supabase (Phase 2):** Drizzle `router_scan(date, symbol, strategy, status, signal, metrics jsonb, created_at)` for desk MCP / JARVIS HUD.

## Output
Console table: LIVE breakouts → LIVE coils → PAPER flags → CASH count. Slack ping in Phase 2.

## Phasing
1. **Phase 1 (now):** swing mode = TrendRider (LIVE) + Cash, daily bars, JSON, console. Parity-checked vs the live Pine Screener (JPM breakout, BAC/AAPL coils).
2. Phase 2: Supabase sink + Slack ping.
3. Phase 3: premarket mode → snapshots + RVOL → Momentum/JumpDay (PAPER).
4. Phase 4: MeanRev lane + wire holdout harness to auto-promote.

## Parity check (validation)
Phase-1 TrendRider output must reproduce the live Pine Screener: **JPM = breakout; BAC/AAPL/SCHW/GM/F = coil; INTU/PFE = cash (TrendUp 0).**
