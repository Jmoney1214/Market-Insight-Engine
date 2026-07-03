// Feed-quality assessment: how trustworthy is the underlying data right now.

import {
  EXPECTED_SESSION_BARS,
  MIN_COMPLETENESS,
  STALE_QUOTE_SECONDS,
  WARN_COMPLETENESS,
  WIDE_SPREAD_BPS,
} from "./constants";
import { round } from "./detectors";
import { computeSpreadBps } from "./features";
import type { Bar, FeedQuality, FeedVerdict, Mode, Quote } from "./types";

export function computeFeedQuality(params: {
  source: string;
  bars: Bar[];
  quote: Quote | null | undefined;
  mode: Mode;
  nowMs: number;
}): FeedQuality {
  const { source, bars, quote, mode, nowMs } = params;
  const nowSec = Math.floor(nowMs / 1000);

  const quoteAgeSeconds =
    quote && Number.isFinite(quote.quoteTime)
      ? Math.max(0, nowSec - quote.quoteTime)
      : null;
  const lastBar = bars.length > 0 ? bars[bars.length - 1] : null;
  const barAgeSeconds = lastBar ? Math.max(0, nowSec - lastBar.t) : null;
  const spreadBps = computeSpreadBps(quote);
  const completeness = round(Math.min(1, bars.length / EXPECTED_SESSION_BARS), 3);

  const ageEnforced = mode === "LIVE" || mode === "REPLAY";
  const isStale =
    ageEnforced &&
    quoteAgeSeconds !== null &&
    quoteAgeSeconds > STALE_QUOTE_SECONDS;

  const notes: string[] = [];
  let verdict: FeedVerdict;
  const wideSpread = spreadBps !== null && spreadBps > WIDE_SPREAD_BPS;
  if (bars.length === 0) {
    verdict = "BLOCKED";
    notes.push("No bars available");
  } else if (isStale || wideSpread || completeness < MIN_COMPLETENESS) {
    verdict = "BLOCKED";
    if (isStale) notes.push("Quote is stale");
    if (wideSpread) notes.push("Spread is wide");
    if (completeness < MIN_COMPLETENESS) notes.push("Session data incomplete");
  } else if (spreadBps === null || completeness < WARN_COMPLETENESS) {
    verdict = "DEGRADED";
    if (spreadBps === null) notes.push("No bid/ask spread available");
    if (completeness < WARN_COMPLETENESS) notes.push("Partial session data");
  } else {
    verdict = "OK";
  }

  return {
    source,
    quoteAgeSeconds,
    barAgeSeconds,
    spreadBps,
    completeness,
    isStale,
    verdict,
    notes: notes.length > 0 ? notes.join("; ") : null,
  };
}
