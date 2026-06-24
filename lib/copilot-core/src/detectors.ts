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
