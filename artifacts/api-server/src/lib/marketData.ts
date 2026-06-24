export class MarketDataError extends Error {
  constructor(
    message: string,
    public readonly status: number = 502,
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

export interface MarketData {
  companyName: string | null;
  exchange: string | null;
  currency: string | null;
  price: number;
  change1d: number;
  change52w: number;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  technical: {
    rsi: number | null;
    ma50: number | null;
    ma200: number | null;
    supportLevel: number | null;
    resistanceLevel: number | null;
    goldenCross: boolean | null;
    trend: "Bullish" | "Bearish" | "Mixed";
  };
}

interface YahooChartMeta {
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  longName?: string;
  shortName?: string;
  fullExchangeName?: string;
  exchangeName?: string;
  currency?: string;
}

function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function computeRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const recent = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < recent.length; i += 1) {
    const diff = recent[i] - recent[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Fetches live quote data and computes technical indicators from Yahoo Finance's
 * public chart endpoint (no API key required). Throws MarketDataError when the
 * ticker is unknown or the upstream is unavailable — never returns fabricated data.
 */
export async function fetchMarketData(ticker: string): Promise<MarketData> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker,
  )}?range=1y&interval=1d`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (FinDesk research client)" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new MarketDataError("Market data provider is currently unreachable.", 503);
  }

  if (res.status === 404) {
    throw new MarketDataError(`No market data found for "${ticker}".`, 404);
  }
  if (!res.ok) {
    throw new MarketDataError("Market data provider returned an error.", 502);
  }

  type YahooChartResponse = {
    chart?: {
      result?: Array<{
        meta?: YahooChartMeta;
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
      error?: { description?: string } | null;
    };
  };
  let json: YahooChartResponse;
  try {
    json = (await res.json()) as YahooChartResponse;
  } catch {
    throw new MarketDataError("Market data provider returned an invalid response.", 502);
  }

  const result = json.chart?.result?.[0];
  if (!result || json.chart?.error) {
    throw new MarketDataError(`No market data found for "${ticker}".`, 404);
  }

  const meta = result.meta ?? {};
  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter(
    (c): c is number => typeof c === "number" && Number.isFinite(c),
  );

  const lastClose = closes.length > 0 ? closes[closes.length - 1] : undefined;
  const price = meta.regularMarketPrice ?? lastClose;
  if (typeof price !== "number" || !Number.isFinite(price)) {
    throw new MarketDataError(`No quote available for "${ticker}".`, 404);
  }

  const prevClose =
    closes.length >= 2 ? closes[closes.length - 2] : meta.previousClose ?? meta.chartPreviousClose;
  const change1d =
    typeof prevClose === "number" && prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : 0;

  const firstClose = closes.length > 0 ? closes[0] : undefined;
  const change52w =
    typeof firstClose === "number" && firstClose !== 0
      ? ((price - firstClose) / firstClose) * 100
      : 0;

  const ma50 = closes.length >= 50 ? average(closes.slice(-50)) : null;
  const ma200 = closes.length >= 200 ? average(closes.slice(-200)) : null;
  const rsi = computeRsi(closes);

  const recentWindow = closes.slice(-60);
  const supportLevel = recentWindow.length > 0 ? Math.min(...recentWindow) : null;
  const resistanceLevel = recentWindow.length > 0 ? Math.max(...recentWindow) : null;

  const goldenCross = ma50 != null && ma200 != null ? ma50 > ma200 : null;

  let trend: "Bullish" | "Bearish" | "Mixed" = "Mixed";
  if (ma50 != null && ma200 != null) {
    if (price > ma50 && ma50 > ma200) trend = "Bullish";
    else if (price < ma50 && ma50 < ma200) trend = "Bearish";
  } else if (ma50 != null) {
    trend = price > ma50 ? "Bullish" : "Bearish";
  }

  return {
    companyName: meta.longName ?? meta.shortName ?? null,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
    currency: meta.currency ?? null,
    price: round(price),
    change1d: round(change1d),
    change52w: round(change52w),
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh != null ? round(meta.fiftyTwoWeekHigh) : null,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow != null ? round(meta.fiftyTwoWeekLow) : null,
    technical: {
      rsi: rsi != null ? round(rsi, 1) : null,
      ma50: ma50 != null ? round(ma50) : null,
      ma200: ma200 != null ? round(ma200) : null,
      supportLevel: supportLevel != null ? round(supportLevel) : null,
      resistanceLevel: resistanceLevel != null ? round(resistanceLevel) : null,
      goldenCross,
      trend,
    },
  };
}
