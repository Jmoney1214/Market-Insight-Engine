// Deterministic trigger-stack detection.
//
// Primary-edge triggers are hypotheses about directional edge; entry-refinement
// triggers are context only and must never be treated as proven alpha on their
// own. Credibility here is a deterministic function of what was detected, not a
// hand-typed score.
//
// SAFETY / HONESTY INVARIANT:
//   - Every detector is a pure function of the in-session bars plus optional
//     out-of-band context. No LLM, no randomness, no hidden state.
//   - Detectors that need data the current source cannot supply (e.g. the prior
//     session close for gaps) stay dormant — they report detected:false rather
//     than guessing — so single-session fixtures never emit spurious signals.
//   - entry_refinement triggers are CONTEXT ONLY. They never drive directional
//     bias and the scoreboard never scores them; they cannot become a proven edge.

import {
  COMPRESSION_LOOKBACK,
  COMPRESSION_RANGE_ATR,
  EARNINGS_DRIFT_WINDOW_SECONDS,
  GAP_MIN_PCT,
  RELATIVE_STRENGTH_MIN_PCT,
  SWING_LOOKBACK,
} from "./constants";
import {
  highest,
  lastSwingHigh,
  lastSwingLow,
  lowest,
  round,
  swingHighs,
  swingLows,
} from "./detectors";
import { canonicalHypothesisName } from "./strategyLab";
import type {
  Bar,
  Direction,
  Features,
  Trigger,
  TriggerCategory,
  TriggerContext,
  TriggerStack,
} from "./types";

// Directional primary-edge triggers feed the net directional bias. Entry
// refinement triggers are intentionally excluded — they are context only.
const BULLISH = new Set([
  "OPENING_RANGE_BREAKOUT",
  "TREND_CONTINUATION_LONG",
  "VWAP_RECLAIM",
  "VOLATILITY_COMPRESSION_BREAKOUT_LONG",
  "GAP_CONTINUATION_LONG",
  "GAP_FADE_LONG",
  "POST_EARNINGS_DRIFT_LONG",
  "RELATIVE_STRENGTH_MOMENTUM_LONG",
]);
const BEARISH = new Set([
  "OPENING_RANGE_FAILURE",
  "TREND_CONTINUATION_SHORT",
  "VWAP_REJECTION",
  "VOLATILITY_COMPRESSION_BREAKOUT_SHORT",
  "GAP_CONTINUATION_SHORT",
  "GAP_FADE_SHORT",
  "POST_EARNINGS_DRIFT_SHORT",
  "RELATIVE_STRENGTH_MOMENTUM_SHORT",
]);

/**
 * True when a trigger name is a bearish structural signal. In the LONG-ONLY
 * desk these are INVERTED into long entries, so consumers use this to present
 * the bearish trigger as the *reason* for the inverted long (not an argument
 * against it). Single source of truth for "what is bearish".
 */
export function isBearishTrigger(name: string): boolean {
  return BEARISH.has(name);
}

function makeTrigger(
  name: string,
  category: TriggerCategory,
  detected: boolean,
  detail: string | null,
): Trigger {
  return { name, category, detected, detail };
}

const NO_CONTEXT: TriggerContext = {
  priorClose: null,
  earningsTime: null,
  benchmarkReturnPct: null,
};

