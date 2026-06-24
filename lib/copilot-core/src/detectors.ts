// Primitive geometry / indicator helpers. Pure functions only.

import type { Bar } from "./types";

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

export function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function trueRange(current: Bar, previous: Bar | null): number {
  const highLow = current.h - current.l;
  if (previous === null) return highLow;
  const highClose = Math.abs(current.h - previous.c);
  const lowClose = Math.abs(current.l - previous.c);
  return Math.max(highLow, highClose, lowClose);
}

/** Simple average true range over the last `period` true ranges. */
export function atr(bars: Bar[], period: number): number | null {
  if (bars.length < 2) return null;
  const ranges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    ranges.push(trueRange(bars[i], bars[i - 1]));
  }
  const window = ranges.slice(-period);
  const value = mean(window);
  return value === null ? null : round(value, 4);
}

export function highest(values: number[]): number | null {
  if (values.length === 0) return null;
  let hi = -Infinity;
  for (const v of values) if (v > hi) hi = v;
  return hi;
}

export function lowest(values: number[]): number | null {
  if (values.length === 0) return null;
  let lo = Infinity;
  for (const v of values) if (v < lo) lo = v;
  return lo;
}

/** A confirmed swing pivot: its bar index and the pivot price. */
export interface SwingPoint {
  index: number;
  price: number;
}

/**
 * Confirmed swing highs using a symmetric fractal: bar `i` is a swing high when
 * its high is strictly greater than the highs of the `lookback` bars on each
 * side. The most recent `lookback` bars can never be confirmed yet (no future
 * bars to compare against), which keeps detection deterministic and replayable.
 */
export function swingHighs(bars: Bar[], lookback: number): SwingPoint[] {
  const out: SwingPoint[] = [];
  if (lookback < 1) return out;
  for (let i = lookback; i < bars.length - lookback; i++) {
    const pivot = bars[i].h;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].h >= pivot) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) out.push({ index: i, price: pivot });
  }
  return out;
}

/** Confirmed swing lows (mirror of {@link swingHighs}). */
export function swingLows(bars: Bar[], lookback: number): SwingPoint[] {
  const out: SwingPoint[] = [];
  if (lookback < 1) return out;
  for (let i = lookback; i < bars.length - lookback; i++) {
    const pivot = bars[i].l;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].l <= pivot) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) out.push({ index: i, price: pivot });
  }
  return out;
}

/** Most recently confirmed swing high, or null when none exists. */
export function lastSwingHigh(bars: Bar[], lookback: number): SwingPoint | null {
  const highs = swingHighs(bars, lookback);
  return highs.length > 0 ? highs[highs.length - 1] : null;
}

/** Most recently confirmed swing low, or null when none exists. */
export function lastSwingLow(bars: Bar[], lookback: number): SwingPoint | null {
  const lows = swingLows(bars, lookback);
  return lows.length > 0 ? lows[lows.length - 1] : null;
}
