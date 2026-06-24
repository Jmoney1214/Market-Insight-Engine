import { describe, expect, it } from "vitest";
import { buildCopilotEvent } from "./event";
import { computeFeatures } from "./features";
import { detectTriggers, inferDirection, newlyFiredTriggers } from "./triggers";
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
    // Gap fade is a directional primary edge: a gap-up fade is bearish.
    expect(inferDirection(triggers)).toBe("SHORT");
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
