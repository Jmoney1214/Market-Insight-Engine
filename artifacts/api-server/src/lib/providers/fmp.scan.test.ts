import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let getBatchSnapshots: typeof import("./fmp.js").getBatchSnapshots;
let getDailyBars: typeof import("./fmp.js").getDailyBars;
let getNewsMulti: typeof import("./fmp.js").getNewsMulti;

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv("FMP_API_KEY", "test-fmp-key");
  ({ getBatchSnapshots, getDailyBars, getNewsMulti } =
    await import("./fmp.js"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FMP scan data adapters", () => {
  it("maps batch quotes into gap snapshots", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              symbol: "F",
              price: 14.88,
              previousClose: 15.28,
              timestamp: 1785528001,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const snapshots = await getBatchSnapshots(["F"]);

    expect(snapshots?.get("F")).toEqual({
      symbol: "F",
      price: 14.88,
      refClose: 15.28,
      gapPct: expect.closeTo(-2.6178, 4),
      lastTradeAt: "2026-07-31T20:00:01.000Z",
    });
  });

  it("returns one newest headline per requested symbol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              symbol: "AAPL",
              title: "Newest Apple headline",
              publishedDate: "2026-07-31 17:12:00",
            },
            {
              symbol: "AAPL",
              title: "Older Apple headline",
              publishedDate: "2026-07-31 16:00:00",
            },
            {
              symbol: "MSFT",
              title: "Microsoft headline",
              publishedDate: "2026-07-31 18:00:00",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const headlines = await getNewsMulti(["AAPL", "MSFT"]);

    expect(headlines).toEqual(
      new Map([
        ["AAPL", "Newest Apple headline"],
        ["MSFT", "Microsoft headline"],
      ]),
    );
  });

  it("normalizes descending FMP EOD rows into ascending indicator arrays", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            { date: "2026-07-30", high: 12, low: 10, close: 11, volume: 200 },
            { date: "2026-07-29", high: 11, low: 9, close: 10, volume: 100 },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const bars = await getDailyBars("F", 60);

    expect(bars).toEqual({
      closes: [10, 11],
      highs: [11, 12],
      lows: [9, 10],
      volumes: [100, 200],
    });
  });
});
