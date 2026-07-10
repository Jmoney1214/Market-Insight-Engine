// Deterministic catalyst summary from REAL supplied headlines.
//
// Counts and freshness only — NEVER sentiment, materiality, or direction.
// Inferring "this headline is bullish" from text is judgment, and judgment
// belongs to humans and the research agents (catalyst-scout), not the
// deterministic core. When no news is supplied (replay, fixtures, feed outage)
// the result is null and the catalyst agent stays honestly UNAVAILABLE.

import type { CatalystRead, NewsItem } from "./types";
import { round } from "./detectors";

/** Headlines within this window count as fresh (tradeable-recency). */
export const FRESH_WINDOW_HOURS = 24;
/** Max headline items carried on the read. */
export const MAX_CATALYST_ITEMS = 3;
/** Ignore items stamped further in the future than this (clock skew guard). */
const MAX_FUTURE_SKEW_S = 3600;

/**
 * Summarize supplied headlines relative to `nowMs`. Pure: identical inputs →
 * identical read. Null when nothing valid was supplied — never an empty guess.
 */
export function computeCatalyst(
  news: NewsItem[] | null | undefined,
  nowMs: number,
): CatalystRead | null {
  if (!news || news.length === 0) return null;
  const nowS = Math.floor(nowMs / 1000);

  const valid = news.filter(
    (n) =>
      n &&
      typeof n.headline === "string" &&
      n.headline.trim().length > 0 &&
      typeof n.source === "string" &&
      Number.isFinite(n.publishedAt) &&
      n.publishedAt > 0 &&
      n.publishedAt <= nowS + MAX_FUTURE_SKEW_S,
  );
  if (valid.length === 0) return null;

  const sorted = [...valid].sort((a, b) => b.publishedAt - a.publishedAt);
  const ageHours = (n: NewsItem) =>
    round(Math.max(0, nowS - n.publishedAt) / 3600, 1)!;

  const fresh24h = sorted.filter(
    (n) => ageHours(n) <= FRESH_WINDOW_HOURS,
  ).length;

  return {
    total: sorted.length,
    fresh24h,
    newestAgeHours: ageHours(sorted[0]),
    items: sorted.slice(0, MAX_CATALYST_ITEMS).map((n) => ({
      headline: n.headline.trim(),
      source: n.source,
      ageHours: ageHours(n),
    })),
  };
}
