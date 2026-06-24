// Domain types for the deterministic copilot core.
//
// This package is the single deterministic source of truth. It defines its own
// types and never imports the API/wire layer. The API server re-validates the
// emitted event against the generated OpenAPI Zod schema at its boundary.
//
// SAFETY: This is a research/helper engine. It never produces orders, never
// approves or simulates execution, and carries no order-intent fields.

export type Mode = "LIVE" | "REPLAY" | "RESEARCH";

export type AlertLevel = "L1" | "L2" | "L3" | "L4" | "L5";

export type GateStatus = "PASS" | "WARN" | "BLOCK";

export type TriggerCategory = "primary_edge" | "entry_refinement";

export type PositionStatus = "FLAT" | "IN_POSITION";

export type PositionSide = "LONG" | "SHORT";

export type Direction = "LONG" | "SHORT";

export type ThesisStatus = "VALID" | "WEAKENING" | "INVALIDATED" | "UNKNOWN";

export type FeedVerdict = "OK" | "DEGRADED" | "BLOCKED";

export type ValidationStatus =
  | "unproven"
  | "paper_pending"
  | "backtested_only"
  | "backtested_pending_forward"
  | "paper_validated"
  | "no_edge"
  | "insufficient_sample";

/**
 * Non-overridable hard-block codes. When any of these is present the event is
 * forced to alertLevel "L5" with l5Blocked=true. Downstream consumers (the
 * future LLM analyst layer included) may read these but must never remove,
 * soften, or override them.
 */
export type HardBlockCode =
  | "DATA_FAILURE"
  | "STALE_QUOTE"
  | "WIDE_SPREAD"
  | "MARKET_QUALITY_FAILURE";

/** A single OHLCV bar. `t` is the epoch-seconds timestamp at the bar open. */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** A latest-quote snapshot. `quoteTime` is epoch seconds. */
export interface Quote {
  bid: number | null;
  ask: number | null;
  last: number | null;
  quoteTime: number;
}

/** Manually tracked position supplied by the user (research only). */
export interface PositionInput {
  side: PositionSide;
  entry: number;
  stop?: number | null;
}

/** Validation snapshot for the active strategy/trigger stack. */
export interface ValidationSnapshot {
  status: ValidationStatus;
  sampleCount: number;
  expectancyR: number | null;
}

/** Pure, mode/source-agnostic input to {@link buildCopilotEvent}. */
export interface BuildEventInput {
  symbol: string;
  mode: Mode;
  dataSource: string;
  bars: Bar[];
  quote?: Quote | null;
  /** Epoch ms "now" for deterministic age computation; defaults to Date.now(). */
  nowMs?: number;
  position?: PositionInput | null;
  validation?: ValidationSnapshot | null;
}

export interface Features {
  price: number | null;
  vwap: number | null;
  rvol: number | null;
  atr: number | null;
  openingRangeHigh: number | null;
  openingRangeLow: number | null;
  volumeExpansion: boolean | null;
  priceLocation: string | null;
  spread: number | null;
  change1d: number | null;
}

export interface MarketQuality {
  spreadOk: boolean | null;
  quoteFresh: boolean | null;
  liquidityOk: boolean | null;
  notes: string | null;
}

export interface Trigger {
  name: string;
  category: TriggerCategory;
  detected: boolean;
  detail: string | null;
}

export interface TriggerStack {
  stackName: string;
  category: TriggerCategory | null;
  credibility: number;
  detectedTriggers: string[];
}

export interface GateVerdict {
  status: GateStatus;
  reason: string;
}

export interface GateVerdicts {
  data: GateVerdict;
  staleness: GateVerdict;
  spread: GateVerdict;
  marketQuality: GateVerdict;
  credibility: GateVerdict;
  validation: GateVerdict;
}

export interface RiskReward {
  direction: Direction | null;
  entry: number | null;
  invalidation: number | null;
  target: number | null;
  ratio: number | null;
  riskPerShare: number | null;
  notes: string;
}

export interface PositionRead {
  status: PositionStatus;
  side: PositionSide | null;
  unrealizedR: number | null;
  thesisStatus: ThesisStatus;
  notes: string;
}

export interface FeedQuality {
  source: string;
  quoteAgeSeconds: number | null;
  barAgeSeconds: number | null;
  spreadBps: number | null;
  completeness: number;
  isStale: boolean;
  verdict: FeedVerdict;
  notes: string | null;
}

/**
 * The canonical deterministic copilot event. Single source of truth for the
 * (later) analyst layer. Carries no order intent.
 */
export interface CopilotEvent {
  eventId: string;
  symbol: string;
  timestamp: string;
  mode: Mode;
  dataSource: string;
  alertLevel: AlertLevel | null;
  l5Blocked: boolean;
  snapshot: Features;
  marketQuality: MarketQuality;
  triggers: Trigger[];
  triggerStack: TriggerStack;
  gates: GateVerdicts;
  hardBlocks: string[];
  riskReward: RiskReward;
  position: PositionRead;
  feedQuality: FeedQuality;
  warnings: string[];
}
