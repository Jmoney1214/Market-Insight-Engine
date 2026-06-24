// Deterministic gates.
//
// Safety/market gates (data, staleness, spread, market quality) can produce
// non-overridable L5 hard blocks. Credibility and validation gates are soft:
// they lower conviction and emit warnings but never hard-block. This separation
// is intentional — only objective market-safety failures are L5.

import {
  MIN_COMPLETENESS,
  MIN_CREDIBILITY,
  STALE_QUOTE_SECONDS,
  WARN_COMPLETENESS,
  WARN_SPREAD_BPS,
  WIDE_SPREAD_BPS,
} from "./constants";
import type {
  FeedQuality,
  GateVerdict,
  GateVerdicts,
  HardBlockCode,
  Mode,
  TriggerStack,
  ValidationSnapshot,
} from "./types";

export interface GateResult {
  gates: GateVerdicts;
  hardBlocks: HardBlockCode[];
}

export function evaluateGates(params: {
  mode: Mode;
  price: number | null;
  barCount: number;
  feedQuality: FeedQuality;
  triggerStack: TriggerStack;
  validation: ValidationSnapshot;
}): GateResult {
  const { mode, price, barCount, feedQuality, triggerStack, validation } = params;
  const hardBlocks: HardBlockCode[] = [];

  // --- DATA gate (hard) ---
  let data: GateVerdict;
  if (barCount === 0 || price === null) {
    data = { status: "BLOCK", reason: "No usable bars or price" };
    hardBlocks.push("DATA_FAILURE");
  } else {
    data = { status: "PASS", reason: "Price and bars present" };
  }

  // --- STALENESS gate (hard; enforced only in LIVE/REPLAY) ---
  let staleness: GateVerdict;
  const ageEnforced = mode === "LIVE" || mode === "REPLAY";
  if (!ageEnforced) {
    staleness = {
      status: "PASS",
      reason: "Quote staleness is not enforced in RESEARCH mode",
    };
  } else if (feedQuality.quoteAgeSeconds === null) {
    staleness = { status: "WARN", reason: "No quote timestamp available" };
  } else if (feedQuality.quoteAgeSeconds > STALE_QUOTE_SECONDS) {
    staleness = {
      status: "BLOCK",
      reason: `Quote age ${feedQuality.quoteAgeSeconds}s exceeds ${STALE_QUOTE_SECONDS}s`,
    };
    hardBlocks.push("STALE_QUOTE");
  } else {
    staleness = { status: "PASS", reason: "Quote is fresh" };
  }

  // --- SPREAD gate (hard when wide) ---
  let spread: GateVerdict;
  if (feedQuality.spreadBps === null) {
    spread = { status: "WARN", reason: "Spread unavailable (no bid/ask)" };
  } else if (feedQuality.spreadBps > WIDE_SPREAD_BPS) {
    spread = {
      status: "BLOCK",
      reason: `Spread ${feedQuality.spreadBps}bps exceeds ${WIDE_SPREAD_BPS}bps`,
    };
    hardBlocks.push("WIDE_SPREAD");
  } else if (feedQuality.spreadBps > WARN_SPREAD_BPS) {
    spread = {
      status: "WARN",
      reason: `Spread ${feedQuality.spreadBps}bps is elevated`,
    };
  } else {
    spread = { status: "PASS", reason: "Spread within tolerance" };
  }

  // --- MARKET QUALITY gate (hard when session data is too incomplete) ---
  let marketQuality: GateVerdict;
  if (barCount === 0) {
    // DATA_FAILURE already captures the no-data case; avoid a duplicate block.
    marketQuality = { status: "BLOCK", reason: "No data to assess market quality" };
  } else if (feedQuality.completeness < MIN_COMPLETENESS) {
    marketQuality = {
      status: "BLOCK",
      reason: `Completeness ${feedQuality.completeness} below ${MIN_COMPLETENESS}`,
    };
    hardBlocks.push("MARKET_QUALITY_FAILURE");
  } else if (feedQuality.completeness < WARN_COMPLETENESS) {
    marketQuality = {
      status: "WARN",
      reason: `Completeness ${feedQuality.completeness} is degraded`,
    };
  } else {
    marketQuality = { status: "PASS", reason: "Sufficient market data" };
  }

  // --- CREDIBILITY gate (soft) ---
  let credibility: GateVerdict;
  if (triggerStack.credibility < MIN_CREDIBILITY) {
    credibility = {
      status: "WARN",
      reason: `Trigger credibility ${triggerStack.credibility} below ${MIN_CREDIBILITY}`,
    };
  } else {
    credibility = {
      status: "PASS",
      reason: "Trigger stack has adequate credibility",
    };
  }

  // --- VALIDATION gate (soft; prevents folklore being treated as proven) ---
  let validationGate: GateVerdict;
  if (validation.status === "paper_validated") {
    validationGate = { status: "PASS", reason: "Edge is paper validated" };
  } else if (validation.status === "no_edge") {
    validationGate = { status: "WARN", reason: "Strategy has measured no edge" };
  } else {
    validationGate = {
      status: "WARN",
      reason: `Edge unproven (${validation.status})`,
    };
  }

  return {
    gates: {
      data,
      staleness,
      spread,
      marketQuality,
      credibility,
      validation: validationGate,
    },
    hardBlocks,
  };
}
