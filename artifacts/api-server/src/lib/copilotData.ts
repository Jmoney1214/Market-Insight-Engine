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

/** Benchmark/index series used for the relative-strength comparison. */
export const BENCHMARK_SYMBOL = "SPY";

const RESEARCH_USER_AGENT =
  "Mozilla/5.0 (Trading Desk Copilot research client)";

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

type YahooChartResult = NonNullable<
  NonNullable<YahooIntradayResponse["chart"]>["result"]
>[number];

/**
 * Fetch and validate one symbol's delayed v8 chart payload, throwing a
 * deterministic {@link CopilotDataError} on any transport/parse failure. Shared
 * by the symbol feed and the benchmark series so both behave identically.
 */
async function requestYahooChart(symbol: string): Promise<YahooChartResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=1d&interval=5m`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": RESEARCH_USER_AGENT },
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
  return result;
}

/** Parse the OHLCV bars out of a validated chart result. */
function parseBars(result: YahooChartResult): Bar[] {
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
  return bars;
}

/**
 * Benchmark (SPY) percent return since the session open, used by the
 * relative-strength detector. Best-effort: any failure resolves to null so the
 * detector stays dormant rather than breaking the symbol's read.
 */
async function fetchBenchmarkReturnPct(): Promise<number | null> {
  try {
    const result = await requestYahooChart(BENCHMARK_SYMBOL);
    const bars = parseBars(result);
    const sessionOpen = bars.length > 0 ? bars[0].o : null;
    const lastBar = bars.length > 0 ? bars[bars.length - 1] : null;
    const price = result.meta?.regularMarketPrice ?? lastBar?.c ?? null;
    if (sessionOpen === null || sessionOpen <= 0 || price === null) return null;
    return Math.round(((price - sessionOpen) / sessionOpen) * 100 * 100) / 100;
  } catch {
    return null;
  }
}

type YahooQuoteSummaryResponse = {
  quoteSummary?: {
    result?: Array<{
      calendarEvents?: {
        earnings?: {
          earningsDate?: Array<{ raw?: number }>;
        };
      };
    }>;
  };
};

/**
 * Acquire a Yahoo crumb + cookie pair needed by the authenticated quoteSummary
 * endpoint. Keyless (no API key) but cookie-gated; best-effort, returns null on
 * any failure.
 */
async function getYahooCrumb(): Promise<{
  crumb: string;
  cookie: string;
} | null> {
  try {
    const seed = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": RESEARCH_USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });
    const setCookies = seed.headers.getSetCookie?.() ?? [];
    const cookie = setCookies
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
    if (!cookie) return null;

    const crumbRes = await fetch(
      "https://query1.finance.yahoo.com/v1/test/getcrumb",
      {
        headers: { "User-Agent": RESEARCH_USER_AGENT, cookie },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes("<")) return null;
    return { crumb, cookie };
  } catch {
    return null;
  }
}

/**
 * Most recent PAST earnings timestamp (epoch seconds) for the symbol, used by
 * the post-earnings-drift detector. Keyless (crumb/cookie, no API key) and
 * best-effort: any failure — or when the only known earnings date is in the
 * future — resolves to null so the detector stays dormant.
 */
async function fetchEarningsTime(symbol: string): Promise<number | null> {
  try {
    const creds = await getYahooCrumb();
    if (!creds) return null;
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
      symbol,
    )}?modules=calendarEvents&crumb=${encodeURIComponent(creds.crumb)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": RESEARCH_USER_AGENT, cookie: creds.cookie },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as YahooQuoteSummaryResponse;
    const dates =
      json.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate ??
      [];
    const nowSec = Math.floor(Date.now() / 1000);
    const past = dates
      .map((d) => d.raw)
      .filter(
        (raw): raw is number =>
          typeof raw === "number" && Number.isFinite(raw) && raw <= nowSec,
      );
    if (past.length === 0) return null;
    return Math.max(...past);
  } catch {
    return null;
  }
}

/**
 * Delayed intraday adapter using Yahoo's public v8 chart endpoint (no API key).
 * The data is delayed, not real-time, and is labeled as `yahoo_delayed`. It only
 * reads market data — it never places, approves, or simulates any position.
 *
 * Alongside the symbol's bars it sources two best-effort out-of-band context
 * fields (the benchmark return and the most recent earnings time) used by the
 * relative-strength and post-earnings-drift detectors. Either resolving to null
 * simply leaves the corresponding detector dormant; they never block the read.
 */
export async function fetchIntradayInput(
  symbol: string,
  mode: Mode = "LIVE",
): Promise<BuildEventInput> {
  const symbolUpper = symbol.toUpperCase();
  const [result, benchmarkReturnPct, earningsTime] = await Promise.all([
    requestYahooChart(symbol),
    symbolUpper === BENCHMARK_SYMBOL
      ? Promise.resolve<number | null>(null)
      : fetchBenchmarkReturnPct(),
    fetchEarningsTime(symbol),
  ]);

  const bars = parseBars(result);
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
    symbol: symbolUpper,
    mode,
    dataSource: INTRADAY_SOURCE,
    bars,
    quote,
    priorClose,
    earningsTime,
    benchmarkReturnPct,
  };
}