export function detectTriggers(
  bars: Bar[],
  features: Features,
  context: TriggerContext = NO_CONTEXT,
): Trigger[] {
  const { price, vwap, openingRangeHigh, openingRangeLow, volumeExpansion } =
    features;
  const prevClose = bars.length >= 2 ? bars[bars.length - 2].c : null;
  const triggers: Trigger[] = [];

  // --- Primary-edge directional hypotheses (original seven; order preserved so
  //     the stack name stays stable for existing consumers). ---------------
  const orbDetected =
    price !== null &&
    openingRangeHigh !== null &&
    price > openingRangeHigh &&
    volumeExpansion === true;
  triggers.push(
    makeTrigger(
      "OPENING_RANGE_BREAKOUT",
      "primary_edge",
      orbDetected,
      orbDetected
        ? "Price broke above the opening range high on expanding volume"
        : null,
    ),
  );

  const orfDetected =
    price !== null && openingRangeLow !== null && price < openingRangeLow;
  triggers.push(
    makeTrigger(
      "OPENING_RANGE_FAILURE",
      "primary_edge",
      orfDetected,
      orfDetected ? "Price broke below the opening range low" : null,
    ),
  );

  const trendLong =
    price !== null &&
    vwap !== null &&
    openingRangeHigh !== null &&
    price > vwap &&
    price > openingRangeHigh;
  triggers.push(
    makeTrigger(
      "TREND_CONTINUATION_LONG",
      "primary_edge",
      trendLong,
      trendLong ? "Price holding above VWAP and the opening range" : null,
    ),
  );

  const trendShort =
    price !== null &&
    vwap !== null &&
    openingRangeLow !== null &&
    price < vwap &&
    price < openingRangeLow;
  triggers.push(
    makeTrigger(
      "TREND_CONTINUATION_SHORT",
      "primary_edge",
      trendShort,
      trendShort ? "Price holding below VWAP and the opening range" : null,
    ),
  );

  const reclaim =
    price !== null &&
    vwap !== null &&
    prevClose !== null &&
    prevClose < vwap &&
    price > vwap;
  triggers.push(
    makeTrigger(
      "VWAP_RECLAIM",
      "entry_refinement",
      reclaim,
      reclaim ? "Price crossed back above VWAP" : null,
    ),
  );

  const rejection =
    price !== null &&
    vwap !== null &&
    prevClose !== null &&
    prevClose > vwap &&
    price < vwap;
  triggers.push(
    makeTrigger(
      "VWAP_REJECTION",
      "entry_refinement",
      rejection,
      rejection ? "Price rejected back below VWAP" : null,
    ),
  );

  const volExp = volumeExpansion === true;
  triggers.push(
    makeTrigger(
      "VOLUME_EXPANSION",
      "entry_refinement",
      volExp,
      volExp ? "Relative volume is expanding" : null,
    ),
  );

  // --- Volatility-compression breakout (primary edge, bar-derived). --------
  triggers.push(
    detectCompressionBreakout(bars, features),
  );

  // --- Gap continuation / fade (primary edge, gated on prior-session close). -
  const gap = detectGapTriggers(bars, features, context.priorClose);
  triggers.push(gap.continuation, gap.fade);

  // --- Post-earnings drift (primary edge, gated on a recent earnings date plus
  //     the prior-session close). Dormant when either is unavailable. ---------
  triggers.push(
    detectPostEarningsDrift(
      bars,
      features,
      context.priorClose,
      context.earningsTime,
    ),
  );

  // --- Relative-strength momentum (primary edge, gated on a benchmark return). -
  triggers.push(
    detectRelativeStrength(bars, features, context.benchmarkReturnPct),
  );

  // --- Entry-refinement context (ICT/SMC + structure). Context only. -------
  triggers.push(...detectStructureTriggers(bars, features));

  return triggers;
}

/**
 * Volatility-compression breakout: a tight coil (range small versus ATR) that
 * resolves on the latest bar with an expansion close beyond the coil on
 * expanding volume. Direction is encoded in the trigger name so it can feed the
 * directional bias without ambiguity.
 */
function detectCompressionBreakout(bars: Bar[], features: Features): Trigger {
  const name = "VOLATILITY_COMPRESSION_BREAKOUT";
  const { atr, volumeExpansion, price } = features;
  // Need the coil window plus the resolving bar.
  if (
    bars.length < COMPRESSION_LOOKBACK + 1 ||
    atr === null ||
    atr <= 0 ||
    price === null ||
    volumeExpansion !== true
  ) {
    return makeTrigger(name, "primary_edge", false, null);
  }
  const latest = bars[bars.length - 1];
  const coil = bars.slice(-(COMPRESSION_LOOKBACK + 1), -1);
  const coilHigh = highest(coil.map((b) => b.h));
  const coilLow = lowest(coil.map((b) => b.l));
  if (coilHigh === null || coilLow === null) {
    return makeTrigger(name, "primary_edge", false, null);
  }
  const coilRange = coilHigh - coilLow;
  const contracted = coilRange <= COMPRESSION_RANGE_ATR * atr;
  const expansionBar = latest.h - latest.l >= atr;
  const breakoutUp = latest.c > coilHigh;
  const breakoutDown = latest.c < coilLow;

  if (contracted && expansionBar && breakoutUp) {
    return makeTrigger(
      `${name}_LONG`,
      "primary_edge",
      true,
      "Price expanded above a volatility contraction on rising volume",
    );
  }
  if (contracted && expansionBar && breakoutDown) {
    return makeTrigger(
      `${name}_SHORT`,
      "primary_edge",
      true,
      "Price expanded below a volatility contraction on rising volume",
    );
  }
  return makeTrigger(name, "primary_edge", false, null);
}

