// Deterministic intraday regime classification (roadmap Step 4).
//
// Pure function of the in-session bars plus the ET time-of-day of the latest
// bar — no randomness, no external state — so live, replay, and backtest all
// classify identically. When there is not enough data to classify honestly the
// state is null and the regime agent stays DEGRADED; a label is never invented.

import type { Bar, Direction, RegimeRead, RegimeState } from "./types";
import { atr, mean, round } from "./detectors";

/** Bars required before any classification is attempted. */
export const REGIME_MIN_BARS = 3;

/** ET minutes: regular session bounds and intra-session windows. */
const SESSION_OPEN_MIN = 9 * 60 + 30; // 09:30
const OPENING_DRIVE_END = SESSION_OPEN_MIN + 15; // 09:45
const ORB_WINDOW_END = SESSION_OPEN_MIN + 45; // 10:15
const POWER_HOUR_START = 15 * 60; // 15:00
const AFTERNOON_START = 12 * 60; // 12:00
const AFTERNOON_END = 14 * 60 + 30; // 14:30

/** Session drift ≥ this many ATRs (with persistence) reads as a trend day. */
const TREND_DRIFT_ATR = 2.2;
/** Fraction of bars closing with the drift for a trend to be persistent. */
const TREND_PERSISTENCE = 0.6;
/** Last bar true-range ≥ this many ATRs with a volume spike → news spike. */
const SPIKE_RANGE_ATR = 2.5;
/** Last bar volume ≥ this multiple of the session mean → volume spike. */
const SPIKE_VOL_MULT = 3;
/** Session range ≤ this many ATRs with small drift reads as a range day. */
const RANGE_DAY_ATR = 3;
/** Persistence at or below this (choppy closes) reads as chop. */
const CHOP_PERSISTENCE = 0.45;
/** Afternoon RVOL below this is a low-volatility afternoon. */
const LOW_VOL_RVOL = 0.8;
/** Directional lean requires at least this much drift (in ATRs). */
const BIAS_DRIFT_ATR = 0.8;

const ET_HHMM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Minutes since ET midnight for an epoch-seconds timestamp. */
export function etMinutesOf(epochSeconds: number): number {
  const [h, m] = ET_HHMM.format(new Date(epochSeconds * 1000))
    .split(":")
    .map(Number);
  return h * 60 + m;
}

function nullRead(reason: string): RegimeRead {
  return {
    state: null,
    confidence: 0,
    trendBias: "NEUTRAL",
    factors: [reason],
    metrics: {
      etMinutes: null,
      rvolLast: null,
      driftAtr: null,
      persistence: null,
      rangeAtr: null,
    },
  };
}

/**
 * Classify the intraday regime from session bars. Exactly one of the eight
 * canonical states, chosen by a fixed priority so the mapping is auditable:
 * NEWS_SPIKE > OPENING_DRIVE > ORB_WINDOW > POWER_HOUR > TREND_DAY >
 * LOW_VOL_AFTERNOON > CHOP > RANGE_DAY.
 */
