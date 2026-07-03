// Deterministic read of a manually tracked position.
//
// Research only. No position here is opened, closed, approved, or simulated;
// this only describes the state of a position the user is tracking by hand.

import { round } from "./detectors";
import type {
  Features,
  PositionInput,
  PositionRead,
  RiskReward,
  ThesisStatus,
} from "./types";

const BASE_NOTE = "Manual position read for research and journaling only.";

export function evaluatePosition(
  positionInput: PositionInput | null | undefined,
  features: Features,
  riskReward: RiskReward,
): PositionRead {
  if (!positionInput) {
    return {
      status: "FLAT",
      side: null,
      unrealizedR: null,
      thesisStatus: "UNKNOWN",
      notes: `${BASE_NOTE} No tracked position.`,
    };
  }

  const { side, entry, stop } = positionInput;
  const price = features.price;

  let unrealizedR: number | null = null;
  if (price !== null && stop != null && stop !== entry) {
    const risk = Math.abs(entry - stop);
    if (risk > 0) {
      const move = side === "LONG" ? price - entry : entry - price;
      unrealizedR = round(move / risk, 2);
    }
  }

  let thesisStatus: ThesisStatus = "UNKNOWN";
  if (price !== null) {
    const invalidation = riskReward.invalidation;
    let breached = false;
    if (stop != null) {
      breached = side === "LONG" ? price <= stop : price >= stop;
    } else if (invalidation !== null) {
      breached = side === "LONG" ? price <= invalidation : price >= invalidation;
    }

    if (breached) {
      thesisStatus = "INVALIDATED";
    } else if (unrealizedR !== null) {
      thesisStatus = unrealizedR > 0 ? "VALID" : "WEAKENING";
    } else {
      thesisStatus = "VALID";
    }
  }

  return {
    status: "IN_POSITION",
    side,
    unrealizedR,
    thesisStatus,
    notes: BASE_NOTE,
  };
}
