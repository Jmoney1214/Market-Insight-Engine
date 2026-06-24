// Deterministic thresholds for the copilot core.
//
// The master spec does not pin exact numbers, so these are the canonical
// constants for this implementation. They are intentionally centralized and
// locked by unit tests so behavior is stable and auditable.

/** Quote older than this (seconds) is stale in LIVE/REPLAY -> STALE_QUOTE hard block. */
export const STALE_QUOTE_SECONDS = 60;

/** Spread wider than this (bps) -> WIDE_SPREAD hard block. */
export const WIDE_SPREAD_BPS = 50;

/** Spread wider than this (bps) -> spread WARN. */
export const WARN_SPREAD_BPS = 20;

/** Session completeness below this -> MARKET_QUALITY_FAILURE hard block. */
export const MIN_COMPLETENESS = 0.6;

/** Session completeness below this -> market-quality WARN. */
export const WARN_COMPLETENESS = 0.8;

/** Number of leading bars that define the opening range. */
export const OPENING_RANGE_BARS = 3;

/** Lookback period for ATR. */
export const ATR_PERIOD = 14;

/** Minimum bars required to compute a relative-volume reading. */
export const RVOL_MIN_BARS = 5;

/** Expected bars in a full regular session (~6.5h of 5m bars). */
export const EXPECTED_SESSION_BARS = 78;

/** RVOL at or above this is treated as a volume expansion. */
export const VOLUME_EXPANSION_RVOL = 1.5;

/** Reward-to-risk below this lowers conviction (preview WARN note). */
export const MIN_RR_RATIO = 1.5;

/** Reward multiple used when projecting the preview target. */
export const TARGET_R_MULTIPLE = 2;

/** Trigger-stack credibility below this -> credibility WARN. */
export const MIN_CREDIBILITY = 0.3;

/** Fractal radius (bars on each side) used to confirm a swing pivot. */
export const SWING_LOOKBACK = 2;

/** Number of bars before the latest that form the volatility-contraction coil. */
export const COMPRESSION_LOOKBACK = 6;

/** Coil range at or below this multiple of ATR counts as a contraction. */
export const COMPRESSION_RANGE_ATR = 1.5;

/** Absolute open-vs-prior-close gap (percent) needed to register a gap. */
export const GAP_MIN_PCT = 1;
