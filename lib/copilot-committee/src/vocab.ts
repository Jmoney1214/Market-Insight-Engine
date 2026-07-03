// Controlled vocabularies and safety constants for the analyst committee.
//
// SAFETY: This layer only explains the deterministic event. It can never create
// signals, approve trades, override hard blocks, or invent data. The recommendation
// vocabulary is fixed and small; forbidden phrases catch any execution-implying or
// false-certainty language so it can never render.

/** The only recommendations the committee may ever emit. */
export const APPROVED_RECOMMENDATIONS = [
  "WATCH",
  "WAIT",
  "AVOID",
  "POSSIBLE_LONG_ZONE",
  "POSSIBLE_SHORT_ZONE",
  "THESIS_VALID",
  "THESIS_WEAKENING",
  "TRAIL_STOP",
  "TAKE_PARTIALS",
  "EXIT_WARNING",
  "THESIS_INVALIDATED",
  "DO_NOT_ADD",
] as const;

export type Recommendation = (typeof APPROVED_RECOMMENDATIONS)[number];

export const BIASES = ["BULLISH", "BEARISH", "NEUTRAL", "MIXED", "UNKNOWN"] as const;
export type Bias = (typeof BIASES)[number];

export const AGENT_STATUSES = ["OK", "DEGRADED", "UNAVAILABLE"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const RISK_VERDICTS = ["PASS", "WARN", "BLOCK"] as const;
export type RiskVerdict = (typeof RISK_VERDICTS)[number];

/**
 * When a hard block / L5 is active, the recommendation may ONLY ever be one of
 * these four defensive values. Enforced as an absolute final gate.
 */
export const BLOCKED_ALLOWED_RECOMMENDATIONS: readonly Recommendation[] = [
  "AVOID",
  "DO_NOT_ADD",
  "EXIT_WARNING",
  "THESIS_INVALIDATED",
];

/**
 * Permissiveness rank: higher = more action / opportunity forward. A
 * recommendation may never exceed the risk critic's ceiling on this scale.
 * Defensive / blocked recommendations sit at the bottom.
 */
export const PERMISSIVENESS: Record<Recommendation, number> = {
  THESIS_INVALIDATED: 0,
  AVOID: 0,
  EXIT_WARNING: 1,
  DO_NOT_ADD: 2,
  THESIS_WEAKENING: 2,
  WAIT: 3,
  WATCH: 4,
  TRAIL_STOP: 5,
  TAKE_PARTIALS: 5,
  THESIS_VALID: 6,
  POSSIBLE_SHORT_ZONE: 7,
  POSSIBLE_LONG_ZONE: 7,
};

/**
 * Execution-implying, order-routing, or false-certainty phrases that must never
 * appear in any committee output (lowercased substring match). Deterministic
 * prose is authored to avoid every one of these; any provider/LLM text that
 * trips one is discarded in favour of the deterministic read.
 */
export const FORBIDDEN_PHRASES: readonly string[] = [
  // explicit order / execution identifiers and routing
  "submit_order",
  "place_order",
  "execute_trade",
  "execute",
  "order execution",
  "place order",
  "place an order",
  "place the order",
  "submit order",
  "submit an order",
  "submit the order",
  "place a trade",
  "market order",
  "limit order",
  "stop order",
  "fill the order",
  // direct action commands
  "buy now",
  "sell now",
  "buy right now",
  "sell right now",
  "buy here",
  "sell here",
  "buy immediately",
  "sell immediately",
  "you should buy",
  "you should sell",
  "i recommend buying",
  "i recommend selling",
  "go long now",
  "go short now",
  "go all in",
  "must enter",
  "must exit",
  "must buy",
  "must sell",
  "back up the truck",
  "load up",
  "dump it",
  // false certainty
  "guaranteed",
  "can't lose",
  "cannot lose",
  "sure thing",
  "sure win",
  "risk-free",
  "risk free",
  "easy money",
  "free money",
  "to the moon",
];
