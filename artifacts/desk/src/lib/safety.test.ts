import { describe, it, expect } from "vitest";
import {
  safeText,
  safeList,
  redactForbidden,
  scanForbidden,
  hasForbiddenLanguage,
  FORBIDDEN_PHRASES,
} from "./safety";

describe("desk client safety layer", () => {
  it("shares the committee forbidden vocabulary (no local duplication)", () => {
    expect(FORBIDDEN_PHRASES.length).toBeGreaterThan(0);
    expect(FORBIDDEN_PHRASES).toContain("execute");
    expect(FORBIDDEN_PHRASES).toContain("buy now");
    expect(FORBIDDEN_PHRASES).toContain("guaranteed");
  });

  it("passes clean analyst prose through unchanged", () => {
    const clean = "The setup remains a watch-only zone; wait for confirmation above VWAP.";
    expect(scanForbidden(clean)).toEqual([]);
    expect(safeText(clean)).toBe(clean);
    expect(hasForbiddenLanguage(clean)).toBe(false);
  });

  it("redacts execution-implying language before render", () => {
    const dirty = "You should buy now — this is a guaranteed move, execute immediately.";
    expect(scanForbidden(dirty).length).toBeGreaterThan(0);
    const safe = safeText(dirty);
    expect(safe).not.toMatch(/buy now/i);
    expect(safe).not.toMatch(/guaranteed/i);
    expect(safe).not.toMatch(/execute/i);
    expect(safe).toContain("[redacted]");
  });

  it("redacts case-insensitively", () => {
    expect(redactForbidden("GUARANTEED gains")).not.toMatch(/guaranteed/i);
    expect(redactForbidden("Place Order at open")).not.toMatch(/place order/i);
  });

  it("handles nullish and non-string input safely", () => {
    expect(safeText(null)).toBe("");
    expect(safeText(undefined, "n/a")).toBe("n/a");
    expect(safeList(null)).toEqual([]);
    expect(safeList(undefined)).toEqual([]);
  });

  it("sanitizes arrays of analyst strings", () => {
    const out = safeList(["wait for the retest", "load up here", "trail the stop"]);
    expect(out).toHaveLength(3);
    expect(out[1]).not.toMatch(/load up/i);
    expect(out[1]).toContain("[redacted]");
    expect(out[0]).toBe("wait for the retest");
  });
});
