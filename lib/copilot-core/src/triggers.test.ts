import { describe, expect, it } from "vitest";
import { buildCopilotEvent } from "./event";
import { computeFeatures } from "./features";
import {
  buildTriggerStack,
  detectTriggers,
  inferDirection,
  newlyFiredTriggers,
} from "./triggers";
import type { Bar, Features, Trigger } from "./types";

const bar = (
  t: number,
  o: number,
  h: number,
  l: number,
  c: number,
  v = 1000,
): Bar => ({ t, o, h, l, c, v });

function feat(overrides: Partial<Features> = {}): Features {
  return {
    price: null,
    vwap: null,
    rvol: null,
    atr: null,
    openingRangeHigh: null,
    openingRangeLow: null,
    volumeExpansion: null,
    priceLocation: null,
    spread: null,
    change1d: null,
    ...overrides,
  };
}

const detectedNames = (ts: Trigger[]): string[] =>
  ts.filter((t) => t.detected).map((t) => t.name);

// A market-structure base: two rising swing lows (9.0 @2, 9.8 @7) and one swing
// high (12 @5). The last two bars are never pivots, so swapping the final bar
// changes only the break, not the confirmed structure.
const STRUCTURE_BASE: Bar[] = [
  bar(0, 10.5, 11, 10, 10.5),
  bar(1, 10.5, 11, 9.5, 10),
  bar(2, 10, 10.5, 9.0, 9.5), // swing low 9.0
  bar(3, 9.6, 11, 9.6, 10.5),
  bar(4, 10.5, 11.5, 10, 11),
  bar(5, 11, 12, 10.5, 11.5), // swing high 12
  bar(6, 10.8, 11, 10.2, 10.5),
  bar(7, 10.5, 11, 9.8, 10.2), // swing low 9.8 (higher than 9.0)
  bar(8, 10.5, 11.5, 10.3, 11),
  bar(9, 11, 12, 10.6, 11.5),
];

describe("market-structure refinement detectors (context only)", () => {
  it("detects a higher low and a break of structure on an upside break", () => {
    const bars = [...STRUCTURE_BASE, bar(10, 11.5, 13, 11, 12.5)];
    const names = detectedNames(detectTriggers(bars, feat({ price: 12.5 })));
    expect(names).toContain("HIGHER_LOW");
    expect(names).toContain("BREAK_OF_STRUCTURE");
    expect(names).not.toContain("CHANGE_OF_CHARACTER");
    expect(names).not.toContain("LOWER_HIGH");
  });

  it("detects a change of character when price breaks the up structure down", () => {
    const bars = [...STRUCTURE_BASE, bar(10, 10.6, 10.7, 9.0, 9.2)];
    const names = detectedNames(detectTriggers(bars, feat({ price: 9.2 })));
    expect(names).toContain("CHANGE_OF_CHARACTER");
    expect(names).not.toContain("BREAK_OF_STRUCTURE");
  });

  it("detects a liquidity sweep when price wicks a swing low and recovers", () => {
    const bars = [...STRUCTURE_BASE, bar(10, 10.6, 10.8, 9.5, 10.5)];
    const names = detectedNames(detectTriggers(bars, feat({ price: 10.5 })));
    expect(names).toContain("LIQUIDITY_SWEEP");
    expect(names).not.toContain("BREAK_OF_STRUCTURE");
    expect(names).not.toContain("CHANGE_OF_CHARACTER");
  });

  it("flags all structure triggers as entry_refinement (non-promotable context)", () => {
    const bars = [...STRUCTURE_BASE, bar(10, 11.5, 13, 11, 12.5)];
    const triggers = detectTriggers(bars, feat({ price: 12.5 }));
    for (const name of [
      "HIGHER_LOW",
      "LOWER_HIGH",
      "BREAK_OF_STRUCTURE",
      "CHANGE_OF_CHARACTER",
      "LIQUIDITY_SWEEP",
      "FVG",
      "ORB_RETEST",
      "VWAP_LOSS",
    ]) {
      const t = triggers.find((x) => x.name === name);
      expect(t?.category).toBe("entry_refinement");
    }
  });
});