/**
 * Gap continuation and gap fade. Both require the prior-session close; when it
 * is unavailable they stay dormant (detected:false) so single-session data can
 * never fabricate a gap. Continuation and fade are mutually exclusive for a
 * given gap direction by construction.
 */
function detectGapTriggers(
  bars: Bar[],
  features: Features,
  priorClose: number | null,
): { continuation: Trigger; fade: Trigger } {
  const contName = "GAP_CONTINUATION";
  const fadeName = "GAP_FADE";
  const { price, openingRangeHigh, openingRangeLow, volumeExpansion } = features;
  const sessionOpen = bars.length > 0 ? bars[0].o : null;

  const dormant = {
    continuation: makeTrigger(contName, "primary_edge", false, null),
    fade: makeTrigger(fadeName, "primary_edge", false, null),
  };
  if (
    priorClose === null ||
    priorClose <= 0 ||
    sessionOpen === null ||
    price === null ||
    openingRangeHigh === null ||
    openingRangeLow === null
  ) {
    return dormant;
  }

  const gapPct = round(((sessionOpen - priorClose) / priorClose) * 100, 2);
  const gapUp = gapPct >= GAP_MIN_PCT;
  const gapDown = gapPct <= -GAP_MIN_PCT;
  if (!gapUp && !gapDown) return dormant;

  // Continuation: price extends past the opening range in the gap direction on
  // expanding volume.
  let continuation = makeTrigger(contName, "primary_edge", false, null);
  if (gapUp && price > openingRangeHigh && volumeExpansion === true) {
    continuation = makeTrigger(
      `${contName}_LONG`,
      "primary_edge",
      true,
      "Gap up held above the opening range on expanding volume",
    );
  } else if (gapDown && price < openingRangeLow && volumeExpansion === true) {
    continuation = makeTrigger(
      `${contName}_SHORT`,
      "primary_edge",
      true,
      "Gap down held below the opening range on expanding volume",
    );
  }

  // Fade: price reverses through the opposite side of the opening range, working
  // back toward the prior close (gap fill).
  let fade = makeTrigger(fadeName, "primary_edge", false, null);
  if (gapUp && price < openingRangeLow) {
    fade = makeTrigger(
      `${fadeName}_SHORT`,
      "primary_edge",
      true,
      "Gap up reversed below the opening range toward the prior close",
    );
  } else if (gapDown && price > openingRangeHigh) {
    fade = makeTrigger(
      `${fadeName}_LONG`,
      "primary_edge",
      true,
      "Gap down reversed above the opening range toward the prior close",
    );
  }

  return { continuation, fade };
}

/**
 * Post-earnings drift: a directional primary edge gated on a recent earnings
 * report (epoch-seconds timestamp) AND the prior-session close. Both are
 * out-of-band context the in-session bars cannot supply, so the detector stays
 * dormant (detected:false) when either is missing — fixtures/replay leave them
 * null and therefore never fabricate an earnings signal. The drift direction is
 * the post-earnings gap direction once it holds through the opening range on
 * expanding volume; direction is encoded in the trigger name so it can feed the
 * directional bias as a genuine primary edge.
 */
