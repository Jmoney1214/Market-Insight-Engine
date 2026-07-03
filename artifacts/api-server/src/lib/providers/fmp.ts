/**
 * Financial Modeling Prep (FMP) "stable" API client.
 *
 * Each function returns typed-ish, null-safe data or `null` on failure, so the
 * report assembler can fall back per-section. Field access is defensive because
 * FMP occasionally renames fields between API tiers.
 */
import { fmpApiKey } from "./config.js";
import { logger } from "../logger.js";

const BASE = "https://financialmodelingprep.com/stable";
const TIMEOUT_MS = 9000;

async function fmpGet<T = unknown>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T | null> {
  if (!fmpApiKey) return null;
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("apikey", fmpApiKey);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      logger.warn({ path, status: res.status }, "FMP request failed");
      return null;
    }
    const data = await res.json();
    // FMP can return 200 OK with an error payload (e.g. {"Error Message": "..."})
    // on rate limits / key issues. Treat these as failures so downstream array
    // operations don't throw and the section degrades gracefully.
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      if ("Error Message" in obj || "error" in obj) {
        logger.warn({ path, error: obj["Error Message"] ?? obj["error"] }, "FMP returned API error");
        return null;
      }
    }
    return data as T;
  } catch (err) {
    logger.warn({ path, err: String(err) }, "FMP request errored");
    return null;
  }
}

function first<T>(v: T[] | null): T | null {
  return Array.isArray(v) && v.length > 0 ? v[0]! : null;
}

export type FmpQuote = {
  price: number;
  change: number;
  changePercentage: number;
  marketCap: number;
  yearHigh: number;
  yearLow: number;
  priceAvg50: number;
  priceAvg200: number;
  exchange: string;
  previousClose: number;
};

export type FmpProfile = {
  companyName: string;
  sector: string;
  industry: string;
  description: string;
  fullTimeEmployees: string;
  exchangeFullName: string;
  exchange: string;
  city: string;
  state: string;
  ipoDate: string;
  ceo: string;
};

export type FmpRatios = Record<string, number>;
export type FmpKeyMetrics = Record<string, number>;
export type FmpIncome = {
  fiscalYear: string;
  revenue: number;
  eps: number;
};
export type FmpDcf = { dcf: number; price: number };
export type FmpPriceTarget = {
  targetHigh: number;
  targetLow: number;
  targetConsensus: number;
  targetMedian: number;
};
export type FmpRating = { rating: string; overallScore: number };
export type FmpPeer = { symbol: string };
export type FmpNewsItem = {
  title: string;
  publisher: string;
  publishedDate: string;
};

export function getQuote(symbol: string): Promise<FmpQuote | null> {
  return fmpGet<FmpQuote[]>("quote", { symbol }).then(first);
}

export function getProfile(symbol: string): Promise<FmpProfile | null> {
  return fmpGet<FmpProfile[]>("profile", { symbol }).then(first);
}

export function getRatiosTtm(symbol: string): Promise<FmpRatios | null> {
  return fmpGet<FmpRatios[]>("ratios-ttm", { symbol }).then(first);
}

export function getKeyMetricsTtm(symbol: string): Promise<FmpKeyMetrics | null> {
  return fmpGet<FmpKeyMetrics[]>("key-metrics-ttm", { symbol }).then(first);
}

export async function getIncomeStatements(symbol: string): Promise<FmpIncome[] | null> {
  const rows = await fmpGet<Array<Record<string, unknown>>>("income-statement", {
    symbol,
    period: "annual",
    limit: 5,
  });
  if (!Array.isArray(rows)) return null;
  return rows.map((r) => ({
    fiscalYear: String(r["fiscalYear"] ?? r["date"] ?? ""),
    revenue: Number(r["revenue"] ?? 0),
    eps: Number(r["eps"] ?? 0),
  }));
}

export async function getDcf(symbol: string): Promise<FmpDcf | null> {
  const row = first(await fmpGet<Array<Record<string, unknown>>>("discounted-cash-flow", { symbol }));
  if (!row) return null;
  const dcf = Number(row["dcf"] ?? 0);
  // Guard against zero/invalid DCF — downstream divides by this value.
  if (!Number.isFinite(dcf) || dcf <= 0) return null;
  return { dcf, price: Number(row["Stock Price"] ?? 0) };
}

