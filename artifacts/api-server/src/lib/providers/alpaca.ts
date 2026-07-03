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
  /** Close of the last fully completed session (pre/post-market-aware gap reference). */
  prevClose: number;
  dayHigh: number;
  dayLow: number;
  sessionOpen: number | null;
  sessionVwap: number | null;
  sessionVolume: number | null;
  /** True when the daily bar belongs to the same calendar day as the latest trade (live session). */
  sessionIsToday: boolean;
};

export async function getSnapshot(symbol: string): Promise<AlpacaSnapshot | null> {
  const url = new URL(`${DATA_BASE}/${encodeURIComponent(symbol)}/snapshot`);
  url.searchParams.set("feed", alpacaFeed);
  const data = await alpacaGet<Record<string, any>>(url);
  if (!data) return null;
  const trade = data["latestTrade"];
  const daily = data["dailyBar"];
  const prevDaily = data["prevDailyBar"];
  const price = Number(trade?.p ?? daily?.c ?? 0);
  if (!price) return null;
  // Same convention as getSnapshots: pre-market (trade on a newer day than the
  // last daily bar) gaps against that bar's close; intraday against prev session.
  const tradeDay = String(trade?.t ?? "").slice(0, 10);
  const barDay = String(daily?.t ?? "").slice(0, 10);
  const sessionIsToday = tradeDay !== "" && tradeDay === barDay;
  const prevClose = Number(tradeDay > barDay ? daily?.c : prevDaily?.c ?? daily?.o) || 0;
  if (!prevClose) return null;
  return {
    price,
    prevClose,
    dayHigh: Number(daily?.h ?? 0),
    dayLow: Number(daily?.l ?? 0),
    sessionOpen: daily?.o != null ? Number(daily.o) : null,
    sessionVwap: daily?.vw != null ? Number(daily.vw) : null,
    sessionVolume: daily?.v != null ? Number(daily.v) : null,
    sessionIsToday,
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

export type BatchSnapshot = {
  symbol: string;
  /** Latest trade price (includes pre/post-market on SIP). */
  price: number;
  /** Close of the last fully completed session (gap reference). */
  refClose: number;
  /** % move vs the last completed session close. */
  gapPct: number;
  lastTradeAt: string;
};

/**
 * Batch snapshots for many symbols (chunked). Gap reference is pre/post-market
 * aware: when the latest trade is on a newer calendar day than the last daily
 * bar (pre-market), the gap is vs that bar's close; intraday it is vs the
 * previous session's close.
 */
export async function getSnapshots(symbols: string[]): Promise<Map<string, BatchSnapshot> | null> {
  const out = new Map<string, BatchSnapshot>();
  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100);
    const url = new URL(`${DATA_BASE}/snapshots`);
    url.searchParams.set("symbols", chunk.join(","));
    url.searchParams.set("feed", alpacaFeed);
    const data = await alpacaGet<Record<string, any>>(url);
    if (!data) continue;
    for (const [sym, s] of Object.entries(data)) {
      const trade = s?.["latestTrade"];
      const daily = s?.["dailyBar"];
      const prevDaily = s?.["prevDailyBar"];
      const price = Number(trade?.p ?? daily?.c ?? 0);
      if (!price) continue;
      const tradeDay = String(trade?.t ?? "").slice(0, 10);
      const barDay = String(daily?.t ?? "").slice(0, 10);
      const refClose = Number(tradeDay > barDay ? daily?.c : prevDaily?.c ?? daily?.c) || 0;
      if (!refClose) continue;
      out.set(sym, {
        symbol: sym,
        price,
        refClose,
        gapPct: ((price - refClose) / refClose) * 100,
        lastTradeAt: String(trade?.t ?? ""),
      });
    }
  }
  return out.size > 0 ? out : null;
}

/** One news call covering many symbols; returns headline map keyed by symbol. */
export async function getNewsMulti(symbols: string[], limit = 50): Promise<Map<string, string> | null> {
  if (symbols.length === 0) return null;
  const url = new URL("https://data.alpaca.markets/v1beta1/news");
  url.searchParams.set("symbols", symbols.slice(0, 100).join(","));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "desc");
  const data = await alpacaGet<{ news?: Array<Record<string, any>> }>(url);
  if (!data?.news) return null;
  const map = new Map<string, string>();
  for (const n of data.news) {
    for (const sym of (n["symbols"] ?? []) as string[]) {
      if (!map.has(sym)) map.set(sym, String(n["headline"] ?? ""));
    }
  }
  return map;
}

export type DailyBars = {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
};

/** Daily bars for the last `days` calendar days (default ~500, enough for SMA200 + 52w). */
export async function getDailyBars(symbol: string, days = 500): Promise<DailyBars | null> {
  const start = new Date();
  start.setDate(start.getDate() - days);
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
    volumes: bars.map((b) => Number(b["v"])),
  };
}
