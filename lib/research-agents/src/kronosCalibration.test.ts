import { describe, it, expect } from "vitest";
import { CALIBRATION_DEFAULTS, calibrationReport, gradeForecast } from "./kronosCalibration";

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

describe("calibrationReport — THE HARD GATE", () => {
  const graded = (pUp: number, up: boolean) => ({
    pUp,
    grade: gradeForecast({ pUp, realizedMovePct: up ? 1 : -1 })!,
  });

  it("passes only with enough samples AND good brier AND hit rate", () => {
    const good = Array.from({ length: 40 }, (_, i) => graded(0.8, i % 10 !== 0)); // 90% up
    const report = calibrationReport(good);
    expect(report.samples).toBe(40);
    expect(report.passed).toBe(true);
    expect(report.hitRate).toBeCloseTo(0.9, 5);
  });

  it("insufficient samples → gated, no matter how good the scores look", () => {
    const few = Array.from({ length: CALIBRATION_DEFAULTS.minSamples - 1 }, () => graded(0.9, true));
    expect(calibrationReport(few).passed).toBe(false);
  });

  it("badly calibrated forecasts stay gated", () => {
    const bad = Array.from({ length: 40 }, () => graded(0.9, false)); // confident and wrong
    const report = calibrationReport(bad);
    expect(report.brier).toBeGreaterThan(CALIBRATION_DEFAULTS.maxBrier);
    expect(report.hitRate).toBe(0);
    expect(report.passed).toBe(false);
  });

  it("reliability buckets compare stated p_up to realized frequency", () => {
    const mixed = [
      ...Array.from({ length: 10 }, (_, i) => graded(0.65, i < 6)), // 0.6 bucket, 60% up
      ...Array.from({ length: 10 }, (_, i) => graded(0.15, i < 2)), // 0.1 bucket, 20% up
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
    expect(report.buckets).toEqual([]);
  });
});
