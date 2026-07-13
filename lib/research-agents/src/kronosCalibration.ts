/**
 * Kronos Calibrator — quant-research pattern, pure math.
 *
 * Every forecast is graded against the realized move (hit + Brier). The
 * calibration report aggregates rolling graded forecasts into Brier score,
 * hit rate, and a p_up-decile reliability table. THE HARD GATE: the Desk may
 * render Kronos output only while `passed` is true — insufficient samples or
 * poor calibration means Kronos stays invisible. That gate lives here in
 * code, not in a prompt or a preference.
 */

export interface ForecastGrade {
  /** Direction hit: p_up ≥ 0.5 called up and it closed up (and vice versa). */
  hit: boolean;
  /** Brier score of p_up against the realized up/down outcome (0 best). */
  brier: number;
  realizedUp: boolean;
}

/** Grades one forecast; null on a flat/unknown realized move (never guessed). */
export function gradeForecast(input: { pUp: number; realizedMovePct: number }): ForecastGrade | null {
  if (!Number.isFinite(input.realizedMovePct) || input.realizedMovePct === 0) return null;
  if (!Number.isFinite(input.pUp) || input.pUp < 0 || input.pUp > 1) return null;
  const realizedUp = input.realizedMovePct > 0;
  return {
    realizedUp,
    hit: input.pUp >= 0.5 ? realizedUp : !realizedUp,
    brier: (input.pUp - (realizedUp ? 1 : 0)) ** 2,
  };
}

export interface CalibrationBucket {
  /** Decile label, e.g. "0.6-0.7". */
  bucket: string;
  samples: number;
  meanPUp: number;
  realizedUpRate: number;
}

export interface CalibrationReport {
  samples: number;
  brier: number | null;
  hitRate: number | null;
  buckets: CalibrationBucket[];
  /** THE GATE: samples ≥ minSamples AND brier ≤ maxBrier AND hitRate ≥ minHitRate. */
  passed: boolean;
  thresholds: { minSamples: number; maxBrier: number; minHitRate: number };
}

export const CALIBRATION_DEFAULTS = { minSamples: 30, maxBrier: 0.25, minHitRate: 0.5 };

export function calibrationReport(
  graded: Array<{ pUp: number; grade: ForecastGrade }>,
  thresholds: Partial<typeof CALIBRATION_DEFAULTS> = {},
): CalibrationReport {
  const t = { ...CALIBRATION_DEFAULTS, ...thresholds };
  const samples = graded.length;
  const brier = samples > 0 ? graded.reduce((a, g) => a + g.grade.brier, 0) / samples : null;
  const hitRate = samples > 0 ? graded.filter((g) => g.grade.hit).length / samples : null;

  const buckets: CalibrationBucket[] = [];
  for (let d = 0; d < 10; d++) {
    const lo = d / 10;
    const hi = (d + 1) / 10;
    const inBucket = graded.filter((g) => g.pUp >= lo && (d === 9 ? g.pUp <= hi : g.pUp < hi));
    if (inBucket.length === 0) continue;
    buckets.push({
      bucket: `${lo.toFixed(1)}-${hi.toFixed(1)}`,
      samples: inBucket.length,
      meanPUp: inBucket.reduce((a, g) => a + g.pUp, 0) / inBucket.length,
      realizedUpRate: inBucket.filter((g) => g.grade.realizedUp).length / inBucket.length,
    });
  }

  const passed =
    samples >= t.minSamples && brier != null && brier <= t.maxBrier && hitRate != null && hitRate >= t.minHitRate;

  return { samples, brier, hitRate, buckets, passed, thresholds: t };
}