export function getPriceTarget(symbol: string): Promise<FmpPriceTarget | null> {
  return fmpGet<FmpPriceTarget[]>("price-target-consensus", { symbol }).then(first);
}

export function getRating(symbol: string): Promise<FmpRating | null> {
  return fmpGet<FmpRating[]>("ratings-snapshot", { symbol }).then(first);
}

export async function getPeers(symbol: string): Promise<string[] | null> {
  const rows = await fmpGet<Array<Record<string, unknown>>>("stock-peers", { symbol });
  if (!Array.isArray(rows)) return null;
  return rows.map((r) => String(r["symbol"] ?? "")).filter(Boolean);
}

export async function getStockNews(symbol: string, limit = 6): Promise<FmpNewsItem[] | null> {
  const rows = await fmpGet<FmpNewsItem[]>("news/stock", { symbols: symbol, limit });
  return Array.isArray(rows) ? rows : null;
}

export type FmpBalanceSheet = {
  fiscalYear: string;
  totalAssets: number;
  totalDebt: number;
  netDebt: number;
  cashAndShortTermInvestments: number;
  totalEquity: number;
};

export async function getBalanceSheet(symbol: string): Promise<FmpBalanceSheet | null> {
  const r = first(await fmpGet<Array<Record<string, unknown>>>("balance-sheet-statement", { symbol, period: "annual", limit: 1 }));
  if (!r) return null;
  return {
    fiscalYear: String(r["fiscalYear"] ?? r["date"] ?? ""),
    totalAssets: Number(r["totalAssets"] ?? 0),
    totalDebt: Number(r["totalDebt"] ?? 0),
    netDebt: Number(r["netDebt"] ?? 0),
    cashAndShortTermInvestments: Number(r["cashAndShortTermInvestments"] ?? 0),
    totalEquity: Number(r["totalStockholdersEquity"] ?? r["totalEquity"] ?? 0),
  };
}

export type FmpCashFlow = {
  fiscalYear: string;
  operatingCashFlow: number;
  capitalExpenditure: number;
  freeCashFlow: number;
  dividendsPaid: number;
  stockBuybacks: number;
};

export async function getCashFlow(symbol: string): Promise<FmpCashFlow | null> {
  const r = first(await fmpGet<Array<Record<string, unknown>>>("cash-flow-statement", { symbol, period: "annual", limit: 1 }));
  if (!r) return null;
  return {
    fiscalYear: String(r["fiscalYear"] ?? r["date"] ?? ""),
    operatingCashFlow: Number(r["operatingCashFlow"] ?? r["netCashProvidedByOperatingActivities"] ?? 0),
    capitalExpenditure: Number(r["capitalExpenditure"] ?? 0),
    freeCashFlow: Number(r["freeCashFlow"] ?? 0),
    dividendsPaid: Number(r["netDividendsPaid"] ?? r["commonDividendsPaid"] ?? 0),
    stockBuybacks: Number(r["commonStockRepurchased"] ?? 0),
  };
}

export type FmpRatingsSummary = {
  consensus: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
};

export async function getRatingsSummary(symbol: string): Promise<FmpRatingsSummary | null> {
  const r = first(await fmpGet<Array<Record<string, unknown>>>("grades-consensus", { symbol }));
  if (!r) return null;
  return {
    consensus: String(r["consensus"] ?? ""),
    strongBuy: Number(r["strongBuy"] ?? 0),
    buy: Number(r["buy"] ?? 0),
    hold: Number(r["hold"] ?? 0),
    sell: Number(r["sell"] ?? 0),
    strongSell: Number(r["strongSell"] ?? 0),
  };
}

export type FmpEstimate = { fiscalYear: string; revenueAvg: number; epsAvg: number };

/** Analyst estimates — gated behind a higher FMP tier; returns null gracefully if denied. */
export async function getEstimates(symbol: string): Promise<FmpEstimate | null> {
  const r = first(await fmpGet<Array<Record<string, unknown>>>("analyst-estimates", { symbol, period: "annual", limit: 1 }));
  if (!r) return null;
  return {
    fiscalYear: String(r["fiscalYear"] ?? r["date"] ?? ""),
    revenueAvg: Number(r["revenueAvg"] ?? r["estimatedRevenueAvg"] ?? 0),
    epsAvg: Number(r["epsAvg"] ?? r["estimatedEpsAvg"] ?? 0),
  };
}
