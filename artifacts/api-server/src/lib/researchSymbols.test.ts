import { describe, expect, it } from "vitest";
import { isRankableResearchSymbol } from "./researchSymbols.js";

describe("isRankableResearchSymbol", () => {
  it("rejects reserved research endpoint names from accuracy rankings", () => {
    expect(isRankableResearchSymbol("ACCURACY")).toBe(false);
  });

  it("accepts normal ticker symbols", () => {
    expect(isRankableResearchSymbol("AAPL")).toBe(true);
    expect(isRankableResearchSymbol("BRK-B")).toBe(true);
  });
});