describe("fair value gap detector", () => {
  it("detects a bullish fair value gap (3-bar imbalance)", () => {
    const bars = [
      bar(0, 10, 10.2, 9.8, 10),
      bar(1, 10.2, 11, 10.1, 10.9),
      bar(2, 11, 11.5, 10.3, 11.4), // low 10.3 > bar0 high 10.2
    ];
    expect(detectedNames(detectTriggers(bars, feat()))).toContain("FVG");
  });

  it("does not detect a fair value gap when the range overlaps", () => {
    const bars = [
      bar(0, 10, 10.5, 9.5, 10),
      bar(1, 10, 10.4, 9.6, 10.1),
      bar(2, 10.1, 10.6, 9.9, 10.2),
    ];
    expect(detectedNames(detectTriggers(bars, feat()))).not.toContain("FVG");
  });
});

describe("VWAP loss detector", () => {
  it("fires when price loses VWAP and holds below for two bars", () => {
    const bars = [
      bar(0, 100, 101.5, 97, 101),
      bar(1, 99, 99.5, 98.5, 99),
      bar(2, 98.5, 98.6, 97.5, 98),
    ];
    const names = detectedNames(detectTriggers(bars, feat({ vwap: 100 })));
    expect(names).toContain("VWAP_LOSS");
  });

  it("does not fire while price is above VWAP", () => {
    const bars = [
      bar(0, 100, 101, 99.5, 100.5),
      bar(1, 100.5, 101.5, 100, 101),
      bar(2, 101, 102, 100.5, 101.5),
    ];
    const names = detectedNames(detectTriggers(bars, feat({ vwap: 100 })));
    expect(names).not.toContain("VWAP_LOSS");
  });
});

describe("opening-range retest detector", () => {
  it("fires when price pulls back to the broken opening-range high and holds", () => {
    const bars = [
      bar(0, 100, 100.5, 99.6, 100.2),
      bar(1, 100.2, 100.4, 99.5, 99.8),
      bar(2, 99.8, 100.3, 99.7, 100.1),
      bar(3, 100.1, 101.2, 100, 101), // breaks above OR high (100.5)
      bar(4, 101, 101.1, 100.4, 100.7), // pulls back to 100.5, holds above
    ];
    const features = feat({
      price: 100.7,
      openingRangeHigh: 100.5,
      openingRangeLow: 99.5,
    });
    expect(detectedNames(detectTriggers(bars, features))).toContain("ORB_RETEST");
  });
});

describe("volatility-compression breakout (primary edge)", () => {
  const coil: Bar[] = [
    bar(0, 100, 100.2, 99.8, 100),
    bar(1, 100, 100.2, 99.8, 100),
    bar(2, 100, 100.2, 99.8, 100),
    bar(3, 100, 100.2, 99.8, 100),
    bar(4, 100, 100.2, 99.8, 100),
    bar(5, 100, 100.2, 99.8, 100),
  ];

  it("fires LONG on an upside expansion out of a contraction", () => {
    const bars = [...coil, bar(6, 100, 102, 100, 101.8, 5000)];
    const names = detectedNames(
      detectTriggers(
        bars,
        feat({ price: 101.8, atr: 0.4, volumeExpansion: true }),
      ),
    );
    expect(names).toContain("VOLATILITY_COMPRESSION_BREAKOUT_LONG");
  });

  it("fires SHORT on a downside expansion out of a contraction", () => {
    const bars = [...coil, bar(6, 100, 100, 98, 98.2, 5000)];
    const names = detectedNames(
      detectTriggers(
        bars,
        feat({ price: 98.2, atr: 0.4, volumeExpansion: true }),
      ),
    );
    expect(names).toContain("VOLATILITY_COMPRESSION_BREAKOUT_SHORT");
  });

  it("does not fire without a volume expansion", () => {
    const bars = [...coil, bar(6, 100, 102, 100, 101.8, 800)];
    const names = detectedNames(
      detectTriggers(
        bars,
        feat({ price: 101.8, atr: 0.4, volumeExpansion: false }),
      ),
    );
    expect(names.some((n) => n.startsWith("VOLATILITY_COMPRESSION"))).toBe(false);
  });
});

