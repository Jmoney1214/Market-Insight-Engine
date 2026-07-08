// Signed-volume order flow from the trade tape (tick rule).
//
// Only ever computed from REAL executed trades supplied by a live source
// (Alpaca SIP). It is never derived from price bars — per the safety rules the
// order-flow agent must not infer tape behaviour from price alone — so when no
// trades are supplied the result is null and the agent stays UNAVAILABLE.

import type { OrderFlowRead, Trade } from "./types";
import { round } from "./detectors";

/** Buy share of classified volume at/above this → BUYING pressure. */
export const BUY_PRESSURE_RATIO = 0.58;
/** Buy share of classified volume at/below this → SELLING pressure. */
export const SELL_PRESSURE_RATIO = 0.42;

/**
 * Tick-rule classification: an uptick is buyer-initiated, a downtick
 * seller-initiated, and a zero-tick inherits the previous classification
 * (standard tick test). The first trade — and any leading zero-ticks — carry
 * no prior reference and stay unclassified rather than being guessed.
 */
export function computeOrderFlow(
  trades: Trade[] | null | undefined,
): OrderFlowRead | null {
  if (!trades || trades.length === 0) return null;

  let buyVolume = 0;
  let sellVolume = 0;
  let lastDir = 0;
  let prevPrice: number | null = null;

  for (const tr of trades) {
    if (
      !Number.isFinite(tr.p) ||
      !Number.isFinite(tr.s) ||
      tr.p <= 0 ||
      tr.s <= 0
    ) {
      continue;
    }
    if (prevPrice != null) {
      const dir =
        tr.p > prevPrice ? 1 : tr.p < prevPrice ? -1 : lastDir;
      if (dir === 1) buyVolume += tr.s;
      else if (dir === -1) sellVolume += tr.s;
      if (dir !== 0) lastDir = dir;
    }
    prevPrice = tr.p;
  }

  const classified = buyVolume + sellVolume;
  const buyRatio =
    classified > 0 ? round(buyVolume / classified, 4)! : 0.5;
  const pressure =
    classified > 0 && buyRatio >= BUY_PRESSURE_RATIO
      ? "BUYING"
      : classified > 0 && buyRatio <= SELL_PRESSURE_RATIO
        ? "SELLING"
        : "BALANCED";

  return {
    buyVolume,
    sellVolume,
    delta: buyVolume - sellVolume,
    buyRatio,
    tradeCount: trades.length,
    pressure,
  };
}
