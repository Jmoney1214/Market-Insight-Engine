import {
  getFixture,
  type Bar,
  type BuildEventInput,
  type Mode,
  type Quote,
} from "@workspace/copilot-core";

/**
 * Error raised when a live (delayed) data source is unavailable. The route turns
 * this into a deterministic DATA_FAILURE L5 event rather than a bare error.
 */
export class CopilotDataError extends Error {
  constructor(
    message: string,
    public readonly status: number = 502,
  ) {
    super(message);
    this.name = "CopilotDataError";
  }
}

export const INTRADAY_SOURCE = "yahoo_delayed";

/** Build a deterministic event input from the built-in fixtures (no network). */
export function loadFixtureInput(symbol: string): BuildEventInput | null {
  const fixture = getFixture(symbol);
  if (!fixture) return null;
  return {
    symbol: fixture.symbol,
    mode: fixture.mode,
    dataSource: fixture.dataSource,
    bars: fixture.bars,
    quote: fixture.quote,
    nowMs: fixture.nowMs,
  };
}

type YahooIntradayResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        regularMarketTime?: number;
        chartPreviousClose?: number;
        previousClose?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: unknown;
  };
};

/**
 * Delayed intraday adapter using Yahoo's public v8 chart endpoint (no API key).
 * The data is delayed, not real-time, and is labeled as `yahoo_delayed`. It only
 * reads market data — it never places, approves, or simulates any position.
 */
export async function fetchIntradayInput(
  symbol: string,
  mode: Mode = "LIVE",
): Promise<BuildEventInput> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=1d&interval=5m`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Trading Desk Copilot research client)",
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new CopilotDataError(
      "Market data provider is currently unreachable.",
      503,
    );
  }

  if (res.status === 404) {
    throw new CopilotDataError(`No market data found for "${symbol}".`, 404);
  }
  if (!res.ok) {
    throw new CopilotDataError("Market data provider returned an error.", 502);
  }

  let json: YahooIntradayResponse;
  try {
    json = (await res.json()) as YahooIntradayResponse;
  } catch {
    throw new CopilotDataError(
      "Market data provider returned an invalid response.",
      502,
    );
  }

  const result = json.chart?.result?.[0];
  if (!result || json.chart?.error) {
    throw new CopilotDataError(`No market data found for "${symbol}".`, 404);
  }

  const timestamps = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const bars: Bar[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i];
    if (
      typeof o === "number" &&
      typeof h === "number" &&
      typeof l === "number" &&
      typeof c === "number" &&
      Number.isFinite(o) &&
      Number.isFinite(h) &&
      Number.isFinite(l) &&
      Number.isFinite(c)
    ) {
      bars.push({
        t: timestamps[i],
        o,
        h,
        l,
        c,
        v: typeof v === "number" && Number.isFinite(v) ? v : 0,
      });
    }
  }

  const lastBar = bars.length > 0 ? bars[bars.length - 1] : null;
  const price = result.meta?.regularMarketPrice ?? lastBar?.c ?? null;
  const quoteTime =
    result.meta?.regularMarketTime ??
    lastBar?.t ??
    Math.floor(Date.now() / 1000);
  // Yahoo's delayed chart feed has no bid/ask, so spread is left unknown.
  const quote: Quote | null =
    price !== null ? { bid: null, ask: null, last: price, quoteTime } : null;

  // Prior-session close gates the deterministic gap detectors. It only exists
  // on the live (delayed) feed; fixtures intentionally leave it null.
  const rawPriorClose =
    result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? null;
  const priorClose =
    typeof rawPriorClose === "number" && Number.isFinite(rawPriorClose)
      ? rawPriorClose
      : null;

  return {
    symbol: symbol.toUpperCase(),
    mode,
    dataSource: INTRADAY_SOURCE,
    bars,
    quote,
    priorClose,
  };
}
