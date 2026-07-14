/**
 * Kronos Calibrator — quant-research pattern, pure math.
 *
 * Every forecast is graded against the realized move (hit + Brier). The
 * calibration report aggregates rolling graded forecasts into Brier score,
 * hit rate, a p_up-decile reliability table — and, v2, SKILL measures that a
 * coin-flipper cannot pass:
 *
 *  - Brier Skill Score vs base-rate climatology (Murphy decomposition): an
 *    "always 0.5" forecaster scores Brier exactly 0.25 and BSS exactly 0 —
 *    the gate demands BSS > 0, i.e. strictly better than knowing nothing.
 *  - One-sided binomial test on DAY-CLUSTERED hits: same-morning forecasts
 *    share one regime shock, so days (not forecasts) are the independent
 *    trials. p < 0.05 vs a fair coin is required, and the bar scales with
 *    evidence instead of a fixed 50% line.
 *  - Distinct-day minimum: n forecasts from one morning are one observation.
 *
 * THE HARD GATE: the Desk may render Kronos output only while `passed` is
 * true — insufficient samples, poor calibration, or absence of demonstrated
 * skill means Kronos stays invisible. That gate lives here in code, not in a
 * prompt or a preference.
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

/**
 * One-sided exact binomial: P(X ≥ successes | n trials, p = 0.5).
 * Iterative pmf recurrence — deterministic, no approximation, fine for the
 * day counts a rolling 90-day window can produce.
 */
export function binomialPValue(successes: number, n: number): number | null {
  if (!Number.isInteger(successes) || !Number.isInteger(n) || n <= 0 || successes < 0 || successes > n) {
    return null;
  }
  let pmf = 0.5 ** n; // P(X = 0)
  let tail = successes === 0 ? pmf : 0;
  for (let k = 0; k < n; k++) {
    pmf = (pmf * (n - k)) / (k + 1); // P(X = k+1)
    if (k + 1 >= successes) tail += pmf;
  }
  return Math.min(1, tail);
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
  /** Realized up-rate — the climatology a skill-less forecaster could quote. */
  baseRate: number | null;
  /** Brier Skill Score vs base rate: 0 = no skill, > 0 = real information. */
  bss: number | null;
  /** Distinct anchor days — the independent trials (regime clustering). */
  distinctDays: number;
  /** One-sided binomial p-value of day-clustered hits vs a fair coin. */
  hitPValue: number | null;
  buckets: CalibrationBucket[];
  /**
   * THE GATE: samples ≥ minSamples AND distinctDays ≥ minDistinctDays AND
   * brier ≤ maxBrier AND bss > minBss AND hitPValue < maxPValue.
   */
  passed: boolean;
  thresholds: {
    minSamples: number;
    maxBrier: number;
    minHitRate: number;
    minBss: number;
    maxPValue: number;
    minDistinctDays: number;
  };
}

export const CALIBRATION_DEFAULTS = {
  minSamples: 30,
  maxBrier: 0.25,
  minHitRate: 0.5,
  minBss: 0,
  maxPValue: 0.05,
  minDistinctDays: 20,
};

export interface GradedForecastSample {
  pUp: number;
  grade: ForecastGrade;
  /** Calendar day (YYYY-MM-DD, ET) of the forecast anchor — regime clustering key. */
  anchorDay?: string | null;
}

export function calibrationReport(
  graded: GradedForecastSample[],
  thresholds: Partial<typeof CALIBRATION_DEFAULTS> = {},
): CalibrationReport {
  const t = { ...CALIBRATION_DEFAULTS, ...thresholds };
  const samples = graded.length;
  const brier = samples > 0 ? graded.reduce((a, g) => a + g.grade.brier, 0) / samples : null;
  const hitRate = samples > 0 ? graded.filter((g) => g.grade.hit).length / samples : null;

  // Skill vs climatology. A degenerate window (every realization one way)
  // has reference Brier 0 — skill is unmeasurable there, and unmeasurable
  // skill NEVER opens the gate.
  const baseRate = samples > 0 ? graded.filter((g) => g.grade.realizedUp).length / samples : null;
  const refBrier = baseRate != null ? baseRate * (1 - baseRate) : null;
  const bss = brier != null && refBrier != null && refBrier > 0 ? 1 - brier / refBrier : null;

  // Day-clustered hit test: one trial per distinct anchor day; a day succeeds
  // when its forecasts hit more than they missed (exact ties are excluded —
  // they carry no directional evidence either way).
  const byDay = new Map<string, { hits: number; misses: number }>();
  for (const g of graded) {
    if (!g.anchorDay) continue;
    const day = byDay.get(g.anchorDay) ?? { hits: 0, misses: 0 };
    if (g.grade.hit) day.hits += 1;
    else day.misses += 1;
    byDay.set(g.anchorDay, day);
  }
  const distinctDays = byDay.size;
  const decidedDays = [...byDay.values()].filter((d) => d.hits !== d.misses);
  const successDays = decidedDays.filter((d) => d.hits > d.misses).length;
  const hitPValue = decidedDays.length > 0 ? binomialPValue(successDays, decidedDays.length) : null;

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
    samples >= t.minSamples &&
    distinctDays >= t.minDistinctDays &&
    brier != null &&
    brier <= t.maxBrier &&
    bss != null &&
    bss > t.minBss &&
    hitPValue != null &&
    hitPValue < t.maxPValue;

  return { samples, brier, hitRate, baseRate, bss, distinctDays, hitPValue, buckets, passed, thresholds: t };
}
