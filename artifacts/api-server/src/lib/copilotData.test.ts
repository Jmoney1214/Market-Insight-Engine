// Tests for the live (delayed) data adapter's out-of-band context sourcing.
// The POST_EARNINGS_DRIFT and RELATIVE_STRENGTH_MOMENTUM detectors are unit
// tested in copilot-core against a directly-supplied context; these tests pin
// the api-server side of that contract: fetchIntradayInput must actually
// populate `benchmarkReturnPct` (from the SPY chart series) and `earningsTime`
// (from the crumb-gated quoteSummary earnings source), and must degrade both
// to null — without failing the primary symbol read — when those best-effort
// secondary fetches break. All network access is mocked; no real fetch occurs.

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

function earningsPayload(raws: number[]) {
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
  it("attaches benchmarkReturnPct from the SPY series and earningsTime from the earnings source", async () => {
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
      ...crumbRoutes,
      [
        "quoteSummary",
        () =>
          jsonResponse(earningsPayload([OLDER_EARNINGS, PAST_EARNINGS, FUTURE_EARNINGS])),
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
    // Post-earnings context: most recent PAST date wins; future dates ignored.
    expect(input.earningsTime).toBe(PAST_EARNINGS);

    // The crumb-gated earnings source must have been exercised with the crumb.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("quoteSummary/AAPL"))).toBe(true);
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
      // Earnings source: cookie seed rejects at the network layer -> null.
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

  it("degrades earningsTime to null when the crumb handshake yields no cookie", async () => {
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
      // Seed responds OK but sets no cookie -> crumb acquisition fails -> null.
      ["fc.yahoo.com", () => new Response("", { status: 200 })],
    ]);

    const input = await fetchIntradayInput("AMD");

    expect(input.earningsTime).toBeNull();
    expect(input.benchmarkReturnPct).toBe(2);
  });

  it("degrades earningsTime to null when only future earnings dates exist", async () => {
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
      ...crumbRoutes,
      ["quoteSummary", () => jsonResponse(earningsPayload([FUTURE_EARNINGS]))],
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
      ...crumbRoutes,
      ["quoteSummary", () => jsonResponse(earningsPayload([PAST_EARNINGS]))],
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
      ...crumbRoutes,
      ["quoteSummary", () => jsonResponse(earningsPayload([PAST_EARNINGS]))],
    ]);

    await expect(fetchIntradayInput("BAD")).rejects.toBeInstanceOf(
      CopilotDataError,
    );
  });
});
