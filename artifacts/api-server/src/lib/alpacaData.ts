import type {
  Bar,
  BuildEventInput,
  Mode,
  Quote,
  Trade,
} from "@workspace/copilot-core";
import {
  BENCHMARK_SYMBOL,
  CopilotDataError,
  fetchEarningsTime,
} from "./copilotData.js";
import { alpacaFeed } from "./providers/config.js";

/**
 * Real-time (key-gated) intraday adapter using Alpaca's Market Data API.
 * Read-only market data: it never places, approves, or simulates any order —
 * the Alpaca TRADING API is intentionally never touched (permanent no-trading
 * constraint of this product).
 */
export const ALPACA_SOURCE = "alpaca_live";

const ALPACA_DATA_BASE = "https://data.alpaca.markets";

function alpacaHeaders(): Record<string, string> {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secret) {
    throw new CopilotDataError(
      "Alpaca API keys are not configured (ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY).",
      503,
    );
  }
  return {
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secret,
    Accept: "application/json",
  };
}

// Feed tier (ALPACA_FEED, default "sip") comes from the shared provider
// config so FinDesk and the copilot always read the same feed — the two
// surfaces must never disagree on the same bars.

async function alpacaGet(path: string, symbol: string): Promise<unknown> {
  const headers = alpacaHeaders();
  let res: Response;
  try {
    res = await fetch(`${ALPACA_DATA_BASE}${path}`, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new CopilotDataError(
      "Alpaca market data is currently unreachable.",
      503,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new CopilotDataError(
      "Alpaca rejected the configured API keys (or the feed tier is not permitted).",
      502,
    );
  }
  if (res.status === 404 || res.status === 422) {
    throw new CopilotDataError(
      `No Alpaca market data found for "${symbol}".`,
      404,
    );
  }
  if (!res.ok) {
    throw new CopilotDataError("Alpaca returned an error response.", 502);
  }
  try {
    return await res.json();
  } catch {
    throw new CopilotDataError("Alpaca returned an invalid response.", 502);
  }
}

type AlpacaBarsResponse = {
  bars?: Array<{
    t?: string;
    o?: number;
    h?: number;
    l?: number;
    c?: number;
    v?: number;
  }> | null;
};

type AlpacaSnapshot = {
  latestTrade?: { p?: number; t?: string } | null;
  latestQuote?: { bp?: number; ap?: number; t?: string } | null;
  dailyBar?: { o?: number; c?: number } | null;
  prevDailyBar?: { c?: number } | null;
};

async function requestAlpacaBars(symbol: string): Promise<Bar[]> {
  // Look back a few days so weekends/holidays still resolve to the most
  // recent completed session; sliceLatestSession picks the final session out.
  const start = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  const json = (await alpacaGet(
    `/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=5Min&start=${encodeURIComponent(
      start,
    )}&limit=10000&adjustment=raw&feed=${alpacaFeed}&sort=asc`,
    symbol,
  )) as AlpacaBarsResponse;

  const bars: Bar[] = [];
  for (const b of json.bars ?? []) {
    const t = typeof b.t === "string" ? Math.floor(Date.parse(b.t) / 1000) : NaN;
    if (
      Number.isFinite(t) &&
      typeof b.o === "number" &&
      typeof b.h === "number" &&
      typeof b.l === "number" &&
      typeof b.c === "number" &&
      Number.isFinite(b.o) &&
      Number.isFinite(b.h) &&
      Number.isFinite(b.l) &&
      Number.isFinite(b.c)
    ) {
      bars.push({
        t,
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
        v: typeof b.v === "number" && Number.isFinite(b.v) ? b.v : 0,
      });
    }
  }
  return bars;
}

async function requestAlpacaSnapshot(symbol: string): Promise<AlpacaSnapshot> {
  return (await alpacaGet(
    `/v2/stocks/${encodeURIComponent(symbol)}/snapshot?feed=${alpacaFeed}`,
    symbol,
  )) as AlpacaSnapshot;
}

type AlpacaTradesResponse = {
  trades?: Array<{ t?: string; p?: number; s?: number }> | null;
};

/** Trade-tape lookback window feeding the signed-volume order-flow read. */
const TRADES_LOOKBACK_MS = 15 * 60 * 1000;

/**
 * Recent executed trades off the SIP tape (last 15 minutes). Feeds the
 * deterministic order-flow read (tick-rule signed volume). Best-effort: any
 * failure resolves to null so the order-flow agent stays honestly UNAVAILABLE
 * rather than breaking the symbol's event.
 */
async function fetchAlpacaTrades(symbol: string): Promise<Trade[] | null> {
  try {
    const start = new Date(Date.now() - TRADES_LOOKBACK_MS).toISOString();
    const json = (await alpacaGet(
      `/v2/stocks/${encodeURIComponent(symbol)}/trades?start=${encodeURIComponent(
        start,
      )}&limit=10000&feed=${alpacaFeed}&sort=asc`,
      symbol,
    )) as AlpacaTradesResponse;
    const trades: Trade[] = [];
    for (const tr of json.trades ?? []) {
      const t =
        typeof tr.t === "string" ? Math.floor(Date.parse(tr.t) / 1000) : NaN;
      if (
        Number.isFinite(t) &&
        typeof tr.p === "number" &&
        Number.isFinite(tr.p) &&
        tr.p > 0 &&
        typeof tr.s === "number" &&
        Number.isFinite(tr.s) &&
        tr.s > 0
      ) {
        trades.push({ t, p: tr.p, s: tr.s });
      }
    }
    return trades.length > 0 ? trades : null;
  } catch {
    return null;
  }
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
});
const ET_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Keep only regular-session bars (09:30–16:00 ET) belonging to the most recent
 * session present in the series. Mirrors Yahoo's `range=1d` behavior so the
 * deterministic features (opening range, VWAP, completeness) stay comparable
 * across sources.
 */
export function sliceLatestSession(bars: Bar[]): Bar[] {
  const inSession = bars.filter((b) => {
    const [h, m] = ET_TIME.format(new Date(b.t * 1000)).split(":").map(Number);
    const mins = h * 60 + m;
    return mins >= 570 && mins < 960;
  });
  if (inSession.length === 0) return [];
  const lastDate = ET_DATE.format(
    new Date(inSession[inSession.length - 1].t * 1000),
  );
  return inSession.filter(
    (b) => ET_DATE.format(new Date(b.t * 1000)) === lastDate,
  );
}

/**
 * Benchmark (SPY) percent return since the session open via Alpaca's snapshot.
 * Best-effort: any failure resolves to null so the relative-strength detector
 * stays dormant rather than breaking the symbol's read.
 */
async function fetchAlpacaBenchmarkReturnPct(): Promise<number | null> {
  try {
    const snap = await requestAlpacaSnapshot(BENCHMARK_SYMBOL);
    const open = snap.dailyBar?.o;
    const price = snap.latestTrade?.p ?? snap.dailyBar?.c;
    if (
      typeof open !== "number" ||
      !Number.isFinite(open) ||
      open <= 0 ||
      typeof price !== "number" ||
      !Number.isFinite(price)
    ) {
      return null;
    }
    return Math.round(((price - open) / open) * 100 * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * Build the deterministic event input from Alpaca market data (real-time on
 * the configured feed tier). Unlike the delayed Yahoo source this carries a
 * real bid/ask, so the spread gate in market quality becomes meaningful.
 */
export async function fetchAlpacaIntradayInput(
  symbol: string,
  mode: Mode = "LIVE",
): Promise<BuildEventInput> {
  const symbolUpper = symbol.toUpperCase();
  const [rawBars, snapshot, benchmarkReturnPct, earningsTime, trades] =
    await Promise.all([
      requestAlpacaBars(symbolUpper),
      requestAlpacaSnapshot(symbolUpper).catch(() => null),
      symbolUpper === BENCHMARK_SYMBOL
        ? Promise.resolve<number | null>(null)
        : fetchAlpacaBenchmarkReturnPct(),
      fetchEarningsTime(symbolUpper),
      fetchAlpacaTrades(symbolUpper),
    ]);

  const bars = sliceLatestSession(rawBars);
  if (bars.length === 0) {
    throw new CopilotDataError(
      `No recent session bars for "${symbolUpper}" on Alpaca (${alpacaFeed} feed).`,
      404,
    );
  }
  const lastBar = bars[bars.length - 1];

  const last = snapshot?.latestTrade?.p ?? lastBar.c;
  const quoteTime = snapshot?.latestTrade?.t
    ? Math.floor(Date.parse(snapshot.latestTrade.t) / 1000)
    : lastBar.t;
  const bp = snapshot?.latestQuote?.bp;
  const ap = snapshot?.latestQuote?.ap;
  // Alpaca reports 0 for a missing side; treat non-positive as unknown.
  const bid = typeof bp === "number" && bp > 0 ? bp : null;
  const ask = typeof ap === "number" && ap > 0 ? ap : null;
  const quote: Quote | null =
    typeof last === "number" && Number.isFinite(last)
      ? { bid, ask, last, quoteTime }
      : null;

  const rawPriorClose = snapshot?.prevDailyBar?.c;
  const priorClose =
    typeof rawPriorClose === "number" && Number.isFinite(rawPriorClose)
      ? rawPriorClose
      : null;

  return {
    symbol: symbolUpper,
    mode,
    dataSource: ALPACA_SOURCE,
    bars,
    quote,
    trades,
    priorClose,
    earningsTime,
    benchmarkReturnPct,
  };
}
