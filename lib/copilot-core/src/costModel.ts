/**
 * Deterministic transaction-cost decomposition + post-trade slippage
 * (AgenticTrading pattern: costs are typed code, never an LLM opinion).
 *
 * Rules:
 * - pure functions, no I/O, no randomness;
 * - annotation-only: cost numbers inform the human and the grading loop,
 *   they never gate or block anything;
 * - every result carries its component breakdown so grading can attribute
 *   the gap between paper and reality per term.
 */

export interface CostInputs {
  /** Reference price (mid or last). */
  price: number;
  /** Quoted spread in basis points (ask-bid over mid). */
  spreadBp: number;
  /** Average daily share volume (liquidity reference). */
  avgDailyVolume: number;
  /** Intended order size in shares. */
  orderShares: number;
  /** Per-share commission/fees in USD (default 0). */
  feePerShareUsd?: number;
}

export interface CostEstimate {
  /** Half-spread paid crossing once (per side). */
  spreadCostBp: number;
  /** Square-root market-impact term (per side). */
  impactBp: number;
  /** Fees converted to bp of notional (per side). */
  feesBp: number;
  /** Expected one-way cost. */
  perSideBp: number;
  /** Expected round-trip cost (enter + exit). */
  roundTripBp: number;
  /** Round-trip cost in USD for the given order. */
  roundTripUsd: number;
  /** Order size as a fraction of average daily volume. */
  participation: number;
}

/** Square-root impact coefficient, in bp at 100% ADV participation. */
export const IMPACT_COEF_BP = 90;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function estimateTransactionCost(i: CostInputs): CostEstimate | null {
  if (!(i.price > 0) || !(i.orderShares > 0) || !(i.avgDailyVolume > 0) || i.spreadBp < 0) return null;
  const participation = i.orderShares / i.avgDailyVolume;
  const spreadCostBp = i.spreadBp / 2;
  const impactBp = IMPACT_COEF_BP * Math.sqrt(participation);
  const feesBp = ((i.feePerShareUsd ?? 0) / i.price) * 10_000;
  const perSideBp = spreadCostBp + impactBp + feesBp;
  const roundTripBp = 2 * perSideBp;
  const notional = i.price * i.orderShares;
  return {
    spreadCostBp: round2(spreadCostBp),
    impactBp: round2(impactBp),
    feesBp: round2(feesBp),
    perSideBp: round2(perSideBp),
    roundTripBp: round2(roundTripBp),
    roundTripUsd: round2((roundTripBp / 10_000) * notional),
    participation: Math.round(participation * 1e6) / 1e6,
  };
}

export interface SlippageInputs {
  side: "BUY" | "SELL";
  /** Price at decision time (what the paper ledger assumes). */
  expectedPrice: number;
  /** Actual fill price from the journal. */
  fillPrice: number;
  shares: number;
  /** The model's expected per-side cost for this order, if computed. */
  expectedPerSideBp?: number | null;
}

export interface SlippageResult {
  /** Positive = you paid more (BUY) / received less (SELL) than expected. */
  slippageBp: number;
  slippageUsd: number;
  /** Realized minus modeled — positive means worse than the cost model predicted. */
  vsModelBp: number | null;
}

export function analyzeSlippage(i: SlippageInputs): SlippageResult | null {
  if (!(i.expectedPrice > 0) || !(i.fillPrice > 0) || !(i.shares > 0)) return null;
  const raw = ((i.fillPrice - i.expectedPrice) / i.expectedPrice) * 10_000;
  const slippageBp = round2(i.side === "BUY" ? raw : -raw);
  const slippageUsd = round2((slippageBp / 10_000) * i.expectedPrice * i.shares);
  const vsModelBp = i.expectedPerSideBp == null ? null : round2(slippageBp - i.expectedPerSideBp);
  return { slippageBp, slippageUsd, vsModelBp };
}