describe("gap detectors (gated on prior-session close)", () => {
  const gapBars = (open: number): Bar[] => [
    bar(0, open, open + 1, open - 1, open + 0.5),
    bar(1, open + 0.5, open + 1.5, open, open + 1),
    bar(2, open + 1, open + 1.5, open + 0.5, open + 1),
  ];

  it("stays dormant when no prior close is available", () => {
    const names = detectedNames(
      detectTriggers(
        gapBars(102),
        feat({ price: 103, openingRangeHigh: 102.5, openingRangeLow: 101.5 }),
        { priorClose: null },
      ),
    );
    expect(names.some((n) => n.startsWith("GAP_"))).toBe(false);
  });

  it("detects gap continuation long on a held gap up with volume", () => {
    const names = detectedNames(
      detectTriggers(
        gapBars(102),
        feat({
          price: 103,
          openingRangeHigh: 102.5,
          openingRangeLow: 101.5,
          volumeExpansion: true,
        }),
        { priorClose: 100 },
      ),
    );
    expect(names).toContain("GAP_CONTINUATION_LONG");
    expect(names).not.toContain("GAP_FADE_SHORT");
  });

  it("detects gap fade short when a gap up reverses below the range", () => {
    const triggers = detectTriggers(
      gapBars(102),
      feat({
        price: 101,
        openingRangeHigh: 102.5,
        openingRangeLow: 101.5,
        volumeExpansion: false,
      }),
      { priorClose: 100 },
    );
    const names = detectedNames(triggers);
    expect(names).toContain("GAP_FADE_SHORT");
    expect(names).not.toContain("GAP_CONTINUATION_LONG");
    // The bearish structure still fires as intelligence (GAP_FADE_SHORT), but
    // LONG-ONLY inverts it: the actionable direction is a long, never a short.
    expect(inferDirection(triggers)).toBe("LONG");
  });

  it("treats a gap-down fade back above the range as a bullish edge", () => {
    const triggers = detectTriggers(
      gapBars(98),
      feat({
        price: 99,
        openingRangeHigh: 98.5,
        openingRangeLow: 97.5,
        volumeExpansion: false,
      }),
      { priorClose: 100 },
    );
    const names = detectedNames(triggers);
    expect(names).toContain("GAP_FADE_LONG");
    expect(inferDirection(triggers)).toBe("LONG");
  });
});

describe("post-earnings drift (gated on a recent earnings date)", () => {
  // 5m bars; session opens at t=0. A clean gap up that holds the opening range.
  const DAY = 86_400;
  const gapBars = (open: number): Bar[] => [
    bar(0, open, open + 1, open - 0.5, open + 0.8, 5000),
    bar(300, open + 0.8, open + 1.5, open + 0.3, open + 1.2, 5000),
    bar(600, open + 1.2, open + 1.8, open + 0.8, open + 1.5, 5000),
  ];
  const driftFeat = () =>
    feat({
      price: 103,
      openingRangeHigh: 102.5,
      openingRangeLow: 101,
      volumeExpansion: true,
    });

  it("stays dormant when no earnings time is available", () => {
    const names = detectedNames(
      detectTriggers(gapBars(102), driftFeat(), {
        priorClose: 100,
        earningsTime: null,
        benchmarkReturnPct: null,
      }),
    );
    expect(names.some((n) => n.startsWith("POST_EARNINGS_DRIFT"))).toBe(false);
  });

  it("stays dormant when the prior close is missing (no gap context)", () => {
    const names = detectedNames(
      detectTriggers(gapBars(102), driftFeat(), {
        priorClose: null,
        earningsTime: -DAY,
        benchmarkReturnPct: null,
      }),
    );
    expect(names.some((n) => n.startsWith("POST_EARNINGS_DRIFT"))).toBe(false);
  });

  it("stays dormant when the report is older than the recency window", () => {
    const names = detectedNames(
      detectTriggers(gapBars(102), driftFeat(), {
        priorClose: 100,
        earningsTime: -5 * DAY, // well before the 36h window
        benchmarkReturnPct: null,
      }),
    );
    expect(names.some((n) => n.startsWith("POST_EARNINGS_DRIFT"))).toBe(false);
  });

  it("fires LONG on a recent earnings gap up that holds the opening range", () => {
    const triggers = detectTriggers(gapBars(102), driftFeat(), {
      priorClose: 100,
      earningsTime: -3600, // 1h before the session open
      benchmarkReturnPct: null,
    });
    const names = detectedNames(triggers);
    expect(names).toContain("POST_EARNINGS_DRIFT_LONG");
    expect(inferDirection(triggers)).toBe("LONG");
  });

  it("fires SHORT on a recent earnings gap down that holds below the range", () => {
    const triggers = detectTriggers(
      gapBars(98),
      feat({
        price: 97,
        openingRangeHigh: 99,
        openingRangeLow: 97.5,
        volumeExpansion: true,
      }),
      { priorClose: 100, earningsTime: -3600, benchmarkReturnPct: null },
    );
    const names = detectedNames(triggers);
    expect(names).toContain("POST_EARNINGS_DRIFT_SHORT");
    // Bearish drift detected as intelligence; LONG-ONLY inverts it to a long.
    expect(inferDirection(triggers)).toBe("LONG");
  });

  it("classifies the drift trigger as a promotable primary edge", () => {
    const triggers = detectTriggers(gapBars(102), driftFeat(), {
      priorClose: 100,
      earningsTime: -3600,
      benchmarkReturnPct: null,
    });
    const t = triggers.find((x) => x.name === "POST_EARNINGS_DRIFT_LONG");
    expect(t?.category).toBe("primary_edge");
  });
});

