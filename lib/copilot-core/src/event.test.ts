import { describe, expect, it } from "vitest";
import {
  EXPECTED_SESSION_BARS,
  MIN_COMPLETENESS,
  STALE_QUOTE_SECONDS,
  VOLUME_EXPANSION_RVOL,
  WIDE_SPREAD_BPS,
} from "./constants";
import { buildCopilotEvent } from "./event";
import { getFixture } from "./fixtures";
import type { Bar, BuildEventInput, CopilotEvent } from "./types";

function eventFor(symbol: string, overrides: Partial<BuildEventInput> = {}): CopilotEvent {
  const fixture = getFixture(symbol)!;
  return buildCopilotEvent({
    symbol: fixture.symbol,
    mode: fixture.mode,
    dataSource: fixture.dataSource,
    bars: fixture.bars,
    quote: fixture.quote,
    nowMs: fixture.nowMs,
    ...overrides,
  });
}

const bar = (
  t: number,
  o: number,
  h: number,
  l: number,
  c: number,
  v: number,
): Bar => ({ t, o, h, l, c, v });

describe("clean opening-range breakout (AAPL)", () => {
  const event = eventFor("AAPL");

  it("emits a healthy non-blocked event", () => {
    expect(event.hardBlocks).toEqual([]);
    expect(event.l5Blocked).toBe(false);
    expect(event.alertLevel).toBe("L3");
  });

  it("builds a credible primary-edge trigger stack", () => {
    expect(event.triggerStack.category).toBe("primary_edge");
    expect(event.triggerStack.credibility).toBe(0.8);
    expect(event.triggerStack.stackName).toBe("OPENING_RANGE_BREAKOUT");
    expect(event.triggerStack.detectedTriggers).toContain(
      "OPENING_RANGE_BREAKOUT",
    );
    expect(event.triggerStack.detectedTriggers).toContain(
      "TREND_CONTINUATION_LONG",
    );
    const orb = event.triggers.find(
      (t) => t.name === "OPENING_RANGE_BREAKOUT",
    );
    expect(orb?.detected).toBe(true);
  });

  it("projects a research-only risk/reward preview", () => {
    expect(event.riskReward.direction).toBe("LONG");
    expect(event.riskReward.entry).toBe(103.95);
    expect(event.riskReward.invalidation).toBe(99.5);
    expect(event.riskReward.target).toBe(112.85);
    expect(event.riskReward.ratio).toBe(2);
  });

  it("reports OK feed quality", () => {
    expect(event.feedQuality.verdict).toBe("OK");
    expect(event.feedQuality.isStale).toBe(false);
    expect(event.feedQuality.spreadBps).toBe(3.85);
    expect(event.marketQuality.spreadOk).toBe(true);
    expect(event.marketQuality.quoteFresh).toBe(true);
    expect(event.marketQuality.liquidityOk).toBe(true);
  });
});

