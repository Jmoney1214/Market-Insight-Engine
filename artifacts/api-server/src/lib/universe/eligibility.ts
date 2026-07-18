import type { ClassifyInput, SecurityType, FloatBucket, IneligibleReason } from "./types.js";

/** Suffix after the class separator (".", "-") that marks a non-common form. */
const NON_COMMON_SUFFIX = /[.\-](WS|WT|W|R|U|RT|P[A-Z]?)$/;

/**
 * Deterministic security-type classification. FMP flags are authoritative for
 * ETF/fund/ADR; symbol-suffix heuristics catch warrants/units/rights/preferred.
 * Single-letter share-class suffixes (A/B/C — e.g. BRK.B) are COMMON.
 */
export function classifySecurityType(input: ClassifyInput): SecurityType {
  if (input.fmpIsEtf) return "ETF";
  if (input.fmpIsFund) return "FUND";
  const m = input.symbol.toUpperCase().match(NON_COMMON_SUFFIX);
  if (m) {
    const suf = m[1]!;
    if (suf.startsWith("P")) return "PREFERRED";
    if (suf === "U") return "UNIT";
    return "WARRANT"; // W/WS/WT/R/RT — warrant/rights family
  }
  if (input.fmpIsAdr) return "ADR";
  return "COMMON";
}
