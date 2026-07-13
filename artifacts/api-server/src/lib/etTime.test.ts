import { describe, it, expect } from "vitest";
import { etEpochMs, etIso, etOffset } from "./etTime.js";

describe("etOffset (DST-correct, the -04:00 hardcode regression)", () => {
  it("summer dates are EDT (-04:00)", () => {
    expect(etOffset("2026-06-12")).toBe("-04:00");
    expect(etOffset("2026-07-13")).toBe("-04:00");
  });

  it("winter dates are EST (-05:00) — the case the hardcodes got wrong", () => {
    expect(etOffset("2026-01-13")).toBe("-05:00");
    expect(etOffset("2026-12-01")).toBe("-05:00");
  });

  it("straddles the 2026 DST transitions correctly", () => {
    expect(etOffset("2026-03-07")).toBe("-05:00"); // day before spring-forward
    expect(etOffset("2026-03-09")).toBe("-04:00"); // day after (Mar 8)
    expect(etOffset("2026-10-31")).toBe("-04:00"); // day before fall-back
    expect(etOffset("2026-11-02")).toBe("-05:00"); // day after (Nov 1)
  });
});

describe("etIso / etEpochMs", () => {
  it("a January 08:30 ET is 13:30 UTC, not 12:30", () => {
    expect(etIso("2026-01-13", "08:30:00")).toBe("2026-01-13T08:30:00-05:00");
    expect(new Date(etEpochMs("2026-01-13", "08:30:00")).toISOString()).toBe("2026-01-13T13:30:00.000Z");
  });

  it("a June 08:30 ET is 12:30 UTC", () => {
    expect(new Date(etEpochMs("2026-06-12", "08:30:00")).toISOString()).toBe("2026-06-12T12:30:00.000Z");
  });
});
