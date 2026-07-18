// artifacts/api-server/src/lib/providers/alpacaAssets.test.ts
import { describe, it, expect } from "vitest";
import { mapAsset } from "./alpacaAssets.js";

describe("mapAsset", () => {
  it("maps a tradable us_equity asset", () => {
    const raw = {
      symbol: "RUNR", name: "Runner Inc", exchange: "NASDAQ", class: "us_equity",
      status: "active", tradable: true, shortable: false, easy_to_borrow: false,
      marginable: true, fractionable: true,
    };
    expect(mapAsset(raw)).toEqual({
      symbol: "RUNR", name: "Runner Inc", exchange: "NASDAQ", class: "us_equity",
      status: "active", tradable: true, shortable: false, easyToBorrow: false,
      marginable: true, fractionable: true,
    });
  });
  it("returns null for a row without a symbol", () => {
    expect(mapAsset({ name: "x" } as Record<string, unknown>)).toBeNull();
  });
  it("coerces missing booleans to false", () => {
    const r = mapAsset({ symbol: "X", class: "us_equity", exchange: "NYSE", status: "active" });
    expect(r).not.toBeNull();
    expect(r!.tradable).toBe(false);
    expect(r!.easyToBorrow).toBe(false);
  });
});
