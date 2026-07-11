import { describe, expect, it } from "vitest";

import {
  computeAgentCalibration,
  confidenceBucket,
  type CalibrationFinding,
} from "./agentCalibration";

function finding(over: Partial<CalibrationFinding>): CalibrationFinding {
  return {
    id: 1,
    agentName: "catalyst-scout",
    verdict: "support",
    confidence: 0.85,
    provenanceSource: "catalyst-scout",
    gitSha: "e4fe36c",
    grades: [],
    ...over,
  };
}

describe("confidenceBucket", () => {
  it("buckets into fixed 0.2 bands with 1.0 folded into the top band", () => {
    expect(confidenceBucket(0.15)).toBe("0.0-0.2");
    expect(confidenceBucket(0.2)).toBe("0.2-0.4");
    expect(confidenceBucket(0.85)).toBe("0.8-1.0");
    expect(confidenceBucket(1.0)).toBe("0.8-1.0");
    expect(confidenceBucket(Number.NaN)).toBe("0.0-0.2");
  });
});

describe("computeAgentCalibration", () => {
  it("computes hit rate and mean score per writer, hitRate = (correct + 0.5*mixed)/n", () => {
    const report = computeAgentCalibration([
      finding({ id: 1, grades: [{ grade: "correct", score: 1.0 }] }),
      finding({ id: 2, grades: [{ grade: "mixed", score: 0.5 }] }),
      finding({ id: 3, grades: [{ grade: "incorrect", score: 0.2 }] }),
      finding({ id: 4, grades: [] }), // ungraded — counts as a finding only
    ]);
    expect(report.writers).toHaveLength(1);
    const w = report.writers[0];
    expect(w.findings).toBe(4);
    expect(w.graded).toBe(3);
    expect(w.overall.hitRate).toBeCloseTo((1 + 0.5) / 3);
    expect(w.overall.meanScore).toBeCloseTo((1.0 + 0.5 + 0.2) / 3);
    expect(w.suggestedWeight).toBeCloseTo((1.0 + 0.5 + 0.2) / 3); // graded >= default minGraded
  });

  it("separates writers: same agent name, different provenance = different track records", () => {
    const report = computeAgentCalibration([
      finding({ id: 1, grades: [{ grade: "correct", score: 0.9 }] }),
      finding({
        id: 2,
        provenanceSource: "catalyst-scout/routine",
        grades: [{ grade: "incorrect", score: 0.1 }],
      }),
    ]);
    expect(report.writers).toHaveLength(2);
    const bySrc = Object.fromEntries(report.writers.map((w) => [w.writer, w]));
    expect(bySrc["catalyst-scout"].overall.hitRate).toBe(1);
    expect(bySrc["catalyst-scout/routine"].overall.hitRate).toBe(0);
  });

  it("folds historical routine gitShas via a custom classifier", () => {
    const ROUTINE_SHAS = new Set(["0e0d9e2"]);
    const report = computeAgentCalibration(
      [
        finding({ id: 1, gitSha: "e4fe36c", grades: [{ grade: "correct", score: 0.85 }] }),
        finding({ id: 2, gitSha: "0e0d9e2", grades: [{ grade: "mixed", score: 0.5 }] }),
      ],
      {
        classifyWriter: (f) =>
          ROUTINE_SHAS.has(f.gitSha) ? `${f.provenanceSource}/routine` : f.provenanceSource,
      },
    );
    expect(report.writers.map((w) => w.writer).sort()).toEqual([
      "catalyst-scout",
      "catalyst-scout/routine",
    ]);
  });

  it("never invents a track record: ungradable-only and thin samples get weight null", () => {
    const report = computeAgentCalibration([
      finding({ id: 1, agentName: "edge-curator", grades: [{ grade: "ungradable", score: null }] }),
      finding({ id: 2, agentName: "risk-auditor", grades: [{ grade: "correct", score: 0.7 }] }),
    ]);
    const curator = report.writers.find((w) => w.agentName === "edge-curator")!;
    expect(curator.graded).toBe(0);
    expect(curator.suggestedWeight).toBeNull();
    const auditor = report.writers.find((w) => w.agentName === "risk-auditor")!;
    expect(auditor.graded).toBe(1); // below minGraded=3
    expect(auditor.suggestedWeight).toBeNull();
    expect(report.ungradableOnly).toBe(1);
  });

  it("splits by verdict and confidence bucket (the scout's skeptical-tail signal)", () => {
    const report = computeAgentCalibration([
      finding({ id: 1, verdict: "neutral", confidence: 0.25, grades: [{ grade: "correct", score: 0.7 }] }),
      finding({ id: 2, verdict: "neutral", confidence: 0.15, grades: [{ grade: "correct", score: 0.7 }] }),
      finding({ id: 3, verdict: "support", confidence: 0.85, grades: [{ grade: "mixed", score: 0.5 }] }),
    ]);
    const w = report.writers[0];
    expect(w.byVerdict["neutral"].hitRate).toBe(1);
    expect(w.byVerdict["support"].hitRate).toBe(0.5);
    expect(w.byConfidenceBucket["0.0-0.2"].n).toBe(1);
    expect(w.byConfidenceBucket["0.2-0.4"].n).toBe(1);
    expect(w.byConfidenceBucket["0.8-1.0"].n).toBe(1);
  });
});
