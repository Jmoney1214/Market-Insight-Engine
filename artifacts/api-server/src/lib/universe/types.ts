export type SecurityType =
  | "COMMON" | "ETF" | "FUND" | "WARRANT" | "UNIT" | "PREFERRED" | "ADR" | "UNKNOWN";

export type FloatBucket = "NANO" | "LOW" | "MID" | "HIGH" | "UNKNOWN";

export type IneligibleReason =
  | "NOT_BROKER_TRADABLE" | "NON_COMMON" | "OUT_OF_BAND" | "STALE_QUOTE"
  | "DROPPED_FROM_SCREENER" | null;

export interface ClassifyInput {
  symbol: string;
  fmpIsEtf: boolean;
  fmpIsFund: boolean;
  fmpIsAdr: boolean;
}

export interface EligibilityInput {
  brokerTradable: boolean; // asset present, status active, class us_equity
  exchange: string | null; // normalized NYSE | NASDAQ | AMEX | other
  securityType: SecurityType;
  price: number | null;
  priceIsFresh: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: IneligibleReason;
}

export const ALLOWED_EXCHANGES = ["NYSE", "NASDAQ", "AMEX"] as const;
export const PRICE_MIN = 1;
export const PRICE_MAX = 50;

/** Raw per-symbol inputs from the three bulk sources, pre-joined by symbol. */
export interface AssembleInput {
  symbol: string;
  now: string; // ISO
  // FMP screener row (in-band, priced) — null if the symbol wasn't in the screener.
  screener: {
    name: string; price: number; volume: number; marketCap: number;
    sector: string | null; industry: string | null; exchange: string | null;
    isEtf: boolean; isFund: boolean; isAdr: boolean;
  } | null;
  // Alpaca asset (broker truth) — null if not a tradable us_equity.
  asset: {
    tradable: boolean; status: string; class: string; exchange: string;
    shortable: boolean; easyToBorrow: boolean; marginable: boolean; fractionable: boolean;
  } | null;
  // FMP shares-float — null if unavailable.
  float: { floatShares: number; sharesOutstanding: number } | null;
  isRecentIpo: boolean;
  ipoDate: string | null;
}