function detectPostEarningsDrift(
  bars: Bar[],
  features: Features,
  priorClose: number | null,
  earningsTime: number | null,
): Trigger {
  const name = "POST_EARNINGS_DRIFT";
  const { price, openingRangeHigh, openingRangeLow, volumeExpansion } = features;
  const sessionOpen = bars.length > 0 ? bars[0].o : null;
  const sessionStart = bars.length > 0 ? bars[0].t : null;

  if (
    earningsTime === null ||
    priorClose === null ||
    priorClose <= 0 ||
    sessionOpen === null ||
    sessionStart === null ||
    price === null ||
    openingRangeHigh === null ||
    openingRangeLow === null ||
    volumeExpansion !== true
  ) {
    return makeTrigger(name, "primary_edge", false, null);
  }

  // The report must precede this session's open and fall inside the recency
  // window, so only a fresh, drift-eligible report can arm the detector.
  const sinceEarnings = sessionStart - earningsTime;
  const reportedRecently =
    sinceEarnings >= 0 && sinceEarnings <= EARNINGS_DRIFT_WINDOW_SECONDS;
  if (!reportedRecently) {
    return makeTrigger(name, "primary_edge", false, null);
  }

  const gapPct = round(((sessionOpen - priorClose) / priorClose) * 100, 2);
  const gapUp = gapPct >= GAP_MIN_PCT;
  const gapDown = gapPct <= -GAP_MIN_PCT;

  if (gapUp && price > openingRangeHigh) {
    return makeTrigger(
      `${name}_LONG`,
      "primary_edge",
      true,
      "Post-earnings gap up held above the opening range on expanding volume",
    );
  }
  if (gapDown && price < openingRangeLow) {
    return makeTrigger(
      `${name}_SHORT`,
      "primary_edge",
      true,
      "Post-earnings gap down held below the opening range on expanding volume",
    );
  }
  return makeTrigger(name, "primary_edge", false, null);
}

/**
 * Relative-strength momentum: a directional primary edge gated on a benchmark
 * (e.g. SPY) percent return since the open. The symbol's since-open return is
 * compared against the benchmark's; meaningful outperformance while holding
 * above VWAP with intact higher-low structure is a bullish edge, and the mirror
 * (underperformance below VWAP with a lower-high) is bearish. Without the
 * benchmark return the detector cannot evaluate and stays dormant, so
 * single-session fixtures never fabricate a relative-strength signal.
 */
function detectRelativeStrength(
  bars: Bar[],
  features: Features,
  benchmarkReturnPct: number | null,
): Trigger {
  const name = "RELATIVE_STRENGTH_MOMENTUM";
  const { price, vwap } = features;
  const sessionOpen = bars.length > 0 ? bars[0].o : null;

  if (
    benchmarkReturnPct === null ||
    sessionOpen === null ||
    sessionOpen <= 0 ||
    price === null ||
    vwap === null
  ) {
    return makeTrigger(name, "primary_edge", false, null);
  }

  const symbolReturnPct = round(((price - sessionOpen) / sessionOpen) * 100, 2);
  const relativePct = round(symbolReturnPct - benchmarkReturnPct, 2);

  const highs = swingHighs(bars, SWING_LOOKBACK).map((p) => p.price);
  const lows = swingLows(bars, SWING_LOOKBACK).map((p) => p.price);
  const higherLow =
    lows.length >= 2 && lows[lows.length - 1] > lows[lows.length - 2];
  const lowerHigh =
    highs.length >= 2 && highs[highs.length - 1] < highs[highs.length - 2];

  if (relativePct >= RELATIVE_STRENGTH_MIN_PCT && price > vwap && higherLow) {
    return makeTrigger(
      `${name}_LONG`,
      "primary_edge",
      true,
      "Outperforming the benchmark since the open while holding above VWAP",
    );
  }
  if (relativePct <= -RELATIVE_STRENGTH_MIN_PCT && price < vwap && lowerHigh) {
    return makeTrigger(
      `${name}_SHORT`,
      "primary_edge",
      true,
      "Underperforming the benchmark since the open while holding below VWAP",
    );
  }
  return makeTrigger(name, "primary_edge", false, null);
}

/**
 * Entry-refinement structure detectors (ICT/SMC folklore + market structure).
 * These are CONTEXT ONLY: they never feed directional bias and are never
 * promotable to a proven edge.
 */
