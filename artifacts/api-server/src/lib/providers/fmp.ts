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
    return (await res.json()) as T;
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
  if (!rows) return null;
  return rows.map((r) => ({
    fiscalYear: String(r["fiscalYear"] ?? r["date"] ?? ""),
    revenue: Number(r["revenue"] ?? 0),
    eps: Number(r["eps"] ?? 0),
  }));
}

export async function getDcf(symbol: string): Promise<FmpDcf | null> {
  const row = first(await fmpGet<Array<Record<string, unknown>>>("discounted-cash-flow", { symbol }));
  if (!row) return null;
  return { dcf: Number(row["dcf"] ?? 0), price: Number(row["Stock Price"] ?? 0) };
}

export function getPriceTarget(symbol: string): Promise<FmpPriceTarget | null> {
  return fmpGet<FmpPriceTarget[]>("price-target-consensus", { symbol }).then(first);
}

export function getRating(symbol: string): Promise<FmpRating | null> {
  return fmpGet<FmpRating[]>("ratings-snapshot", { symbol }).then(first);
}

export async function getPeers(symbol: string): Promise<string[] | null> {
  const rows = await fmpGet<Array<Record<string, unknown>>>("stock-peers", { symbol });
  if (!rows) return null;
  return rows.map((r) => String(r["symbol"] ?? "")).filter(Boolean);
}

export function getStockNews(symbol: string, limit = 6): Promise<FmpNewsItem[] | null> {
  return fmpGet<FmpNewsItem[]>("news/stock", { symbols: symbol, limit });
}
