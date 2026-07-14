/**
 * Agent Accuracy Ranker — ContestTrade predict-then-top-k over the grade
 * ledger. Agents are ranked by ACCURACY, never profitability (their rule and
 * the system rule): the inputs are verification faithfulness, false-catalyst
 * rate, and Brier calibration of judge confidence against realized
 * significance. No PnL field exists anywhere in this module by design.
 *
 * Agents below the minimum sample count are UNRANKED, never extrapolated.
 */

export interface GradedFindingRow {
  /** Producing agent id (e.g. catalyst-verifier, second-verifier). */
  agent: string;
  /** Ex-ante verification status stamped on the finding. */
  verificationStatus: string;
  /** Judge panel median (0..100), null when unjudged. */
  judgeMedianScore: number | null;
  /** Event-study verdict: did the catalyst move price beyond noise? */
  eventSignificant: boolean | null;
  /** Source-audit admission for the finding's core claim, null when unaudited. */
  claimAdmitted: boolean | null;
}

export interface AgentAccuracy {
  agent: string;
  samples: number;
  /** Share of audited findings whose core claim was admitted (0..1). */
  sourceFaithfulness: number | null;
  /** CONFIRMED ex-ante but insignificant realized — false positives (0..1). */
  falseCatalystRate: number | null;
  /** Brier score of judge confidence vs realized significance (0 best). */
  brier: number | null;
  /** Composite accuracy in [0,1] over available components. */
  accuracyScore: number;
  ranked: boolean;
}

export const MIN_SAMPLES_TO_RANK = 5;

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Per-agent rolling accuracy metrics from graded rows. */
export function scoreAgent(agent: string, rows: GradedFindingRow[]): AgentAccuracy {
  const samples = rows.length;

  const audited = rows.filter((r) => r.claimAdmitted != null);
  const sourceFaithfulness = mean(audited.map((r) => (r.claimAdmitted ? 1 : 0)));

  const confirmed = rows.filter(
    (r) => r.verificationStatus === "CONFIRMED" && r.eventSignificant != null,
  );
  const falseCatalystRate = mean(confirmed.map((r) => (r.eventSignificant ? 0 : 1)));

  const calibratable = rows.filter(
    (r) => r.judgeMedianScore != null && r.eventSignificant != null,
  );
  const brier = mean(
    calibratable.map((r) => (r.judgeMedianScore! / 100 - (r.eventSignificant ? 1 : 0)) ** 2),
  );

  // Composite over the components that exist — missing data narrows the
  // basis, it never counts as a perfect or failing score.
  const components: number[] = [];
  if (sourceFaithfulness != null) components.push(sourceFaithfulness);
  if (falseCatalystRate != null) components.push(1 - falseCatalystRate);
  if (brier != null) components.push(1 - Math.min(1, brier));
  const accuracyScore = components.length > 0 ? mean(components)! : 0;

  return {
    agent,
    samples,
    sourceFaithfulness,
    falseCatalystRate,
    brier,
    accuracyScore,
    ranked: samples >= MIN_SAMPLES_TO_RANK,
  };
}

/**
 * Predict-then-top-k: rank all agents by accuracy; unranked (thin-sample)
 * agents sort after every ranked one regardless of their raw score.
 */
export function rankAgents(rowsByAgent: Map<string, GradedFindingRow[]>): AgentAccuracy[] {
  return [...rowsByAgent.entries()]
    .map(([agent, rows]) => scoreAgent(agent, rows))
    .sort(
      (a, b) =>
        Number(b.ranked) - Number(a.ranked) ||
        b.accuracyScore - a.accuracyScore ||
        b.samples - a.samples ||
        a.agent.localeCompare(b.agent),
    );
}

/** Top-k ranked agents only — thin samples never make the cut. */
export function topKAgents(rowsByAgent: Map<string, GradedFindingRow[]>, k: number): AgentAccuracy[] {
  return rankAgents(rowsByAgent).filter((a) => a.ranked).slice(0, k);
}
