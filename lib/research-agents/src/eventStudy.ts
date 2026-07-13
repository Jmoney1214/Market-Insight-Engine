/**
 * Event-Study Grader — ai-hedge-fund CAR engine, pure math.
 *
 * Market-model event study: OLS alpha/beta over an estimation window of
 * (stock, market) daily returns, abnormal return AR_t = r_t − (α + β·m_t)
 * over the event window, CAR = ΣAR, and a t-test against the estimation
 * residual variance. Answers "did the catalyst move the stock beyond noise"
 * with a significance verdict — never an eyeballed judgment.
 *
 * Honesty guards: too-short estimation windows, mismatched series, or a
 * degenerate market series return null — a grade is never fabricated.
 */

export interface MarketModel {
  alpha: number;
  beta: number;
  /** Std deviation of estimation-window residuals (the noise yardstick). */
  residualStd: number;
  estimationDays: number;
}

export const MIN_ESTIMATION_DAYS = 30;

/** Simple returns from a close series; length = closes.length − 1. */
export function toReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    if (prev <= 0) return [];
    out.push(closes[i]! / prev - 1);
  }
  return out;
}

/** OLS market model over aligned return series; null when unestimable. */
export function fitMarketModel(stockReturns: number[], marketReturns: number[]): MarketModel | null {
  const n = stockReturns.length;
  if (n < MIN_ESTIMATION_DAYS || n !== marketReturns.length) return null;

  const meanS = stockReturns.reduce((a, b) => a + b, 0) / n;
  const meanM = marketReturns.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varM = 0;
  for (let i = 0; i < n; i++) {
    cov += (stockReturns[i]! - meanS) * (marketReturns[i]! - meanM);
    varM += (marketReturns[i]! - meanM) ** 2;
  }
  // Flat market series cannot identify beta. Epsilon, not ===0: float
  // summation leaves ~1e-35 residue on a constant series, while genuine
  // daily-return variance sits many orders of magnitude above 1e-16.
  if (varM < 1e-16) return null;

  const beta = cov / varM;
  const alpha = meanS - beta * meanM;

  let ssr = 0;
  for (let i = 0; i < n; i++) {
    const residual = stockReturns[i]! - (alpha + beta * marketReturns[i]!);
    ssr += residual ** 2;
  }
  // Two parameters estimated → n−2 degrees of freedom.
  const residualStd = Math.sqrt(ssr / (n - 2));
  return { alpha, beta, residualStd, estimationDays: n };
}

export interface EventStudyResult {
  alpha: number;
  beta: number;
  estimationDays: number;
  eventDays: number;
  /** Per-day abnormal returns over the event window. */
  abnormalReturns: number[];
  /** Cumulative abnormal return over the event window (decimal). */
  car: number;
  /** CAR / (residualStd · √eventDays). */
  tStat: number;
  /** |t| ≥ 1.96 — the move exceeded market-model noise at ~95%. */
  significant: boolean;
}

/**
 * Full event study. `estimation*` series end BEFORE the event; `event*`
 * series cover the event window. Null when the model is unestimable or the
 * event window is empty/mismatched — never a guessed verdict.
 */
export function eventStudy(input: {
  estimationStockReturns: number[];
  estimationMarketReturns: number[];
  eventStockReturns: number[];
  eventMarketReturns: number[];
}): EventStudyResult | null {
  const model = fitMarketModel(input.estimationStockReturns, input.estimationMarketReturns);
  if (!model) return null;
  const k = input.eventStockReturns.length;
  if (k === 0 || k !== input.eventMarketReturns.length) return null;
  if (model.residualStd === 0) return null; // perfectly-fit estimation → no noise yardstick

  const abnormalReturns = input.eventStockReturns.map(
    (r, i) => r - (model.alpha + model.beta * input.eventMarketReturns[i]!),
  );
  const car = abnormalReturns.reduce((a, b) => a + b, 0);
  const tStat = car / (model.residualStd * Math.sqrt(k));

  return {
    alpha: model.alpha,
    beta: model.beta,
    estimationDays: model.estimationDays,
    eventDays: k,
    abnormalReturns,
    car,
    tStat,
    significant: Math.abs(tStat) >= 1.96,
  };
}

/**
 * Convenience: run an event study from two dated close series and an event
 * date. Estimation = returns strictly before the event date (capped at
 * `estimationDays`); event window = first `eventDays` returns from the event
 * date onward. Series must share the same trading-day dates.
 */
export function eventStudyFromCloses(input: {
  stock: Array<{ date: string; close: number }>;
  market: Array<{ date: string; close: number }>;
  eventDate: string;
  eventDays?: number;
  estimationDays?: number;
}): EventStudyResult | null {
  const marketByDate = new Map(input.market.map((b) => [b.date, b.close]));
  const aligned = input.stock.filter((b) => marketByDate.has(b.date));
  if (aligned.length < MIN_ESTIMATION_DAYS + 2) return null;

  const stockCloses = aligned.map((b) => b.close);
  const marketCloses = aligned.map((b) => marketByDate.get(b.date)!);
  const stockReturns = toReturns(stockCloses);
  const marketReturns = toReturns(marketCloses);
  if (stockReturns.length === 0) return null;
  // Return i spans aligned[i] → aligned[i+1]; its date is aligned[i+1].date.
  const returnDates = aligned.slice(1).map((b) => b.date);

  const eventIdx = returnDates.findIndex((d) => d >= input.eventDate);
  if (eventIdx === -1) return null;

  const estWindow = Math.min(eventIdx, input.estimationDays ?? 120);
  const evWindow = Math.min(returnDates.length - eventIdx, input.eventDays ?? 3);

  return eventStudy({
    estimationStockReturns: stockReturns.slice(eventIdx - estWindow, eventIdx),
    estimationMarketReturns: marketReturns.slice(eventIdx - estWindow, eventIdx),
    eventStockReturns: stockReturns.slice(eventIdx, eventIdx + evWindow),
    eventMarketReturns: marketReturns.slice(eventIdx, eventIdx + evWindow),
  });
}
