// Deterministic trigger-stack detection.
//
// Primary-edge triggers are hypotheses about directional edge; entry-refinement
// triggers are context only and must never be treated as proven alpha on their
// own. Credibility here is a deterministic function of what was detected, not a
// hand-typed score.

import { round } from "./detectors";
import type {
  Bar,
  Direction,
  Features,
  Trigger,
  TriggerCategory,
  TriggerStack,
} from "./types";

const BULLISH = new Set([
  "OPENING_RANGE_BREAKOUT",
  "TREND_CONTINUATION_LONG",
  "VWAP_RECLAIM",
]);
const BEARISH = new Set([
  "OPENING_RANGE_FAILURE",
  "TREND_CONTINUATION_SHORT",
  "VWAP_REJECTION",
]);

function makeTrigger(
  name: string,
  category: TriggerCategory,
  detected: boolean,
  detail: string | null,
): Trigger {
  return { name, category, detected, detail };
}

export function detectTriggers(bars: Bar[], features: Features): Trigger[] {
  const { price, vwap, openingRangeHigh, openingRangeLow, volumeExpansion } =
    features;
  const prevClose = bars.length >= 2 ? bars[bars.length - 2].c : null;
  const triggers: Trigger[] = [];

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
    price !== null && vwap !== null && prevClose !== null && prevClose < vwap && price > vwap;
  triggers.push(
    makeTrigger(
      "VWAP_RECLAIM",
      "entry_refinement",
      reclaim,
      reclaim ? "Price crossed back above VWAP" : null,
    ),
  );

  const rejection =
    price !== null && vwap !== null && prevClose !== null && prevClose > vwap && price < vwap;
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

  return triggers;
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

  const stackName = primary[0]?.name ?? refinement[0]?.name ?? "NONE";

  return { stackName, category, credibility, detectedTriggers };
}

/** Net directional bias from detected triggers, or null when balanced/none. */
export function inferDirection(triggers: Trigger[]): Direction | null {
  let score = 0;
  for (const t of triggers) {
    if (!t.detected) continue;
    if (BULLISH.has(t.name)) score += 1;
    if (BEARISH.has(t.name)) score -= 1;
  }
  if (score > 0) return "LONG";
  if (score < 0) return "SHORT";
  return null;
}