function detectStructureTriggers(bars: Bar[], features: Features): Trigger[] {
  const out: Trigger[] = [];
  const { price, vwap } = features;
  const swingHigh = lastSwingHigh(bars, SWING_LOOKBACK);
  const swingLow = lastSwingLow(bars, SWING_LOOKBACK);
  const highs = swingHighs(bars, SWING_LOOKBACK).map((p) => p.price);
  const lows = swingLows(bars, SWING_LOOKBACK).map((p) => p.price);
  const latest = bars.length > 0 ? bars[bars.length - 1] : null;
  const close = latest ? latest.c : price;

  // Higher low / lower high: structure read from the last two confirmed swings.
  const higherLow =
    lows.length >= 2 && lows[lows.length - 1] > lows[lows.length - 2];
  out.push(
    makeTrigger(
      "HIGHER_LOW",
      "entry_refinement",
      higherLow,
      higherLow ? "Most recent swing low printed above the prior swing low" : null,
    ),
  );

  const lowerHigh =
    highs.length >= 2 && highs[highs.length - 1] < highs[highs.length - 2];
  out.push(
    makeTrigger(
      "LOWER_HIGH",
      "entry_refinement",
      lowerHigh,
      lowerHigh
        ? "Most recent swing high printed below the prior swing high"
        : null,
    ),
  );

  // Break of structure: price closes beyond the most recent swing in the
  // direction of the prevailing structure (continuation).
  let bos = makeTrigger("BREAK_OF_STRUCTURE", "entry_refinement", false, null);
  if (close !== null) {
    if (higherLow && swingHigh !== null && close > swingHigh.price) {
      bos = makeTrigger(
        "BREAK_OF_STRUCTURE",
        "entry_refinement",
        true,
        "Price closed above the prior swing high, extending the up structure",
      );
    } else if (lowerHigh && swingLow !== null && close < swingLow.price) {
      bos = makeTrigger(
        "BREAK_OF_STRUCTURE",
        "entry_refinement",
        true,
        "Price closed below the prior swing low, extending the down structure",
      );
    }
  }
  out.push(bos);

  // Change of character: the first close against the prevailing structure.
  let choch = makeTrigger("CHANGE_OF_CHARACTER", "entry_refinement", false, null);
  if (close !== null) {
    if (higherLow && swingLow !== null && close < swingLow.price) {
      choch = makeTrigger(
        "CHANGE_OF_CHARACTER",
        "entry_refinement",
        true,
        "Price closed below the prior swing low, breaking the up structure",
      );
    } else if (lowerHigh && swingHigh !== null && close > swingHigh.price) {
      choch = makeTrigger(
        "CHANGE_OF_CHARACTER",
        "entry_refinement",
        true,
        "Price closed above the prior swing high, breaking the down structure",
      );
    }
  }
  out.push(choch);

  // Liquidity sweep: the latest bar wicks beyond a prior swing then closes back
  // inside (a stop run that fails to hold).
  let sweep = makeTrigger("LIQUIDITY_SWEEP", "entry_refinement", false, null);
  if (latest !== null) {
    if (swingLow !== null && latest.l < swingLow.price && latest.c > swingLow.price) {
      sweep = makeTrigger(
        "LIQUIDITY_SWEEP",
        "entry_refinement",
        true,
        "Price wicked below the prior swing low and closed back above it",
      );
    } else if (
      swingHigh !== null &&
      latest.h > swingHigh.price &&
      latest.c < swingHigh.price
    ) {
      sweep = makeTrigger(
        "LIQUIDITY_SWEEP",
        "entry_refinement",
        true,
        "Price wicked above the prior swing high and closed back below it",
      );
    }
  }
  out.push(sweep);

  // Fair value gap: a three-bar imbalance on the most recent bars.
  let fvg = makeTrigger("FVG", "entry_refinement", false, null);
  if (bars.length >= 3) {
    const a = bars[bars.length - 3];
    const c = bars[bars.length - 1];
    if (c.l > a.h) {
      fvg = makeTrigger(
        "FVG",
        "entry_refinement",
        true,
        "A bullish fair value gap formed over the last three bars",
      );
    } else if (c.h < a.l) {
      fvg = makeTrigger(
        "FVG",
        "entry_refinement",
        true,
        "A bearish fair value gap formed over the last three bars",
      );
    }
  }
  out.push(fvg);

  // Opening-range retest: after an opening-range break, price returns to the
  // level and holds on the right side of it.
  out.push(detectOrbRetest(bars, features));

  // VWAP loss: price crossed below VWAP and held below it for two bars.
  let vwapLoss = makeTrigger("VWAP_LOSS", "entry_refinement", false, null);
  if (bars.length >= 3 && vwap !== null) {
    const c1 = bars[bars.length - 1].c;
    const c2 = bars[bars.length - 2].c;
    const c3 = bars[bars.length - 3].c;
    if (c3 >= vwap && c2 < vwap && c1 < vwap) {
      vwapLoss = makeTrigger(
        "VWAP_LOSS",
        "entry_refinement",
        true,
        "Price lost VWAP and held below it for two bars",
      );
    }
  }
  out.push(vwapLoss);

  return out;
}

