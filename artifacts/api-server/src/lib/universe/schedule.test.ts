// artifacts/api-server/src/lib/universe/schedule.test.ts
import { describe, it, expect } from "vitest";
import { isFullRebuildWindowET, isPreOpenWindowET, etDateKey } from "./schedule.js";

// helper: build a Date at a given America/New_York wall-clock hour on a weekday.
// 2026-07-20 is a Monday. EDT = UTC-4 in July.
const at = (hourET: number, min = 0) => new Date(Date.UTC(2026, 6, 20, hourET + 4, min));

describe("isFullRebuildWindowET", () => {
  it("true at 18:30 ET on a weekday", () => expect(isFullRebuildWindowET(at(18, 30))).toBe(true));
  it("false at 15:00 ET", () => expect(isFullRebuildWindowET(at(15))).toBe(false));
  it("false on a weekend", () => {
    const sun = new Date(Date.UTC(2026, 6, 19, 22, 30)); // 18:30 ET Sunday
    expect(isFullRebuildWindowET(sun)).toBe(false);
  });
});

describe("isPreOpenWindowET", () => {
  it("true at 07:00 ET on a weekday", () => expect(isPreOpenWindowET(at(7, 0))).toBe(true));
  it("false at 09:45 ET", () => expect(isPreOpenWindowET(at(9, 45))).toBe(false));
});

describe("etDateKey", () => {
  it("returns the America/New_York calendar date, not the UTC date", () => {
    // 2026-01-06T00:30Z is still 2026-01-05 19:30 in EST (UTC-5)
    expect(etDateKey(new Date("2026-01-06T00:30:00Z"))).toBe("2026-01-05");
  });
  it("is stable across the EST rebuild window (no mid-window flip)", () => {
    const early = etDateKey(new Date("2026-01-05T23:30:00Z")); // 18:30 ET
    const late = etDateKey(new Date("2026-01-06T00:30:00Z"));  // 19:30 ET, next UTC day
    expect(early).toBe(late);
    expect(early).toBe("2026-01-05");
  });
});
