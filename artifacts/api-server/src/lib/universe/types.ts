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
