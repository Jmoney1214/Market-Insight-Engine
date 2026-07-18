export type SecurityType =
  | "COMMON" | "ETF" | "FUND" | "WARRANT" | "UNIT" | "PREFERRED" | "ADR" | "UNKNOWN";

export type FloatBucket = "NANO" | "LOW" | "MID" | "HIGH" | "UNKNOWN";

export type IneligibleReason =
  | "NOT_BROKER_TRADABLE" | "NON_COMMON" | "OUT_OF_BAND" | "STALE_QUOTE" | null;

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
