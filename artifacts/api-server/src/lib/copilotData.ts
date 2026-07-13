import {
  type Bar,
  type BuildEventInput,
  type Mode,
  type Quote,
} from "@workspace/copilot-core/runtime";

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

type NasdaqEarningsSurpriseResponse = {
  data?: {
    chart?: Array<{ x?: string | number }>;
    earningsSurpriseTable?: {
      rows?: Array<{ dateReported?: string }>;
    };
  } | null;
};

/**
 * Parse Nasdaq's `M/D/YYYY` report-date string into epoch seconds (UTC
 * midnight). Date-level precision is sufficient for the drift detector: UTC
 * midnight of the report day always precedes that day's session open.
 */
function parseNasdaqDateReported(value: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const [, month, day, year] = m;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Given candidate epoch-second timestamps, return the most recent PAST one. */
function latestPastTimestamp(candidates: number[]): number | null {
  const nowSec = Math.floor(Date.now() / 1000);
  const past = candidates.filter(
    (t) => Number.isFinite(t) && t > 0 && t <= nowSec,
  );
  return past.length > 0 ? Math.max(...past) : null;
}

/**
 * Primary earnings-calendar source: Nasdaq's keyless earnings-surprise
 * endpoint, which lists the last several ACTUAL quarterly report dates (unlike
 * Yahoo's calendarEvents, which usually only exposes the next upcoming date).
 * Best-effort: returns null on any failure or when no past report is listed
 * (e.g. ETFs and non-reporting symbols return "No record found").
 */
async function fetchNasdaqEarningsTime(symbol: string): Promise<number | null> {
  try {
    const url = `https://api.nasdaq.com/api/company/${encodeURIComponent(
      symbol,
    )}/earnings-surprise`;
    const res = await fetch(url, {
      headers: { "User-Agent": RESEARCH_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as NasdaqEarningsSurpriseResponse;
    const data = json.data;
    if (!data) return null;

    const candidates: number[] = [];
    for (const row of data.earningsSurpriseTable?.rows ?? []) {
      if (typeof row.dateReported === "string") {
        const t = parseNasdaqDateReported(row.dateReported);
        if (t !== null) candidates.push(t);
      }
    }
    // The chart series carries the same report dates as raw epoch seconds;
    // used as a secondary parse in case the table is absent or reformatted.
    for (const point of data.chart ?? []) {
      const t = typeof point.x === "string" ? Number(point.x) : point.x;
      if (typeof t === "number" && Number.isFinite(t)) candidates.push(t);
    }
    return latestPastTimestamp(candidates);
  } catch {
    return null;
  }
}

/**
 * Fallback earnings source: Yahoo's crumb/cookie-gated quoteSummary
 * calendarEvents module. Frequently only exposes the NEXT report date, so it
 * mostly helps right after a report (when that date has just become a past
 * date). Best-effort: returns null on any failure.
 */
async function fetchYahooEarningsTime(symbol: string): Promise<number | null> {
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
    const candidates = dates
      .map((d) => d.raw)
      .filter((raw): raw is number => typeof raw === "number");
    return latestPastTimestamp(candidates);
  } catch {
    return null;
  }
}

type FmpEarningsRow = { date?: string };

/**
 * Key-gated earnings source: FMP's earnings calendar (used when FMP_API_KEY is
 * set). Tries the current "stable" API first, then the legacy v3 path for
 * older plans. Best-effort: returns null on any failure so the keyless chain
 * below still runs.
 */
async function fetchFmpEarningsTime(symbol: string): Promise<number | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  const encoded = encodeURIComponent(symbol);
  const urls = [
    `https://financialmodelingprep.com/stable/earnings?symbol=${encoded}&limit=12&apikey=${apiKey}`,
    `https://financialmodelingprep.com/api/v3/historical/earning_calendar/${encoded}?limit=12&apikey=${apiKey}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) continue;
      const json = (await res.json()) as FmpEarningsRow[] | unknown;
      if (!Array.isArray(json)) continue;
      const candidates: number[] = [];
      for (const row of json as FmpEarningsRow[]) {
        if (row && typeof row.date === "string") {
          const ms = Date.parse(`${row.date.slice(0, 10)}T00:00:00Z`);
          if (Number.isFinite(ms)) candidates.push(Math.floor(ms / 1000));
        }
      }
      const latest = latestPastTimestamp(candidates);
      if (latest !== null) return latest;
    } catch {
      // Best-effort; fall through to the next URL / keyless chain.
    }
  }
  return null;
}

/**
 * Most recent PAST earnings timestamp (epoch seconds) for the symbol, used by
 * the post-earnings-drift detector. FMP's earnings calendar is preferred when
 * a key is configured; otherwise (or on failure) the keyless chain runs:
 * Nasdaq's earnings-surprise calendar (actual past report dates), then Yahoo's
 * crumb-gated calendarEvents. Best-effort: when no source yields a past report
 * date, resolves to null so the detector stays dormant rather than guessing.
 */
export async function fetchEarningsTime(symbol: string): Promise<number | null> {
  const fromFmp = await fetchFmpEarningsTime(symbol);
  if (fromFmp !== null) return fromFmp;
  const fromNasdaq = await fetchNasdaqEarningsTime(symbol);
  if (fromNasdaq !== null) return fromNasdaq;
  return fetchYahooEarningsTime(symbol);
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
