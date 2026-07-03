// Deterministic intraday feature engine.

import {
  ATR_PERIOD,
  OPENING_RANGE_BARS,
  RVOL_MIN_BARS,
  VOLUME_EXPANSION_RVOL,
} from "./constants";
import { atr, mean, round } from "./detectors";
import type { Bar, Features, Quote } from "./types";

/** Volume-weighted average price using typical price (h+l+c)/3. */
export function computeVwap(bars: Bar[]): number | null {
  if (bars.length === 0) return null;
  let pv = 0;
  let vol = 0;
  for (const bar of bars) {
    const typical = (bar.h + bar.l + bar.c) / 3;
    pv += typical * bar.v;
    vol += bar.v;
  }
  if (vol <= 0) return null;
  return round(pv / vol, 4);
}

/** Relative volume: latest bar volume vs the mean of prior bar volumes. */
export function computeRvol(bars: Bar[]): number | null {
  if (bars.length < RVOL_MIN_BARS) return null;
  const latest = bars[bars.length - 1];
  const priorVolumes = bars.slice(0, -1).map((b) => b.v);
  const baseline = mean(priorVolumes);
  if (baseline === null || baseline <= 0) return null;
  return round(latest.v / baseline, 3);
}

/** Opening range high/low from the first `orBars` bars. */
export function computeOpeningRange(
  bars: Bar[],
  orBars: number = OPENING_RANGE_BARS,
): { high: number | null; low: number | null } {
  if (bars.length === 0) return { high: null, low: null };
  const window = bars.slice(0, orBars);
  let high = -Infinity;
  let low = Infinity;
  for (const bar of window) {
    if (bar.h > high) high = bar.h;
    if (bar.l < low) low = bar.l;
  }
  return { high: round(high, 4), low: round(low, 4) };
}

/** Spread in basis points from a quote, or null when bid/ask is unavailable. */
export function computeSpreadBps(quote: Quote | null | undefined): number | null {
  if (!quote || quote.bid === null || quote.ask === null) return null;
  if (quote.bid <= 0 || quote.ask <= 0) return null;
  const mid = (quote.bid + quote.ask) / 2;
  if (mid <= 0) return null;
  return round(((quote.ask - quote.bid) / mid) * 10000, 2);
}

/** Coarse classification of where price sits relative to VWAP and the OR. */
export function classifyPriceLocation(
  price: number | null,
  vwap: number | null,
  orHigh: number | null,
  orLow: number | null,
): string | null {
  if (price === null) return null;
  if (orHigh !== null && price > orHigh) return "ABOVE_OPENING_RANGE";
  if (orLow !== null && price < orLow) return "BELOW_OPENING_RANGE";
  if (vwap !== null) {
    if (price > vwap) return "ABOVE_VWAP_INSIDE_RANGE";
    if (price < vwap) return "BELOW_VWAP_INSIDE_RANGE";
    return "AT_VWAP";
  }
  return "INSIDE_OPENING_RANGE";
}

export function computeFeatures(
  bars: Bar[],
  quote: Quote | null | undefined,
): Features {
  if (bars.length === 0) {
    return {
      price: quote?.last ?? null,
      vwap: null,
      rvol: null,
      atr: null,
      openingRangeHigh: null,
      openingRangeLow: null,
      volumeExpansion: null,
      priceLocation: null,
      spread: null,
      change1d: null,
    };
  }
  const lastBar = bars[bars.length - 1];
  const firstBar = bars[0];
  const price = quote?.last ?? lastBar.c;
  const vwap = computeVwap(bars);
  const rvol = computeRvol(bars);
  const { high: openingRangeHigh, low: openingRangeLow } = computeOpeningRange(bars);
  const atrValue = atr(bars, ATR_PERIOD);
  const spread = computeSpreadBps(quote);
  const volumeExpansion = rvol === null ? null : rvol >= VOLUME_EXPANSION_RVOL;
  const priceLocation = classifyPriceLocation(
    price,
    vwap,
    openingRangeHigh,
    openingRangeLow,
  );
  const change1d =
    price !== null && firstBar.o > 0
      ? round(((price - firstBar.o) / firstBar.o) * 100, 2)
      : null;

  return {
    price,
    vwap,
    rvol,
    atr: atrValue,
    openingRangeHigh,
    openingRangeLow,
    volumeExpansion,
    priceLocation,
    spread,
    change1d,
  };
}
