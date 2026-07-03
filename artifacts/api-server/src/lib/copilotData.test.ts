// Tests for the live (delayed) data adapter's out-of-band context sourcing.
// The POST_EARNINGS_DRIFT and RELATIVE_STRENGTH_MOMENTUM detectors are unit
// tested in copilot-core against a directly-supplied context; these tests pin
// the api-server side of that contract: fetchIntradayInput must actually
// populate `benchmarkReturnPct` (from the SPY chart series) and `earningsTime`
// (from the Nasdaq earnings-surprise calendar, falling back to Yahoo's
// crumb-gated quoteSummary), and must degrade both to null — without failing
// the primary symbol read — when those best-effort secondary fetches break.
// All network access is mocked; no real fetch occurs.

import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchIntradayInput, CopilotDataError } from "./copilotData.js";

/** Minimal Yahoo v8 chart payload with a valid 2-bar series. */
function chartPayload(opts: {
  open0: number;
  lastClose: number;
  regularMarketPrice?: number;
  previousClose?: number;
}) {
  return {
    chart: {
      result: [
        {
          meta: {
            regularMarketPrice: opts.regularMarketPrice,
            regularMarketTime: 1_760_000_600,
            chartPreviousClose: opts.previousClose,
          },
          timestamp: [1_760_000_000, 1_760_000_300],
          indicators: {
            quote: [
              {
                open: [opts.open0, opts.open0 + 1],
                high: [opts.open0 + 2, opts.open0 + 3],
                low: [opts.open0 - 1, opts.open0],
                close: [opts.open0 + 1, opts.lastClose],
                volume: [1000, 2000],
              },
            ],
          },
        },
      ],
    },
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

type FetchRoute = (url: string) => Response | Promise<Response>;

/**
 * Install a fetch mock that routes by URL substring. Returns the mock so tests
 * can assert on which endpoints were hit.
 */
function installFetchRouter(routes: Array<[match: string, route: FetchRoute]>) {
  const mock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    for (const [match, route] of routes) {
      if (url.includes(match)) return route(url);
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const NOW_SEC = Math.floor(Date.now() / 1000);
const PAST_EARNINGS = NOW_SEC - 3 * 86_400;
const OLDER_EARNINGS = NOW_SEC - 90 * 86_400;
const FUTURE_EARNINGS = NOW_SEC + 30 * 86_400;

/** Format an epoch-seconds timestamp as Nasdaq's `M/D/YYYY` (UTC). */
function toNasdaqDate(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

/** Epoch seconds at UTC midnight of the given epoch-seconds timestamp. */
function utcMidnight(epochSec: number): number {
  const d = new Date(epochSec * 1000);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000,
  );
}

/** Nasdaq earnings-surprise payload with the given report timestamps. */
function nasdaqEarningsPayload(reportTimes: number[]) {
  return {
    data: {
      symbol: "test",
      chart: reportTimes.map((t) => ({ x: String(t), y: "0.10" })),
      earningsSurpriseTable: {
        rows: reportTimes.map((t) => ({
          fiscalQtrEnd: "Mar 2026",
          dateReported: toNasdaqDate(t),
          eps: 1.23,
        })),
      },
    },
    message: null,
    status: { rCode: 200 },
  };
}

/** Nasdaq's "No record found" shape (ETFs and non-reporting symbols). */
const NASDAQ_NO_RECORD = {
  data: null,
  message: null,
  status: { rCode: 200, bCodeMessage: [{ code: 1002 }] },
};

function yahooEarningsPayload(raws: number[]) {
  return {
    quoteSummary: {
      result: [
        {
          calendarEvents: {
            earnings: { earningsDate: raws.map((raw) => ({ raw })) },
          },
        },
      ],
    },
  };
}

const crumbRoutes: Array<[string, FetchRoute]> = [
  [
    "fc.yahoo.com",
    () =>
      new Response("", {
        status: 200,
        headers: { "set-cookie": "A3=session-token; Path=/; Secure" },
      }),
  ],
  ["getcrumb", () => new Response("test-crumb", { status: 200 })],
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchIntradayInput context sourcing", () => {
  it("attaches benchmarkReturnPct from the SPY series and earningsTime from the Nasdaq calendar", async () => {
    const fetchMock = installFetchRouter([
      // SPY benchmark: session open 100, regularMarketPrice 101 -> +1.00%
      [
        "/v8/finance/chart/SPY",
        () =>
          jsonResponse(
            chartPayload({ open0: 100, lastClose: 100.5, regularMarketPrice: 101 }),
          ),
      ],
      [
        "/v8/finance/chart/AAPL",
        () =>
          jsonResponse(
            chartPayload({
              open0: 200,
              lastClose: 205,
              regularMarketPrice: 205.5,
              previousClose: 198,
            }),
          ),
      ],
      [
        "api.nasdaq.com",
        () =>
          jsonResponse(
            nasdaqEarningsPayload([OLDER_EARNINGS, PAST_EARNINGS, FUTURE_EARNINGS]),
          ),
      ],
    ]);

    const input = await fetchIntradayInput("AAPL");

    expect(input.symbol).toBe("AAPL");
    expect(input.dataSource).toBe("yahoo_delayed");
    expect(input.bars).toHaveLength(2);
    expect(input.quote?.last).toBe(205.5);
    expect(input.priorClose).toBe(198);

    // Relative-strength context: (101 - 100) / 100 = +1.00%
    expect(input.benchmarkReturnPct).toBe(1);
    // Post-earnings context: most recent PAST report wins; future rows are
    // ignored. The raw chart epoch (PAST_EARNINGS) beats the date-level parse.
    expect(input.earningsTime).toBe(PAST_EARNINGS);

    // The Nasdaq calendar must be the source hit; no Yahoo crumb fallback.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(
      urls.some((u) => u.includes("api.nasdaq.com/api/company/AAPL/earnings-surprise")),
    ).toBe(true);
    expect(urls.some((u) => u.includes("fc.yahoo.com"))).toBe(false);
    expect(urls.some((u) => u.includes("quoteSummary"))).toBe(false);
  });

  it("parses earningsTime from the Nasdaq dateReported table when the chart series is absent", async () => {
    installFetchRouter([
      [
        "/v8/finance/chart/SPY",
        () =>
          jsonResponse(
            chartPayload({ open0: 100, lastClose: 101, regularMarketPrice: 101 }),
          ),
      ],
      [
        "/v8/finance/chart/MSFT",
        () =>
          jsonResponse(
            chartPayload({ open0: 400, lastClose: 405, regularMarketPrice: 405 }),
          ),
      ],
      [
        "api.nasdaq.com",
        () =>
          jsonResponse({
            data: {
              earningsSurpriseTable: {
                rows: [
                  { dateReported: toNasdaqDate(PAST_EARNINGS) },
                  { dateReported: toNasdaqDate(OLDER_EARNINGS) },
                  { dateReported: "not a date" },
                ],
              },
            },
          }),
      ],
    ]);

    const input = await fetchIntradayInput("MSFT");

    // Table dates are day-granular: expect UTC midnight of the report day.
    expect(input.earningsTime).toBe(utcMidnight(PAST_EARNINGS));
  });

  it("falls back to the Yahoo crumb-gated source when Nasdaq has no record", async () => {
    const fetchMock = installFetchRouter([
      [
        "/v8/finance/chart/SPY",
        () =>
          jsonResponse(
            chartPayload({ open0: 100, lastClose: 101, regularMarketPrice: 101 }),
          ),
      ],
      [
        "/v8/finance/chart/AAPL",
        () =>
          jsonResponse(
            chartPayload({ open0: 200, lastClose: 205, regularMarketPrice: 205 }),
          ),
      ],
      ["api.nasdaq.com", () => jsonResponse(NASDAQ_NO_RECORD)],
      ...crumbRoutes,
      [
        "quoteSummary",
        () => jsonResponse(yahooEarningsPayload([PAST_EARNINGS, FUTURE_EARNINGS])),
      ],
    ]);

    const input = await fetchIntradayInput("AAPL");

    expect(input.earningsTime).toBe(PAST_EARNINGS);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(
      urls.find((u) => u.includes("quoteSummary"))?.includes("crumb=test-crumb"),
    ).toBe(true);
  });

  it("degrades both context fields to null when secondary fetches fail, without breaking the primary read", async () => {
    installFetchRouter([
      // Benchmark series is down (HTTP 500) -> benchmarkReturnPct null.
      [
        "/v8/finance/chart/SPY",
        () => new Response("oops", { status: 500 }),
      ],
      [
        "/v8/finance/chart/NVDA",
        () =>
          jsonResponse(
            chartPayload({ open0: 50, lastClose: 51, regularMarketPrice: 51.2 }),
          ),
      ],
      // Both earnings sources reject at the network layer -> null.
      [
        "api.nasdaq.com",
        () => Promise.reject(new TypeError("network down")),
      ],
      [
        "fc.yahoo.com",
        () => Promise.reject(new TypeError("network down")),
      ],
    ]);

    const input = await fetchIntradayInput("NVDA");

    expect(input.symbol).toBe("NVDA");
    expect(input.bars).toHaveLength(2);
    expect(input.quote?.last).toBe(51.2);
    expect(input.benchmarkReturnPct).toBeNull();
    expect(input.earningsTime).toBeNull();
  });

  it("degrades earningsTime to null when Nasdaq fails and the crumb handshake yields no cookie", async () => {
    installFetchRouter([
      [
        "/v8/finance/chart/SPY",
        () =>
          jsonResponse(
            chartPayload({ open0: 100, lastClose: 102, regularMarketPrice: 102 }),
          ),
      ],
      [
        "/v8/finance/chart/AMD",
        () =>
          jsonResponse(
            chartPayload({ open0: 10, lastClose: 11, regularMarketPrice: 11 }),
          ),
      ],
      ["api.nasdaq.com", () => new Response("blocked", { status: 403 })],
      // Seed responds OK but sets no cookie -> crumb acquisition fails -> null.
      ["fc.yahoo.com", () => new Response("", { status: 200 })],
    ]);

    const input = await fetchIntradayInput("AMD");

    expect(input.earningsTime).toBeNull();
    expect(input.benchmarkReturnPct).toBe(2);
  });

  it("degrades earningsTime to null when both sources only know future earnings dates", async () => {
    installFetchRouter([
      [
        "/v8/finance/chart/SPY",
        () =>
          jsonResponse(
            chartPayload({ open0: 100, lastClose: 100, regularMarketPrice: 100 }),
          ),
      ],
      [
        "/v8/finance/chart/TSLA",
        () =>
          jsonResponse(
            chartPayload({ open0: 300, lastClose: 305, regularMarketPrice: 305 }),
          ),
      ],
      ["api.nasdaq.com", () => jsonResponse(nasdaqEarningsPayload([FUTURE_EARNINGS]))],
      ...crumbRoutes,
      ["quoteSummary", () => jsonResponse(yahooEarningsPayload([FUTURE_EARNINGS]))],
    ]);

    const input = await fetchIntradayInput("TSLA");

    expect(input.earningsTime).toBeNull();
    expect(input.benchmarkReturnPct).toBe(0);
  });

  it("skips the benchmark-vs-itself comparison when the symbol IS the benchmark", async () => {
    const fetchMock = installFetchRouter([
      // The primary read uses the caller's raw symbol casing ("spy"), so match
      // the chart path generically — only the benchmark symbol exists here.
      [
        "/v8/finance/chart/",
        () =>
          jsonResponse(
            chartPayload({ open0: 100, lastClose: 101, regularMarketPrice: 101 }),
          ),
      ],
      ["api.nasdaq.com", () => jsonResponse(NASDAQ_NO_RECORD)],
      ...crumbRoutes,
      ["quoteSummary", () => jsonResponse(yahooEarningsPayload([PAST_EARNINGS]))],
    ]);

    const input = await fetchIntradayInput("spy");

    expect(input.symbol).toBe("SPY");
    expect(input.benchmarkReturnPct).toBeNull();
    // Exactly ONE chart fetch: the primary read. No redundant SPY-vs-SPY call.
    const chartCalls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/v8/finance/chart/"));
    expect(chartCalls).toHaveLength(1);
  });

  it("still fails loudly (CopilotDataError) when the PRIMARY symbol read fails, even if secondaries succeed", async () => {
    installFetchRouter([
      [
        "/v8/finance/chart/SPY",
        () =>
          jsonResponse(
            chartPayload({ open0: 100, lastClose: 101, regularMarketPrice: 101 }),
          ),
      ],
      ["/v8/finance/chart/BAD", () => new Response("", { status: 404 })],
      ["api.nasdaq.com", () => jsonResponse(nasdaqEarningsPayload([PAST_EARNINGS]))],
    ]);

    await expect(fetchIntradayInput("BAD")).rejects.toBeInstanceOf(
      CopilotDataError,
    );
  });
});
