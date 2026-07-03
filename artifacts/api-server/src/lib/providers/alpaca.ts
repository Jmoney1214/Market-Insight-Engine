/**
 * Alpaca Market Data client (SIP consolidated feed by default).
 *
 * Provides a real-time snapshot (latest trade/quote, prev close) and historical
 * daily bars used to derive technical indicators. Returns null on failure so the
 * report assembler can fall back per-section.
 */
import { alpacaKeyId, alpacaSecretKey, alpacaFeed, hasAlpaca } from "./config.js";
import { logger } from "../logger.js";

const DATA_BASE = "https://data.alpaca.markets/v2/stocks";
const TIMEOUT_MS = 9000;

function headers(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": alpacaKeyId,
    "APCA-API-SECRET-KEY": alpacaSecretKey,
  };
}

async function alpacaGet<T = unknown>(url: URL): Promise<T | null> {
  if (!hasAlpaca) return null;
  try {
    const res = await fetch(url, {
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ url: url.pathname, status: res.status }, "Alpaca request failed");
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.warn({ url: url.pathname, err: String(err) }, "Alpaca request errored");
    return null;
  }
}

export type AlpacaSnapshot = {
  price: number;
  prevClose: number;
  dayHigh: number;
  dayLow: number;
};

export async function getSnapshot(symbol: string): Promise<AlpacaSnapshot | null> {
  const url = new URL(`${DATA_BASE}/${encodeURIComponent(symbol)}/snapshot`);
  url.searchParams.set("feed", alpacaFeed);
  const data = await alpacaGet<Record<string, any>>(url);
  if (!data) return null;
  const price = Number(data["latestTrade"]?.p ?? data["dailyBar"]?.c ?? 0);
  const prevClose = Number(data["prevDailyBar"]?.c ?? data["dailyBar"]?.o ?? 0);
  if (!price) return null;
  return {
    price,
    prevClose,
    dayHigh: Number(data["dailyBar"]?.h ?? 0),
    dayLow: Number(data["dailyBar"]?.l ?? 0),
  };
}

export type AlpacaNewsItem = { title: string; source: string; date: string; url: string };

// Alpaca returns HTML-escaped headline text; decode the common entities.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Company news from Alpaca's news API (paid, no per-request quota wall). */
export async function getNews(symbol: string, limit = 10): Promise<AlpacaNewsItem[] | null> {
  const url = new URL("https://data.alpaca.markets/v1beta1/news");
  url.searchParams.set("symbols", symbol);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "desc");
  const data = await alpacaGet<{ news?: Array<Record<string, any>> }>(url);
  if (!data?.news || data.news.length === 0) return null;
  return data.news.map((n) => ({
    title: decodeEntities(String(n["headline"] ?? "")),
    source: String(n["source"] ?? "Alpaca"),
    date: String(n["created_at"] ?? "").split("T")[0] ?? "",
    url: String(n["url"] ?? ""),
  }));
}

export type DailyBars = {
  closes: number[];
  highs: number[];
  lows: number[];
};

/** Up to ~500 calendar days of daily bars (enough for SMA200 + 52w change). */
export async function getDailyBars(symbol: string): Promise<DailyBars | null> {
  const start = new Date();
  start.setDate(start.getDate() - 500);
  const url = new URL(`${DATA_BASE}/${encodeURIComponent(symbol)}/bars`);
  url.searchParams.set("timeframe", "1Day");
  url.searchParams.set("feed", alpacaFeed);
  url.searchParams.set("adjustment", "split");
  url.searchParams.set("start", start.toISOString().split("T")[0]!);
  url.searchParams.set("limit", "1000");

  const data = await alpacaGet<{ bars?: Array<Record<string, number>> }>(url);
  const bars = data?.bars;
  if (!bars || bars.length === 0) return null;
  return {
    closes: bars.map((b) => Number(b["c"])),
    highs: bars.map((b) => Number(b["h"])),
    lows: bars.map((b) => Number(b["l"])),
  };
}
