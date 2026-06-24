import { describe, expect, it } from "vitest";
import { sanitizeDeep, sanitizeNumber } from "./sanitize";

describe("sanitizeNumber", () => {
  it("replaces non-finite numbers with null", () => {
    expect(sanitizeNumber(NaN)).toBeNull();
    expect(sanitizeNumber(Infinity)).toBeNull();
    expect(sanitizeNumber(-Infinity)).toBeNull();
    expect(sanitizeNumber(42.5)).toBe(42.5);
  });
});

describe("sanitizeDeep", () => {
  it("recursively replaces non-finite numbers and preserves other values", () => {
    const input = {
      a: NaN,
      b: Infinity,
      c: -Infinity,
      d: 1.5,
      e: "ok",
      f: true,
      g: null,
      nested: { x: NaN, y: [1, Infinity, "z"] },
    };
    expect(sanitizeDeep(input)).toEqual({
      a: null,
      b: null,
      c: null,
      d: 1.5,
      e: "ok",
      f: true,
      g: null,
      nested: { x: null, y: [1, null, "z"] },
    });
  });
});
