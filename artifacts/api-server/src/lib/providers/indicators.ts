/**
 * Pure technical-indicator helpers. Input close/high/low arrays are ordered
 * oldest -> newest. All functions return null when there is insufficient data.
 */

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Wilder's RSI over `period` (default 14). */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  // Flat price action: no losses. If there were also no gains, RSI is neutral (50).
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Lowest low over the last `lookback` bars (support). */
export function support(lows: number[], lookback = 60): number | null {
  if (lows.length === 0) return null;
  return Math.min(...lows.slice(-lookback));
}

/** Highest high over the last `lookback` bars (resistance). */
export function resistance(highs: number[], lookback = 60): number | null {
  if (highs.length === 0) return null;
  return Math.max(...highs.slice(-lookback));
}

/** Wilder's ATR over `period` (default 14). Arrays ordered oldest -> newest. */
export function atr(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  const n = Math.min(highs.length, lows.length, closes.length);
  if (n < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    trs.push(
      Math.max(
        highs[i]! - lows[i]!,
        Math.abs(highs[i]! - closes[i - 1]!),
        Math.abs(lows[i]! - closes[i - 1]!),
      ),
    );
  }
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]!) / period;
  return a;
}

/**
 * Repeatable intraday-range stats over the last `lookback` sessions:
 * average (high-low)/close % and how many sessions ranged >= thresholdPct.
 * A name that ranged >=2% on 9 of the last 10 days tends to offer multiple
 * intraday trades again today.
 */
export function rangeStats(
  highs: number[],
  lows: number[],
  closes: number[],
  lookback = 10,
  thresholdPct = 2,
): { avgRangePct: number; daysAboveThreshold: number; lookback: number } | null {
  const n = Math.min(highs.length, lows.length, closes.length);
  if (n < lookback) return null;
  let sum = 0;
  let above = 0;
  for (let i = n - lookback; i < n; i++) {
    if (!closes[i]) continue;
    const rangePct = ((highs[i]! - lows[i]!) / closes[i]!) * 100;
    sum += rangePct;
    if (rangePct >= thresholdPct) above++;
  }
  return { avgRangePct: sum / lookback, daysAboveThreshold: above, lookback };
}

/** % change between the close ~`bars` ago and the latest close. */
export function changeOverBars(closes: number[], bars: number): number | null {
  if (closes.length <= bars) return null;
  const past = closes[closes.length - 1 - bars]!;
  const last = closes[closes.length - 1]!;
  if (!past) return null;
  return ((last - past) / past) * 100;
}