describe("L5 hard blocks", () => {
  it("STALE_QUOTE forces L5 in LIVE mode (MSFT)", () => {
    const event = eventFor("MSFT");
    expect(event.hardBlocks).toContain("STALE_QUOTE");
    expect(event.alertLevel).toBe("L5");
    expect(event.l5Blocked).toBe(true);
    expect(event.gates.staleness.status).toBe("BLOCK");
    expect(event.feedQuality.isStale).toBe(true);
    expect(event.feedQuality.verdict).toBe("BLOCKED");
    expect(event.marketQuality.quoteFresh).toBe(false);
  });

  it("WIDE_SPREAD forces L5 (TSLA)", () => {
    const event = eventFor("TSLA");
    expect(event.hardBlocks).toContain("WIDE_SPREAD");
    expect(event.alertLevel).toBe("L5");
    expect(event.l5Blocked).toBe(true);
    expect(event.gates.spread.status).toBe("BLOCK");
    expect(event.marketQuality.spreadOk).toBe(false);
    expect(event.feedQuality.verdict).toBe("BLOCKED");
  });

  it("DATA_FAILURE forces L5 with no usable data (NODATA)", () => {
    const event = eventFor("NODATA");
    expect(event.hardBlocks).toContain("DATA_FAILURE");
    expect(event.alertLevel).toBe("L5");
    expect(event.l5Blocked).toBe(true);
    expect(event.gates.data.status).toBe("BLOCK");
    expect(event.snapshot.price).toBeNull();
    expect(event.riskReward.direction).toBeNull();
    expect(event.position.status).toBe("FLAT");
    expect(event.feedQuality.verdict).toBe("BLOCKED");
  });

  it("MARKET_QUALITY_FAILURE forces L5 when the session is too incomplete", () => {
    const event = buildCopilotEvent({
      symbol: "PART",
      mode: "RESEARCH",
      dataSource: "fixture",
      bars: [
        bar(0, 10, 10.5, 9.6, 10.2, 100),
        bar(1, 10.2, 10.4, 9.5, 9.8, 100),
        bar(2, 9.8, 10.3, 9.7, 10.1, 100),
        bar(3, 10.1, 10.2, 9.9, 10.0, 100),
      ],
      quote: { bid: 9.99, ask: 10.01, last: 10.0, quoteTime: 0 },
      nowMs: 0,
    });
    expect(event.hardBlocks).toContain("MARKET_QUALITY_FAILURE");
    expect(event.alertLevel).toBe("L5");
    expect(event.l5Blocked).toBe(true);
    expect(event.gates.marketQuality.status).toBe("BLOCK");
  });
});

describe("alert ladder", () => {
  it("returns L4 when a credible primary edge is paper validated", () => {
    const event = eventFor("AAPL", {
      validation: { status: "paper_validated", sampleCount: 200, expectancyR: 0.5 },
    });
    expect(event.alertLevel).toBe("L4");
  });

  it("returns L1 when nothing triggers on a complete, flat session", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < EXPECTED_SESSION_BARS; i++) {
      bars.push(bar(i * 300, 100, 100, 100, 100, 1000));
    }
    const event = buildCopilotEvent({
      symbol: "FLAT",
      mode: "RESEARCH",
      dataSource: "fixture",
      bars,
      quote: { bid: 99.99, ask: 100.01, last: 100, quoteTime: 0 },
      nowMs: bars[bars.length - 1].t * 1000,
    });
    expect(event.hardBlocks).toEqual([]);
    expect(event.triggerStack.credibility).toBe(0);
    expect(event.alertLevel).toBe("L1");
  });
});

describe("manual position read", () => {
  it("reports unrealized R and a valid thesis for a winning long", () => {
    const event = eventFor("AAPL", {
      position: { side: "LONG", entry: 100, stop: 99 },
    });
    expect(event.position.status).toBe("IN_POSITION");
    expect(event.position.side).toBe("LONG");
    expect(event.position.unrealizedR).toBe(3.95);
    expect(event.position.thesisStatus).toBe("VALID");
  });
});

describe("event carries underlying bars", () => {
  it("exposes the OHLCV bars used to build the event, oldest first", () => {
    const fixture = getFixture("AAPL")!;
    const event = eventFor("AAPL");
    expect(event.bars).toHaveLength(fixture.bars.length);
    expect(event.bars[0]).toEqual(fixture.bars[0]);
    // The event timestamp is anchored to the most recent bar.
    expect(event.bars[event.bars.length - 1].t * 1000).toBe(
      Date.parse(event.timestamp),
    );
  });

  it("emits an empty bar array on total data failure (NODATA)", () => {
    expect(eventFor("NODATA").bars).toEqual([]);
  });
});

describe("locked threshold constants", () => {
  it("pins the deterministic thresholds", () => {
    expect(STALE_QUOTE_SECONDS).toBe(60);
    expect(WIDE_SPREAD_BPS).toBe(50);
    expect(MIN_COMPLETENESS).toBe(0.6);
    expect(EXPECTED_SESSION_BARS).toBe(78);
    expect(VOLUME_EXPANSION_RVOL).toBe(1.5);
  });
});
