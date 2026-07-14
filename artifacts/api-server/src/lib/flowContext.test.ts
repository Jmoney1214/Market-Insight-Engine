import { describe, it, expect } from "vitest";
import { computeFlowContext } from "./flowContext.js";

const rows = [
  { sector: "Technology", changesPct: 1.8 },
  { sector: "Energy", changesPct: 0.6 },
  { sector: "Financials", changesPct: 0.3 },
  { sector: "Healthcare", changesPct: 0.2 },
  { sector: "Utilities", changesPct: -0.4 },
  { sector: "Real Estate", changesPct: -0.9 },
];

describe("computeFlowContext", () => {
  it("normalizes scores to [-1,1] against the strongest mover", () => {
    const ctx = computeFlowContext(rows, "2026-07-13T13:00:00Z")!;
    expect(ctx.scores["Technology"]).toBe(1);
    expect(ctx.scores["Real Estate"]).toBe(-0.5);
    expect(ctx.leaders[0]).toBe("Technology");
    expect(ctx.laggards[0]).toBe("Real Estate");
  });

  it("computes breadth and tilt deterministically", () => {
    const ctx = computeFlowContext(rows, "t")!;
    expect(ctx.breadth).toBeCloseTo(4 / 6, 2);
    expect(ctx.tilt).toBe("RISK_ON");
    const bearish = rows.map((r) => ({ ...r, changesPct: -Math.abs(r.changesPct) }));
    expect(computeFlowContext(bearish, "t")!.tilt).toBe("RISK_OFF");
  });

  it("returns null on empty input instead of fabricating", () => {
    expect(computeFlowContext([], "t")).toBeNull();
  });
});
