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

/** A single executed trade off the tape. `t` epoch seconds, `p` price, `s` size. */
export interface Trade {
  t: number;
  p: number;
  s: number;
}

/**
 * Deterministic intraday regime, derived purely from in-session bars + the
 * time-of-day of the latest bar. Eight canonical states; `null` only when there
 * are too few bars to classify (the agent then stays DEGRADED, never invents one).
 */
export type RegimeState =
  | "OPENING_DRIVE"
  | "ORB_WINDOW"
  | "TREND_DAY"
  | "RANGE_DAY"
  | "CHOP"
  | "LOW_VOL_AFTERNOON"
  | "POWER_HOUR"
  | "NEWS_SPIKE";

export interface RegimeRead {
  state: RegimeState | null;
  /** Classification confidence, clamped [0,1]. 0 when state is null. */
  confidence: number;
  /** Directional lean of the backdrop; NEUTRAL for range/chop/low-vol states. */
  trendBias: Direction | "NEUTRAL";
  factors: string[];
  metrics: {
    /** Minutes since ET midnight of the latest bar, or null. */
    etMinutes: number | null;
    rvolLast: number | null;
    driftAtr: number | null;
    persistence: number | null;
    rangeAtr: number | null;
  };
}

/** A single news headline supplied by an enrichment source (FMP). */
export interface NewsItem {
  headline: string;
  source: string;
  /** Epoch seconds of publication. */
  publishedAt: number;
  url?: string | null;
}

export interface CatalystItem {
  headline: string;
  source: string;
  ageHours: number;
}

/**
 * Deterministic catalyst summary computed from REAL supplied headlines only —
 * counts and freshness, never sentiment or direction (that would be inference,
 * which belongs to humans / the research agents). Null when no news was
 * supplied (replay/fixtures), keeping the catalyst agent honestly UNAVAILABLE.
 */
export interface CatalystRead {
  total: number;
  fresh24h: number;
  newestAgeHours: number | null;
  /** Newest first, capped at 3. */
  items: CatalystItem[];
}

/**
 * Signed-volume summary from the trade tape (tick rule). Present only when a
 * source supplies real trades (live SIP); replay/fixtures leave it null so the
 * order-flow agent stays honestly UNAVAILABLE rather than inferring flow from
 * price bars alone.
 */
export interface OrderFlowRead {
  buyVolume: number;
  sellVolume: number;
  delta: number;
  /** buyVolume / (buyVolume + sellVolume), 0..1; 0.5 when no classified volume. */
  buyRatio: number;
  tradeCount: number;
  pressure: "BUYING" | "SELLING" | "BALANCED";
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
  /**
   * Trade tape for the current window, when a source can supply it (live SIP).
   * Drives the order-flow signed-volume summary. Absent in replay/fixtures, so
   * order flow stays honestly UNAVAILABLE there. Out-of-band: never on the wire.
   */
  trades?: Trade[] | null;
  /**
   * Recent headlines for the symbol, when an enrichment source can supply them
   * (FMP paid tier, live only). Drives the deterministic catalyst summary.
   * Absent in replay/fixtures, so catalyst stays honestly UNAVAILABLE there.
   * Out-of-band: never on the wire.
   */
  news?: NewsItem[] | null;
  /** Epoch ms "now" for deterministic age computation; defaults to Date.now(). */
  nowMs?: number;
  position?: PositionInput | null;
  validation?: ValidationSnapshot | null;
  /**
   * Prior regular-session close, when a data source can supply it. Gap detectors
   * stay dormant (never fire) when this is absent, so single-session fixtures
   * cannot produce spurious gap signals. Deliberately NOT part of {@link Features}
   * so it never leaks onto the wire snapshot.
   */
  priorClose?: number | null;
  /**
   * Epoch-seconds timestamp of the symbol's most recent earnings report, when a
   * source can supply it. POST_EARNINGS_DRIFT stays dormant when this is absent,
   * so fixtures/replay (which leave it null) never fabricate an earnings signal.
   */
  earningsTime?: number | null;
  /**
   * Benchmark/index (e.g. SPY) percent return since the session open, when a
   * source can supply it. RELATIVE_STRENGTH_MOMENTUM stays dormant when this is
   * absent. Like {@link priorClose}, it is out-of-band context and never part of
   * {@link Features}, so it never leaks onto the wire snapshot.
   */
  benchmarkReturnPct?: number | null;
}

/**
 * Optional out-of-band context for {@link detectTriggers} that is not derivable
 * from the in-session bars alone. Detectors requiring a field must treat its
 * absence (null) as "cannot evaluate" and report `detected: false`.
 */
export interface TriggerContext {
  priorClose: number | null;
  /**
   * Epoch-seconds timestamp of the most recent earnings report, or null when
   * unavailable. POST_EARNINGS_DRIFT stays dormant when null.
   */
  earningsTime: number | null;
  /**
   * Benchmark (e.g. SPY) percent return since the session open, or null when
   * unavailable. RELATIVE_STRENGTH_MOMENTUM stays dormant when null.
   */
  benchmarkReturnPct: number | null;
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
  /** Measured-edge validation for the active trigger stack (journal-derived);
   * the memory agent reads this. DEFAULT is insufficient_sample until outcomes
   * accumulate. Internal to the core event — not forwarded to the wire type. */
  validation: ValidationSnapshot;
  /** Deterministic intraday regime from bars + time-of-day; the regime agent
   * reads this. Internal to the core event — not forwarded to the wire type. */
  regime: RegimeRead;
  /** Signed-volume order-flow summary from the trade tape, or null when no
   * trades were supplied (replay/fixtures). The order-flow agent reads this.
   * Internal to the core event — not forwarded to the wire type. */
  orderFlow: OrderFlowRead | null;
  /** Deterministic headline summary from supplied news, or null when no news
   * was supplied (replay/fixtures). The catalyst agent reads this. Internal to
   * the core event — not forwarded to the wire type. */
  catalyst: CatalystRead | null;
  /** OHLCV bars underlying this event, oldest first; empty on data failure. */
  bars: Bar[];
}
