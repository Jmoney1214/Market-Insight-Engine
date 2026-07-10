// Deterministic regime classifier — every state reachable, honest nulls, and
// bit-identical output for identical input (live/replay parity).

import { describe, it, expect } from "vitest";
import { computeRegime, etMinutesOf, REGIME_MIN_BARS } from "./regime";
import type { Bar } from "./types";

// 2026-07-08 is EDT (UTC-4): ET midnight = 04:00 UTC.
const ET_MIDNIGHT_UTC = Date.UTC(2026, 6, 8, 4, 0, 0) / 1000;
const etEpoch = (minutes: number) => ET_MIDNIGHT_UTC + minutes * 60;

type Spec = { o: number; h: number; l: number; c: number; v?: number };

/** 5-minute bars starting at `startMin` ET minutes. */
function mkBars(startMin: number, specs: Spec[]): Bar[] {
  return specs.map((s, i) => ({
    t: etEpoch(startMin + i * 5),
    o: s.o,
    h: s.h,
    l: s.l,
    c: s.c,
    v: s.v ?? 1000,
  }));
}

/** n flat bars: unit range, tiny drift, steady volume. */
function flat(n: number, px = 100): Spec[] {
  return Array.from({ length: n }, (_, i) => {
    const up = i % 2 === 0;
    return {
      o: px,
      h: px + 0.6,
      l: px - 0.4,
      c: up ? px + 0.1 : px - 0.1,
    };
  });
}

describe("etMinutesOf", () => {
  it("converts epoch seconds to ET minutes (EDT)", () => {
    expect(etMinutesOf(etEpoch(570))).toBe(570); // 09:30 ET
    expect(etMinutesOf(etEpoch(900))).toBe(900); // 15:00 ET
  });
});

describe("computeRegime", () => {
  it("returns null state below the bar minimum — never invents a label", () => {
    expect(computeRegime([]).state).toBeNull();
    expect(computeRegime(mkBars(570, flat(REGIME_MIN_BARS - 1))).state).toBeNull();
    expect(computeRegime([]).confidence).toBe(0);
  });

  it("classifies OPENING_DRIVE in the first 15 minutes", () => {
    const r = computeRegime(mkBars(570, flat(3))); // last bar 09:40 ET
    expect(r.state).toBe("OPENING_DRIVE");
  });

  it("classifies ORB_WINDOW between 09:45 and 10:15 ET", () => {
    const r = computeRegime(mkBars(570, flat(7))); // last bar 10:00 ET
    expect(r.state).toBe("ORB_WINDOW");
  });

  it("classifies POWER_HOUR from 15:00 ET", () => {
    const r = computeRegime(mkBars(840, flat(13))); // last bar 15:00 ET
    expect(r.state).toBe("POWER_HOUR");
  });

  it("classifies a persistent multi-ATR drift as TREND_DAY with a LONG lean", () => {
    // 20 green bars, each closing +0.2 higher; unit range ~1 → drift ≈ 4 ATRs.
    const specs: Spec[] = Array.from({ length: 20 }, (_, i) => ({
      o: 100 + 0.2 * i,
      h: 100 + 0.2 * i + 0.6,
      l: 100 + 0.2 * i - 0.4,
      c: 100.2 + 0.2 * i,
    }));
    const r = computeRegime(mkBars(660, specs)); // midday, ends 12:35 ET
    expect(r.state).toBe("TREND_DAY");
    expect(r.trendBias).toBe("LONG");
  });

  it("classifies alternating closes with no drift as CHOP", () => {
    const specs: Spec[] = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0
        ? { o: 100, h: 100.6, l: 99.4, c: 99.5 }
        : { o: 99.5, h: 100.6, l: 99.4, c: 100 },
    );
    const r = computeRegime(mkBars(660, specs));
    expect(r.state).toBe("CHOP");
    expect(r.trendBias).toBe("NEUTRAL");
  });

  it("classifies a huge last bar on a volume spike as NEWS_SPIKE (overrides time windows)", () => {
    const specs = flat(12);
    specs.push({ o: 100, h: 105.5, l: 100, c: 105, v: 10_000 }); // 5.5-pt bar on 10x volume
    const r = computeRegime(mkBars(570, specs)); // still inside ORB window by clock
    expect(r.state).toBe("NEWS_SPIKE");
  });

  it("classifies faded midday participation as LOW_VOL_AFTERNOON", () => {
    const specs = flat(20).map((s) => ({ ...s, v: 1000 }));
    // mostly one-directional closes so it is not CHOP, but drift stays small
    for (let i = 0; i < specs.length; i++) {
      specs[i].c = specs[i].o + (i % 3 === 0 ? -0.05 : 0.08);
    }
    specs[specs.length - 1].v = 300; // last bar 0.3x the session mean
    const r = computeRegime(mkBars(720, specs)); // ends ~13:35 ET
    expect(r.state).toBe("LOW_VOL_AFTERNOON");
  });

  it("falls back to RANGE_DAY when nothing resolves", () => {
    // moderate persistence (~0.55), small drift, normal volume, midday clock
    const specs: Spec[] = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 || i > 16
        ? { o: 100, h: 100.6, l: 99.4, c: 100.3 }
        : { o: 100.3, h: 100.6, l: 99.4, c: 100 },
    );
    const r = computeRegime(mkBars(660, specs));
    expect(r.state).toBe("RANGE_DAY");
  });

  it("is deterministic: identical bars → identical read", () => {
    const bars = mkBars(660, flat(20));
    expect(computeRegime(bars)).toEqual(computeRegime(bars));
  });
});
