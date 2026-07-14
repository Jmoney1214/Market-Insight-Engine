import { describe, it, expect } from "vitest";
import {
  CALIBRATION_DEFAULTS,
  binomialPValue,
  calibrationReport,
  gradeForecast,
} from "./kronosCalibration";

describe("gradeForecast", () => {
  it("direction hit and Brier from p_up vs the realized move", () => {
    expect(gradeForecast({ pUp: 0.8, realizedMovePct: 2.0 })).toEqual({
      realizedUp: true,
      hit: true,
      brier: expect.closeTo(0.04, 5),
    });
    expect(gradeForecast({ pUp: 0.8, realizedMovePct: -1.0 })).toEqual({
      realizedUp: false,
      hit: false,
      brier: expect.closeTo(0.64, 5),
    });
    expect(gradeForecast({ pUp: 0.3, realizedMovePct: -1.0 })!.hit).toBe(true);
  });

  it("flat or invalid inputs are ungradable — never guessed", () => {
    expect(gradeForecast({ pUp: 0.8, realizedMovePct: 0 })).toBeNull();
    expect(gradeForecast({ pUp: 1.2, realizedMovePct: 1 })).toBeNull();
    expect(gradeForecast({ pUp: NaN, realizedMovePct: 1 })).toBeNull();
  });
});

describe("binomialPValue (one-sided, exact)", () => {
  it("matches hand-computed tails", () => {
    expect(binomialPValue(15, 20)).toBeCloseTo(21700 / 1048576, 8); // ≈ 0.0207
    expect(binomialPValue(14, 20)).toBeCloseTo(60460 / 1048576, 8); // ≈ 0.0577
    expect(binomialPValue(20, 40)).toBeCloseTo(0.5627, 3);
    expect(binomialPValue(0, 10)).toBe(1);
  });

  it("rejects invalid inputs", () => {
    expect(binomialPValue(-1, 10)).toBeNull();
    expect(binomialPValue(11, 10)).toBeNull();
    expect(binomialPValue(5, 0)).toBeNull();
    expect(binomialPValue(2.5, 10)).toBeNull();
  });
});

describe("calibrationReport — THE HARD GATE (v2: skill, not scores)", () => {
  const day = (i: number) => `2026-06-${String((i % 28) + 1).padStart(2, "0")}`;
  const graded = (pUp: number, up: boolean, anchorDay: string) => ({
    pUp,
    grade: gradeForecast({ pUp, realizedMovePct: up ? 1 : -1 })!,
    anchorDay,
  });

  /** Genuinely discriminating: confident-and-right on every one of 28 days. */
  const skilled = (n = 40) =>
    Array.from({ length: n }, (_, i) => {
      const up = i % 5 !== 0; // 80% up base — skill must beat climatology, and does
      return graded(up ? 0.85 : 0.15, up, day(i));
    });

  it("a genuinely skilled forecaster passes", () => {
    const report = calibrationReport(skilled());
    expect(report.samples).toBe(40);
    expect(report.distinctDays).toBe(28);
    expect(report.bss).toBeGreaterThan(0);
    expect(report.hitPValue).toBeLessThan(0.05);
    expect(report.passed).toBe(true);
  });

  it("ADVERSARY: an always-0.5 coin-flipper fails (BSS = 0, no directional evidence)", () => {
    const flipper = Array.from({ length: 40 }, (_, i) => graded(0.5, i % 2 === 0, day(i)));
    const report = calibrationReport(flipper);
    expect(report.brier).toBeCloseTo(0.25, 5); // would have PASSED the old flat cap
    expect(report.bss).toBeCloseTo(0, 5);
    expect(report.passed).toBe(false);
  });

  it("ADVERSARY: a 0.51-mush forecaster fails", () => {
    const mush = Array.from({ length: 40 }, (_, i) => graded(0.51, i % 2 === 0, day(i)));
    const report = calibrationReport(mush);
    expect(report.bss).toBeLessThan(0);
    expect(report.passed).toBe(false);
  });

  it("ADVERSARY: perfect scores from a single morning fail — one regime is one observation", () => {
    const oneDay = Array.from({ length: 60 }, (_, i) =>
      graded(i % 2 === 0 ? 0.9 : 0.1, i % 2 === 0, "2026-06-01"),
    );
    const report = calibrationReport(oneDay);
    expect(report.distinctDays).toBe(1);
    expect(report.passed).toBe(false);
  });

  it("degenerate window (every day one direction) → skill unmeasurable → gated", () => {
    const allUp = Array.from({ length: 40 }, (_, i) => graded(1.0, true, day(i)));
    const report = calibrationReport(allUp);
    expect(report.brier).toBe(0);
    expect(report.bss).toBeNull(); // reference Brier is 0 — no climatology to beat
    expect(report.passed).toBe(false);
  });

  it("samples without day provenance cannot open the gate", () => {
    const undated = skilled().map(({ pUp, grade }) => ({ pUp, grade }));
    const report = calibrationReport(undated);
    expect(report.distinctDays).toBe(0);
    expect(report.hitPValue).toBeNull();
    expect(report.passed).toBe(false);
  });

  it("insufficient samples → gated, no matter how good the scores look", () => {
    const few = skilled(CALIBRATION_DEFAULTS.minSamples - 1);
    expect(calibrationReport(few).passed).toBe(false);
  });

  it("badly calibrated forecasts stay gated", () => {
    const bad = Array.from({ length: 40 }, (_, i) => graded(0.9, false, day(i))); // confident and wrong
    const report = calibrationReport(bad);
    expect(report.brier).toBeGreaterThan(CALIBRATION_DEFAULTS.maxBrier);
    expect(report.hitRate).toBe(0);
    expect(report.passed).toBe(false);
  });

  it("reliability buckets compare stated p_up to realized frequency", () => {
    const mixed = [
      ...Array.from({ length: 10 }, (_, i) => graded(0.65, i < 6, day(i))), // 0.6 bucket, 60% up
      ...Array.from({ length: 10 }, (_, i) => graded(0.15, i < 2, day(i + 10))), // 0.1 bucket, 20% up
    ];
    const report = calibrationReport(mixed);
    const bucket6 = report.buckets.find((b) => b.bucket === "0.6-0.7")!;
    expect(bucket6.samples).toBe(10);
    expect(bucket6.realizedUpRate).toBeCloseTo(0.6, 5);
    const bucket1 = report.buckets.find((b) => b.bucket === "0.1-0.2")!;
    expect(bucket1.realizedUpRate).toBeCloseTo(0.2, 5);
  });

  it("zero samples → gated with null metrics, never fabricated", () => {
    const report = calibrationReport([]);
    expect(report.passed).toBe(false);
    expect(report.brier).toBeNull();
    expect(report.hitRate).toBeNull();
    expect(report.baseRate).toBeNull();
    expect(report.bss).toBeNull();
    expect(report.distinctDays).toBe(0);
    expect(report.buckets).toEqual([]);
  });
});