describe("relative-strength momentum (gated on a benchmark return)", () => {
  // Rising structure: two higher swing lows so higher-low is intact.
  const rsBase: Bar[] = [
    bar(0, 100, 100.5, 99.8, 100.2),
    bar(1, 100.2, 100.6, 99.5, 100),
    bar(2, 100, 100.4, 99.2, 99.6), // swing low 99.2
    bar(3, 99.8, 101, 99.8, 100.8),
    bar(4, 100.8, 101.5, 100.4, 101.2),
    bar(5, 101.2, 102, 100.8, 101.6), // swing high
    bar(6, 101.4, 101.8, 100.6, 101),
    bar(7, 101, 101.6, 100.2, 100.6), // swing low 100.2 (> 99.2)
    bar(8, 100.8, 102, 100.6, 101.8),
    bar(9, 101.8, 103, 101.5, 102.5),
  ];

  it("stays dormant when no benchmark return is available", () => {
    const names = detectedNames(
      detectTriggers(rsBase, feat({ price: 102.5, vwap: 101 }), {
        priorClose: null,
        earningsTime: null,
        benchmarkReturnPct: null,
      }),
    );
    expect(names.some((n) => n.startsWith("RELATIVE_STRENGTH"))).toBe(false);
  });

  it("does not fire when outperformance is below the noise threshold", () => {
    // Symbol since-open return: (102.5-100)/100 = 2.5%. Benchmark 2.2% -> 0.3pp.
    const names = detectedNames(
      detectTriggers(rsBase, feat({ price: 102.5, vwap: 101 }), {
        priorClose: null,
        earningsTime: null,
        benchmarkReturnPct: 2.2,
      }),
    );
    expect(names.some((n) => n.startsWith("RELATIVE_STRENGTH"))).toBe(false);
  });

  it("fires LONG when the symbol outperforms above VWAP with a higher low", () => {
    // Symbol 2.5% vs benchmark 0.5% -> 2.0pp outperformance.
    const triggers = detectTriggers(rsBase, feat({ price: 102.5, vwap: 101 }), {
      priorClose: null,
      earningsTime: null,
      benchmarkReturnPct: 0.5,
    });
    const names = detectedNames(triggers);
    expect(names).toContain("RELATIVE_STRENGTH_MOMENTUM_LONG");
    expect(inferDirection(triggers)).toBe("LONG");
  });

  it("does not fire LONG when price is below VWAP despite outperformance", () => {
    const names = detectedNames(
      detectTriggers(rsBase, feat({ price: 102.5, vwap: 103 }), {
        priorClose: null,
        earningsTime: null,
        benchmarkReturnPct: 0.5,
      }),
    );
    expect(names.some((n) => n.startsWith("RELATIVE_STRENGTH"))).toBe(false);
  });

  it("fires SHORT when the symbol underperforms below VWAP with a lower high", () => {
    // Falling structure: two confirmed swing highs (103 @2, 102 @6), the later
    // lower than the earlier, so lower-high is intact.
    const rsDown: Bar[] = [
      bar(0, 99, 100, 98, 99.5),
      bar(1, 99.5, 101, 98.5, 100.5),
      bar(2, 100.5, 103, 100, 102), // swing high 103
      bar(3, 101, 101, 99, 99.5),
      bar(4, 99.5, 100, 98, 98.5),
      bar(5, 98.5, 100.5, 98, 100),
      bar(6, 100, 102, 99, 101), // swing high 102 (< 103)
      bar(7, 100, 100, 97.5, 98),
      bar(8, 98, 99, 97, 97.5),
      bar(9, 97.5, 98.5, 96.8, 97),
      bar(10, 97, 98, 96.5, 97.2),
    ];
    // Symbol since-open: (97.2-99)/99 = -1.82% vs benchmark +0.5% -> -2.32pp.
    const triggers = detectTriggers(rsDown, feat({ price: 97.2, vwap: 99 }), {
      priorClose: null,
      earningsTime: null,
      benchmarkReturnPct: 0.5,
    });
    const names = detectedNames(triggers);
    expect(names).toContain("RELATIVE_STRENGTH_MOMENTUM_SHORT");
    // Underperformance detected as intelligence; LONG-ONLY inverts it to a long.
    expect(inferDirection(triggers)).toBe("LONG");
  });
});

