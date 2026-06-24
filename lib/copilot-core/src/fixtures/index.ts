// Deterministic, network-free fixtures. These drive both the unit tests and the
// API server's fixture data source so the copilot can run with no API keys.

import { round } from "../detectors";
import type { Bar, Mode, Quote } from "../types";

export interface Fixture {
  symbol: string;
  description: string;
  mode: Mode;
  dataSource: string;
  bars: Bar[];
  quote: Quote | null;
  /** Deterministic "now" (epoch ms) so age-based gates are reproducible. */
  nowMs: number;
}

// 2024-06-03 13:30:00 UTC (a regular-session open), 5-minute bars.
const SESSION_START = Math.floor(Date.UTC(2024, 5, 3, 13, 30, 0) / 1000);
const BAR_SECONDS = 300;
const SESSION_BARS = 80;

function makeBar(
  index: number,
  o: number,
  h: number,
  l: number,
  c: number,
  v: number,
): Bar {
  return {
    t: SESSION_START + index * BAR_SECONDS,
    o: round(o, 2),
    h: round(h, 2),
    l: round(l, 2),
    c: round(c, 2),
    v,
  };
}

/**
 * A clean opening-range-breakout day: a tight opening range, then a steady
 * uptrend that closes above the range on a late volume expansion.
 */
function cleanOrbBars(): Bar[] {
  const bars: Bar[] = [];

  // Opening range (first 3 bars) roughly within 99.5 .. 100.5.
  bars.push(makeBar(0, 100.0, 100.5, 99.6, 100.2, 1000));
  bars.push(makeBar(1, 100.2, 100.4, 99.5, 99.8, 1010));
  bars.push(makeBar(2, 99.8, 100.3, 99.7, 100.1, 1020));

  // Steady uptrend with low baseline volume until a late breakout expansion.
  let price = 100.1;
  for (let i = 3; i < SESSION_BARS; i++) {
    const o = price;
    const c = price + 0.05;
    const h = Math.max(o, c) + 0.05;
    const l = Math.min(o, c) - 0.04;
    const v = i >= SESSION_BARS - 5 ? 2000 + (i - (SESSION_BARS - 5)) * 500 : 800;
    bars.push(makeBar(i, o, h, l, c, v));
    price = c;
  }

  return bars;
}

function lastBarTime(bars: Bar[]): number {
  return bars[bars.length - 1].t;
}

const cleanBars = cleanOrbBars();
const cleanLast = cleanBars[cleanBars.length - 1].c;
const cleanLastTime = lastBarTime(cleanBars);

export const FIXTURES: Record<string, Fixture> = {
  // Healthy opening-range breakout: fresh quote, tight spread, full session.
  AAPL: {
    symbol: "AAPL",
    description: "Clean opening-range breakout on a late volume expansion",
    mode: "RESEARCH",
    dataSource: "fixture",
    bars: cleanBars,
    quote: {
      bid: round(cleanLast - 0.02, 2),
      ask: round(cleanLast + 0.02, 2),
      last: cleanLast,
      quoteTime: cleanLastTime,
    },
    nowMs: cleanLastTime * 1000,
  },

  // Same healthy bars but evaluated LIVE with a quote that is 10 minutes old.
  // Demonstrates the STALE_QUOTE hard block.
  MSFT: {
    symbol: "MSFT",
    description: "Stale quote (10 minutes old) under LIVE mode",
    mode: "LIVE",
    dataSource: "fixture",
    bars: cleanBars,
    quote: {
      bid: round(cleanLast - 0.02, 2),
      ask: round(cleanLast + 0.02, 2),
      last: cleanLast,
      quoteTime: cleanLastTime - 600,
    },
    nowMs: cleanLastTime * 1000,
  },

  // Healthy bars but a very wide bid/ask. Demonstrates the WIDE_SPREAD block.
  TSLA: {
    symbol: "TSLA",
    description: "Wide bid/ask spread on otherwise healthy bars",
    mode: "RESEARCH",
    dataSource: "fixture",
    bars: cleanBars,
    quote: {
      bid: round(cleanLast - 0.6, 2),
      ask: round(cleanLast + 0.6, 2),
      last: cleanLast,
      quoteTime: cleanLastTime,
    },
    nowMs: cleanLastTime * 1000,
  },

  // No bars and no quote. Demonstrates the DATA_FAILURE hard block.
  NODATA: {
    symbol: "NODATA",
    description: "No bars and no quote available",
    mode: "RESEARCH",
    dataSource: "fixture",
    bars: [],
    quote: null,
    nowMs: SESSION_START * 1000,
  },
};

export function getFixture(symbol: string): Fixture | null {
  return FIXTURES[symbol.toUpperCase()] ?? null;
}

export function listFixtures(): string[] {
  return Object.keys(FIXTURES);
}