function detectOrbRetest(bars: Bar[], features: Features): Trigger {
  const name = "ORB_RETEST";
  const { openingRangeHigh, openingRangeLow } = features;
  const latest = bars.length > 0 ? bars[bars.length - 1] : null;
  if (latest === null) return makeTrigger(name, "entry_refinement", false, null);
  const earlier = bars.slice(0, -1);

  if (openingRangeHigh !== null) {
    const brokeOut = earlier.some((b) => b.c > openingRangeHigh);
    if (brokeOut && latest.l <= openingRangeHigh && latest.c > openingRangeHigh) {
      return makeTrigger(
        name,
        "entry_refinement",
        true,
        "Price pulled back to the opening range high and held above it",
      );
    }
  }
  if (openingRangeLow !== null) {
    const brokeDown = earlier.some((b) => b.c < openingRangeLow);
    if (brokeDown && latest.h >= openingRangeLow && latest.c < openingRangeLow) {
      return makeTrigger(
        name,
        "entry_refinement",
        true,
        "Price pulled back to the opening range low and held below it",
      );
    }
  }
  return makeTrigger(name, "entry_refinement", false, null);
}

export function buildTriggerStack(triggers: Trigger[]): TriggerStack {
  const detected = triggers.filter((t) => t.detected);
  const detectedTriggers = detected.map((t) => t.name);
  const primary = detected.filter((t) => t.category === "primary_edge");
  const refinement = detected.filter((t) => t.category === "entry_refinement");

  const credibility = round(
    Math.min(1, 0.35 * primary.length + 0.1 * refinement.length),
    2,
  );

  let category: TriggerCategory | null = null;
  if (primary.length > 0) category = "primary_edge";
  else if (refinement.length > 0) category = "entry_refinement";

  // The stack name is the *hypothesis identity* used for journaling and
  // scoreboard matching, so it must be the directionless registry name even
  // when the firing trigger is a directional variant (e.g. GAP_FADE_LONG). The
  // directional trigger names are still preserved in detectedTriggers.
  const stackName = canonicalHypothesisName(
    primary[0]?.name ?? refinement[0]?.name ?? "NONE",
  );

  return { stackName, category, credibility, detectedTriggers };
}

/**
 * LONG-ONLY signal direction (operator directive: invert bearish to buy).
 *
 * Every detected directional primary trigger — bullish OR bearish — signals a
 * LONG. A bearish structural break (e.g. OPENING_RANGE_FAILURE, a _SHORT
 * variant) is INVERTED into a long entry with mirrored risk (computeRiskReward
 * builds the long stop/target). The desk never produces a SHORT. Returns null
 * only when no directional primary edge is detected.
 */
export function inferDirection(triggers: Trigger[]): Direction | null {
  const anyDirectional = triggers.some(
    (t) => t.detected && (BULLISH.has(t.name) || BEARISH.has(t.name)),
  );
  return anyDirectional ? "LONG" : null;
}

/**
 * Triggers that transitioned into a detected state since the previous read
 * (false -> true, or newly present). Returns an empty list when there is no
 * prior baseline, so the first read after a stream/context switch never fires.
 * This is the deterministic debounce: a trigger that stays detected fires once.
 */
export function newlyFiredTriggers<T extends { name: string; detected: boolean }>(
  prev: T[] | null | undefined,
  curr: T[],
): T[] {
  if (!prev) return [];
  const wasDetected = new Map<string, boolean>();
  for (const t of prev) wasDetected.set(t.name, t.detected);
  return curr.filter((t) => t.detected && wasDetected.get(t.name) !== true);
}