describe("new context detectors stay dormant under NO_CONTEXT default", () => {
  it("emits neither earnings drift nor relative strength without context", () => {
    const bars = [...STRUCTURE_BASE, bar(10, 11.5, 13, 11, 12.5)];
    // Called with the two-arg overload (default NO_CONTEXT).
    const names = detectedNames(detectTriggers(bars, feat({ price: 12.5 })));
    expect(names.some((n) => n.startsWith("POST_EARNINGS_DRIFT"))).toBe(false);
    expect(names.some((n) => n.startsWith("RELATIVE_STRENGTH"))).toBe(false);
  });
});

describe("buildTriggerStack", () => {
  const trig = (
    name: string,
    category: Trigger["category"],
    detected: boolean,
  ): Trigger => ({ name, category, detected, detail: detected ? "x" : null });

  it("reports the canonical registry hypothesis as the stack name", () => {
    // A directional primary trigger fires; the stack name must be the
    // directionless hypothesis so journaling and the scoreboard align, while the
    // directional name is preserved in detectedTriggers.
    const stack = buildTriggerStack([
      trig("GAP_FADE_LONG", "primary_edge", true),
      trig("FVG", "entry_refinement", true),
    ]);
    expect(stack.stackName).toBe("GAP_FADE");
    expect(stack.category).toBe("primary_edge");
    expect(stack.detectedTriggers).toContain("GAP_FADE_LONG");
  });

  it("leaves an already-canonical primary name unchanged", () => {
    const stack = buildTriggerStack([
      trig("OPENING_RANGE_BREAKOUT", "primary_edge", true),
    ]);
    expect(stack.stackName).toBe("OPENING_RANGE_BREAKOUT");
  });
});

describe("no spurious detections on a flat session", () => {
  it("detects nothing when every bar is identical", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 40; i++) bars.push(bar(i * 300, 100, 100, 100, 100));
    const features = computeFeatures(bars, {
      bid: 99.99,
      ask: 100.01,
      last: 100,
      quoteTime: 0,
    });
    expect(detectedNames(detectTriggers(bars, features))).toEqual([]);
  });
});

describe("buildCopilotEvent threads the prior-close context", () => {
  it("emits a gap continuation trigger when priorClose produces a gap", () => {
    const bars = [
      bar(0, 102, 103, 101, 102.5),
      bar(1, 102.5, 103.5, 102, 103),
      bar(2, 103, 103.6, 102.5, 103.4),
      bar(3, 103.4, 103.9, 103.2, 103.7),
      bar(4, 103.7, 104.2, 103.5, 104),
      bar(5, 104, 104.5, 103.8, 104.3, 5000),
    ];
    const last = bars[bars.length - 1];
    const event = buildCopilotEvent({
      symbol: "GAPCO",
      mode: "RESEARCH",
      dataSource: "fixture",
      bars,
      quote: { bid: 104.28, ask: 104.32, last: 104.3, quoteTime: last.t },
      nowMs: last.t * 1000,
      priorClose: 100,
    });
    expect(event.triggers.some((t) => t.name === "GAP_CONTINUATION_LONG")).toBe(
      true,
    );
  });
});

describe("newlyFiredTriggers transition helper", () => {
  const t = (name: string, detected: boolean): Trigger => ({
    name,
    category: "primary_edge",
    detected,
    detail: detected ? "x" : null,
  });

  it("returns nothing when there is no prior baseline", () => {
    expect(newlyFiredTriggers(null, [t("A", true)])).toEqual([]);
    expect(newlyFiredTriggers(undefined, [t("A", true)])).toEqual([]);
  });

  it("returns a trigger that flipped false -> true", () => {
    const fired = newlyFiredTriggers([t("A", false)], [t("A", true)]);
    expect(fired.map((x) => x.name)).toEqual(["A"]);
  });

  it("debounces a trigger that stays detected", () => {
    expect(newlyFiredTriggers([t("A", true)], [t("A", true)])).toEqual([]);
  });

  it("ignores a trigger that turned off", () => {
    expect(newlyFiredTriggers([t("A", true)], [t("A", false)])).toEqual([]);
  });

  it("fires a newly appearing detected trigger", () => {
    const fired = newlyFiredTriggers([t("A", true)], [t("A", true), t("B", true)]);
    expect(fired.map((x) => x.name)).toEqual(["B"]);
  });
});
