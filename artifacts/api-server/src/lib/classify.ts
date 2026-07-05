/**
 * Stock-class assignment, straight from the validated boundaries in
 * research/findings.md (case study 3): volatility and dollar liquidity — not
 * price — decide which execution engine (if any) has a measured edge.
 *  - rider: avg daily range >= ~6.5% and price >= $20 (HIMS/QBTS/IONQ class;
 *    IONQ validated unseen at PF 1.53). Cheap (<$20) movers failed validation,
 *    so they cap at "caution" no matter how much they move.
 *  - scalper: >= ~$8B/day traded (COIN/TSLA/AMD class; all 3 unseen symbols
 *    validated positive with 1.5R targets).
 *  - caution: mid-range movers (4.5-6.5%/day) where the rider edge decays,
 *    and cheap movers.
 *  - avoid: quiet tape — no engine has a validated long edge.
 */
export type TradeClass = "rider" | "scalper" | "caution" | "avoid";

export function classifyCandidate(
  avgDailyRangePct: number | null,
  dollarVol: number | null,
  price: number,
): { tradeClass: TradeClass | null; classNote: string | null } {
  if (avgDailyRangePct != null && avgDailyRangePct >= 6.5 && price >= 20)
    return { tradeClass: "rider", classNote: "Hyper-volatile mover — Jump-Day Rider class (ride the day, no target)" };
  // Liquidity alone identifies the scalper class, so it must not depend on
  // range stats being available (a large cap with a failed bar fetch is still
  // a large cap).
  if (dollarVol != null && dollarVol >= 8e9)
    return { tradeClass: "scalper", classNote: "Liquid large cap — take-profit scalper class (1.5R targets)" };
  if (avgDailyRangePct == null) return { tradeClass: null, classNote: null };
  if (avgDailyRangePct >= 6.5)
    return { tradeClass: "caution", classNote: "Cheap mover under $20 — class failed validation, no reliable long edge" };
  if (avgDailyRangePct >= 4.5)
    return { tradeClass: "caution", classNote: "Mid-range mover — rider edge decays below ~6.5%/day range" };
  return { tradeClass: "avoid", classNote: "Quiet tape — no validated intraday edge for any engine" };
}
