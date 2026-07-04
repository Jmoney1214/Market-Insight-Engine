import { describe, it, expect } from "vitest";
import type { Bar } from "@workspace/copilot-core";
import { sliceLatestSession } from "./alpacaData.js";

// July 2026 is EDT (UTC-4): 09:30 ET = 13:30 UTC, 16:00 ET = 20:00 UTC.
function bar(y: number, mo: number, d: number, hUtc: number, mUtc: number): Bar {
  const t = Math.floor(Date.UTC(y, mo - 1, d, hUtc, mUtc) / 1000);
  return { t, o: 100, h: 101, l: 99, c: 100.5, v: 1000 };
}

describe("sliceLatestSession", () => {
  it("keeps only the most recent session's regular-hours bars", () => {
    const bars = [
      // Prior day (Jun 30): premarket, RTH, after-hours
      bar(2026, 6, 30, 12, 0), // 08:00 ET premarket
      bar(2026, 6, 30, 13, 30), // 09:30 ET RTH
      bar(2026, 6, 30, 19, 55), // 15:55 ET RTH
      bar(2026, 6, 30, 20, 30), // 16:30 ET after-hours
      // Latest day (Jul 1): premarket, RTH, after-hours
      bar(2026, 7, 1, 12, 0), // 08:00 ET premarket
      bar(2026, 7, 1, 13, 30), // 09:30 ET RTH
      bar(2026, 7, 1, 17, 0), // 13:00 ET RTH
      bar(2026, 7, 1, 19, 55), // 15:55 ET RTH
      bar(2026, 7, 1, 20, 30), // 16:30 ET after-hours
    ];
    const out = sliceLatestSession(bars);
    expect(out).toHaveLength(3);
    expect(out.map((b) => b.t)).toEqual([
      bar(2026, 7, 1, 13, 30).t,
      bar(2026, 7, 1, 17, 0).t,
      bar(2026, 7, 1, 19, 55).t,
    ]);
  });

  it("excludes the 16:00 ET bar start and pre-09:30 bars", () => {
    const bars = [
      bar(2026, 7, 1, 13, 25), // 09:25 ET — before the open
      bar(2026, 7, 1, 13, 30), // 09:30 ET — first session bar
      bar(2026, 7, 1, 19, 55), // 15:55 ET — last 5-min session bar
      bar(2026, 7, 1, 20, 0), // 16:00 ET — post-close bar start
    ];
    const out = sliceLatestSession(bars);
    expect(out.map((b) => b.t)).toEqual([
      bar(2026, 7, 1, 13, 30).t,
      bar(2026, 7, 1, 19, 55).t,
    ]);
  });

  it("handles EST (winter) sessions correctly", () => {
    // January 2026 is EST (UTC-5): 09:30 ET = 14:30 UTC.
    const bars = [
      bar(2026, 1, 15, 14, 0), // 09:00 ET premarket
      bar(2026, 1, 15, 14, 30), // 09:30 ET RTH
      bar(2026, 1, 15, 20, 55), // 15:55 ET RTH
      bar(2026, 1, 15, 21, 0), // 16:00 ET post-close
    ];
    const out = sliceLatestSession(bars);
    expect(out.map((b) => b.t)).toEqual([
      bar(2026, 1, 15, 14, 30).t,
      bar(2026, 1, 15, 20, 55).t,
    ]);
  });

  it("returns empty for empty input or extended-hours-only bars", () => {
    expect(sliceLatestSession([])).toEqual([]);
    expect(
      sliceLatestSession([
        bar(2026, 7, 1, 12, 0), // premarket only
        bar(2026, 7, 1, 21, 0), // after-hours only
      ]),
    ).toEqual([]);
  });
});
