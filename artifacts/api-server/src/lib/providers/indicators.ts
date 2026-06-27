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

/** % change between the close ~`bars` ago and the latest close. */
export function changeOverBars(closes: number[], bars: number): number | null {
  if (closes.length <= bars) return null;
  const past = closes[closes.length - 1 - bars]!;
  const last = closes[closes.length - 1]!;
  if (!past) return null;
  return ((last - past) / past) * 100;
}
