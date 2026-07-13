import { describe, it, expect } from "vitest";
import { MIN_SAMPLES_TO_RANK, rankAgents, scoreAgent, topKAgents, type GradedFindingRow } from "./accuracyRanker";

const row = (over: Partial<GradedFindingRow>): GradedFindingRow => ({
  agent: "catalyst-verifier",
  verificationStatus: "CONFIRMED",
  judgeMedianScore: 90,
  eventSignificant: true,
  claimAdmitted: true,
  ...over,
});

describe("scoreAgent", () => {
  it("perfect record → faithfulness 1, false-catalyst 0, tiny brier", () => {
    const rows = Array.from({ length: 6 }, () => row({}));
    const s = scoreAgent("catalyst-verifier", rows);
    expect(s.sourceFaithfulness).toBe(1);
    expect(s.falseCatalystRate).toBe(0);
    expect(s.brier).toBeCloseTo(0.01, 5); // (0.9 − 1)²
    expect(s.ranked).toBe(true);
    expect(s.accuracyScore).toBeGreaterThan(0.95);
  });

  it("CONFIRMED calls that fizzle raise the false-catalyst rate", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => row({})),
      ...Array.from({ length: 3 }, () => row({ eventSignificant: false })),
    ];
    const s = scoreAgent("catalyst-verifier", rows);
    expect(s.falseCatalystRate).toBeCloseTo(0.5, 5);
  });

  it("missing data narrows the basis — it never scores as perfect or failing", () => {
    const rows = Array.from({ length: 6 }, () => row({ claimAdmitted: null, eventSignificant: null }));
    const s = scoreAgent("catalyst-verifier", rows);
    expect(s.sourceFaithfulness).toBeNull();
    expect(s.falseCatalystRate).toBeNull();
    expect(s.brier).toBeNull();
    expect(s.accuracyScore).toBe(0);
  });

  it("thin samples are UNRANKED, never extrapolated", () => {
    const s = scoreAgent("second-verifier", Array.from({ length: MIN_SAMPLES_TO_RANK - 1 }, () => row({})));
    expect(s.ranked).toBe(false);
  });

  it("has no profitability input — the row type carries no PnL field", () => {
    // Compile-time rule made runtime-visible: the keys are fixed.
    expect(Object.keys(row({})).sort()).toEqual([
      "agent",
      "claimAdmitted",
      "eventSignificant",
      "judgeMedianScore",
      "verificationStatus",
    ]);
  });
});

describe("rankAgents / topKAgents (predict-then-top-k)", () => {
  const byAgent = new Map<string, GradedFindingRow[]>([
    ["catalyst-verifier", Array.from({ length: 8 }, () => row({}))],
    ["second-verifier", Array.from({ length: 8 }, () => row({ eventSignificant: false }))],
    ["thin-agent", [row({})]],
  ]);

  it("ranks accurate agents first; unranked agents always sort last", () => {
    const ranked = rankAgents(byAgent);
    expect(ranked.map((a) => a.agent)).toEqual(["catalyst-verifier", "second-verifier", "thin-agent"]);
    expect(ranked.at(-1)!.ranked).toBe(false);
  });

  it("top-k excludes thin samples entirely", () => {
    const top = topKAgents(byAgent, 3);
    expect(top.map((a) => a.agent)).toEqual(["catalyst-verifier", "second-verifier"]);
  });
});
