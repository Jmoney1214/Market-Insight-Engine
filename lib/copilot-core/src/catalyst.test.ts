// Deterministic catalyst summary — null without news (never guessed), counts
// and freshness only, and bit-identical output for identical input.

import { describe, it, expect } from "vitest";
import {
  computeCatalyst,
  FRESH_WINDOW_HOURS,
  MAX_CATALYST_ITEMS,
} from "./catalyst";
import type { NewsItem } from "./types";

const NOW_MS = Date.UTC(2026, 6, 8, 21, 0, 0); // 2026-07-08 21:00 UTC
const NOW_S = NOW_MS / 1000;
const hoursAgo = (h: number) => NOW_S - h * 3600;

const item = (h: number, headline = `headline ${h}h`): NewsItem => ({
  headline,
  source: "TestWire",
  publishedAt: hoursAgo(h),
});

describe("computeCatalyst", () => {
  it("returns null with no news — a catalyst is never guessed", () => {
    expect(computeCatalyst(null, NOW_MS)).toBeNull();
    expect(computeCatalyst(undefined, NOW_MS)).toBeNull();
    expect(computeCatalyst([], NOW_MS)).toBeNull();
  });

  it("returns null when every item is malformed", () => {
    expect(
      computeCatalyst(
        [
          { headline: "", source: "X", publishedAt: hoursAgo(1) },
          { headline: "ok", source: "X", publishedAt: NaN },
          { headline: "future", source: "X", publishedAt: NOW_S + 7200 },
        ],
        NOW_MS,
      ),
    ).toBeNull();
  });

  it("buckets freshness at the 24h window and sorts newest first", () => {
    const r = computeCatalyst([item(30), item(2), item(10)], NOW_MS)!;
    expect(r.total).toBe(3);
    expect(r.fresh24h).toBe(2);
    expect(r.newestAgeHours).toBe(2);
    expect(r.items[0].ageHours).toBe(2);
    expect(r.items[1].ageHours).toBe(10);
    expect(r.items[2].ageHours).toBe(30);
  });

  it("caps carried items but counts the full total", () => {
    const r = computeCatalyst([item(1), item(2), item(3), item(4), item(5)], NOW_MS)!;
    expect(r.items.length).toBe(MAX_CATALYST_ITEMS);
    expect(r.total).toBe(5);
    expect(r.fresh24h).toBe(5);
  });

  it("stale-only coverage reads fresh24h = 0, not null", () => {
    const r = computeCatalyst([item(FRESH_WINDOW_HOURS + 10)], NOW_MS)!;
    expect(r.fresh24h).toBe(0);
    expect(r.total).toBe(1);
  });

  it("skips malformed items instead of poisoning the read", () => {
    const r = computeCatalyst(
      [item(3), { headline: "  ", source: "X", publishedAt: hoursAgo(1) }],
      NOW_MS,
    )!;
    expect(r.total).toBe(1);
    expect(r.newestAgeHours).toBe(3);
  });

  it("is deterministic: identical inputs → identical read", () => {
    const news = [item(2), item(30)];
    expect(computeCatalyst(news, NOW_MS)).toEqual(computeCatalyst(news, NOW_MS));
  });
});
