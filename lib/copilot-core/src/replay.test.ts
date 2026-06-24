import { describe, expect, it } from "vitest";
import { buildCopilotEvent } from "./event";
import { getFixture } from "./fixtures";
import {
  REPLAY_DATA_SOURCE,
  buildReplayInput,
  getReplaySession,
} from "./replay";

const DATE = "2024-06-03";

describe("getReplaySession", () => {
  it("returns metadata for a replayable fixture", () => {
    const s = getReplaySession("AAPL");
    expect(s).not.toBeNull();
    expect(s!.symbol).toBe("AAPL");
    expect(s!.date).toBe(DATE);
    expect(s!.availableDates).toEqual([DATE]);
    expect(s!.dataSource).toBe(REPLAY_DATA_SOURCE);
    expect(s!.totalSteps).toBe(getFixture("AAPL")!.bars.length);
    expect(s!.barSeconds).toBe(300);
    expect(s!.startTime).toBeLessThan(s!.endTime);
  });

  it("matches the symbol case-insensitively", () => {
    expect(getReplaySession("aapl")?.symbol).toBe("AAPL");
  });

  it("rejects an unknown symbol", () => {
    expect(getReplaySession("ZZZZ")).toBeNull();
  });

  it("rejects a no-bar fixture (NODATA) as non-replayable", () => {
    expect(getReplaySession("NODATA")).toBeNull();
    expect(buildReplayInput("NODATA", DATE, 0)).toBeNull();
  });

  it("rejects a date that does not match the session", () => {
    expect(getReplaySession("AAPL", "1999-01-01")).toBeNull();
    expect(buildReplayInput("AAPL", "1999-01-01", 0)).toBeNull();
  });
});

describe("buildReplayInput", () => {
  it("reveals bars[0..step] (0-based) at each step", () => {
    expect(buildReplayInput("AAPL", DATE, 0)!.bars).toHaveLength(1);
    expect(buildReplayInput("AAPL", DATE, 9)!.bars).toHaveLength(10);
    const total = getReplaySession("AAPL")!.totalSteps;
    expect(buildReplayInput("AAPL", DATE, total - 1)!.bars).toHaveLength(total);
  });

  it("rejects out-of-range and non-integer steps", () => {
    const total = getReplaySession("AAPL")!.totalSteps;
    expect(buildReplayInput("AAPL", DATE, -1)).toBeNull();
    expect(buildReplayInput("AAPL", DATE, total)).toBeNull();
    expect(buildReplayInput("AAPL", DATE, 1.5)).toBeNull();
  });

  it("tags every step as REPLAY mode and replay data source", () => {
    const input = buildReplayInput("AAPL", DATE, 50)!;
    expect(input.mode).toBe("REPLAY");
    expect(input.dataSource).toBe(REPLAY_DATA_SOURCE);
  });

  it("advances the replay clock monotonically with step", () => {
    const a = buildReplayInput("AAPL", DATE, 10)!;
    const b = buildReplayInput("AAPL", DATE, 11)!;
    expect(b.nowMs!).toBeGreaterThan(a.nowMs!);
    expect(b.bars[b.bars.length - 1].t).toBeGreaterThan(
      a.bars[a.bars.length - 1].t,
    );
  });
});

describe("replay events through the deterministic pipeline", () => {
  it("synthesizes a fresh, tight quote so replay is never stale or wide", () => {
    const total = getReplaySession("AAPL")!.totalSteps;
    for (const step of [0, 25, total - 1]) {
      const event = buildCopilotEvent(buildReplayInput("AAPL", DATE, step)!);
      expect(event.mode).toBe("REPLAY");
      expect(event.feedQuality.isStale).toBe(false);
      expect(event.hardBlocks).not.toContain("STALE_QUOTE");
      expect(event.hardBlocks).not.toContain("WIDE_SPREAD");
    }
  });

  it("hard-blocks early (insufficient data) then clears once enough bars exist", () => {
    const early = buildCopilotEvent(buildReplayInput("AAPL", DATE, 0)!);
    expect(early.l5Blocked).toBe(true);
    expect(early.hardBlocks).toContain("MARKET_QUALITY_FAILURE");

    const total = getReplaySession("AAPL")!.totalSteps;
    const late = buildCopilotEvent(buildReplayInput("AAPL", DATE, total - 1)!);
    expect(late.l5Blocked).toBe(false);
    expect(late.hardBlocks).toHaveLength(0);
  });

  it("exposes the revealed bars[0..step] on the built event (N+1 bars)", () => {
    const event = buildCopilotEvent(buildReplayInput("AAPL", DATE, 9)!);
    expect(event.bars).toHaveLength(10);
    expect(event.bars[event.bars.length - 1].t * 1000).toBe(
      Date.parse(event.timestamp),
    );
  });

  it("keeps replay separate from live: distinct mode, source, and eventId", () => {
    const replay = buildCopilotEvent(buildReplayInput("AAPL", DATE, 70)!);
    const live = buildCopilotEvent({
      symbol: "AAPL",
      mode: "RESEARCH",
      dataSource: "fixture",
      bars: getFixture("AAPL")!.bars,
      quote: getFixture("AAPL")!.quote,
      nowMs: getFixture("AAPL")!.nowMs,
    });
    expect(replay.mode).toBe("REPLAY");
    expect(replay.dataSource).toBe(REPLAY_DATA_SOURCE);
    expect(live.mode).not.toBe("REPLAY");
    expect(replay.eventId).not.toBe(live.eventId);
  });
});