export function computeRegime(bars: Bar[]): RegimeRead {
  if (!bars || bars.length < REGIME_MIN_BARS) {
    return nullRead(
      `Fewer than ${REGIME_MIN_BARS} session bars; regime not classified.`,
    );
  }

  const last = bars[bars.length - 1];
  const first = bars[0];
  const etMinutes = etMinutesOf(last.t);

  // Volatility unit. atr() needs period+1 bars; fall back to the mean bar range
  // so short sessions still get a stable, positive unit.
  const atr14 = atr(bars, 14);
  const meanRange = mean(bars.map((b) => b.h - b.l));
  const unitRaw = atr14 ?? meanRange;
  const unit = unitRaw != null && unitRaw > 0 ? unitRaw : null;
  if (unit == null) {
    return nullRead("Bars carry no range; regime not classified.");
  }

  const drift = last.c - first.o;
  const driftAtr = round(drift / unit, 2);
  const hi = Math.max(...bars.map((b) => b.h));
  const lo = Math.min(...bars.map((b) => b.l));
  const rangeAtr = round((hi - lo) / unit, 2);

  // Persistence: fraction of bars whose close moved with the session drift.
  const dir = Math.sign(drift);
  let withDrift = 0;
  let counted = 0;
  for (const b of bars) {
    const move = Math.sign(b.c - b.o);
    if (move === 0) continue;
    counted++;
    if (dir !== 0 && move === dir) withDrift++;
  }
  const persistence =
    counted > 0 ? round(withDrift / counted, 2) : null;

  // Last-bar participation vs the rest of the session.
  const prevVols = bars.slice(0, -1).map((b) => b.v);
  const meanVol = prevVols.length > 0 ? mean(prevVols) : null;
  const rvolLast =
    meanVol != null && meanVol > 0 ? round(last.v / meanVol, 2) : null;

  const lastRange = (last.h - last.l) / unit;

  const factors: string[] = [];
  let state: RegimeState;
  let confidence: number;

  if (
    lastRange >= SPIKE_RANGE_ATR &&
    rvolLast != null &&
    rvolLast >= SPIKE_VOL_MULT
  ) {
    state = "NEWS_SPIKE";
    confidence = 0.75;
    factors.push(
      `Last bar spans ${round(lastRange, 1)} ATRs on ${rvolLast}x session volume.`,
    );
  } else if (etMinutes >= SESSION_OPEN_MIN && etMinutes < OPENING_DRIVE_END) {
    state = "OPENING_DRIVE";
    confidence = 0.7;
    factors.push("Within the first 15 minutes of the regular session.");
  } else if (etMinutes >= OPENING_DRIVE_END && etMinutes < ORB_WINDOW_END) {
    state = "ORB_WINDOW";
    confidence = 0.7;
    factors.push("Opening-range breakout window (09:45–10:15 ET).");
  } else if (etMinutes >= POWER_HOUR_START) {
    state = "POWER_HOUR";
    confidence = 0.65;
    factors.push("Final hour of the regular session.");
  } else if (
    Math.abs(driftAtr ?? 0) >= TREND_DRIFT_ATR &&
    persistence != null &&
    persistence >= TREND_PERSISTENCE
  ) {
    state = "TREND_DAY";
    confidence = 0.7;
    factors.push(
      `Session drift ${driftAtr} ATRs with ${Math.round((persistence ?? 0) * 100)}% of bars closing with it.`,
    );
  } else if (
    etMinutes >= AFTERNOON_START &&
    etMinutes < AFTERNOON_END &&
    rvolLast != null &&
    rvolLast < LOW_VOL_RVOL
  ) {
    state = "LOW_VOL_AFTERNOON";
    confidence = 0.6;
    factors.push(
      `Midday participation faded to ${rvolLast}x the session mean.`,
    );
  } else if (persistence != null && persistence <= CHOP_PERSISTENCE) {
    state = "CHOP";
    confidence = 0.6;
    factors.push(
      `Only ${Math.round(persistence * 100)}% of bars close with the session drift; closes flip direction.`,
    );
  } else {
    state = "RANGE_DAY";
    confidence =
      rangeAtr != null && rangeAtr <= RANGE_DAY_ATR ? 0.6 : 0.5;
    factors.push(
      `Session range ${rangeAtr} ATRs with drift ${driftAtr} ATRs; no directional resolution.`,
    );
  }

  let trendBias: Direction | "NEUTRAL" = "NEUTRAL";
  if (
    driftAtr != null &&
    Math.abs(driftAtr) >= BIAS_DRIFT_ATR &&
    persistence != null &&
    persistence > 0.5
  ) {
    trendBias = driftAtr > 0 ? "LONG" : "SHORT";
  }

  return {
    state,
    confidence,
    trendBias,
    factors,
    metrics: { etMinutes, rvolLast, driftAtr, persistence, rangeAtr },
  };
}
