import { describe, it, expect } from "vitest";
import {
  DEDUCTION_RUBRIC,
  gradeFinding,
  median,
  scoreFromVerdict,
  type JudgeProvider,
} from "./judgePanel";

const judge = (raw: unknown, name = "fake"): JudgeProvider => ({ name, judge: async () => raw });

const FINDING = {
  findingType: "CatalystRecord",
  findingId: "cat_01",
  symbol: "RGTI",
  text: "Government contract award announced pre-market.",
  evidence: { verificationStatus: "CONFIRMED", primarySourceCount: 1 },
};

describe("scoreFromVerdict (deduction-only)", () => {
  it("starts at 100 and subtracts cited deductions", () => {
    const { score } = scoreFromVerdict({
      deductions: [
        { code: "WEAK_EVIDENCE", points: 20, reason: "single source" },
        { code: "VAGUE_TIMING", points: 10, reason: "no event time" },
      ],
    });
    expect(score).toBe(70);
  });

  it("clamps each deduction to its rubric ceiling — judges cannot nuke a finding on one axis", () => {
    const { score, deductions } = scoreFromVerdict({
      deductions: [{ code: "OVERCLAIM", points: 90, reason: "way too strong" }],
    });
    expect(deductions[0]!.points).toBe(DEDUCTION_RUBRIC.OVERCLAIM.maxPoints);
    expect(score).toBe(100 - DEDUCTION_RUBRIC.OVERCLAIM.maxPoints);
  });

  it("floors the total at zero", () => {
    const { score } = scoreFromVerdict({
      deductions: (Object.keys(DEDUCTION_RUBRIC) as Array<keyof typeof DEDUCTION_RUBRIC>).map(
        (code) => ({ code, points: 100, reason: "everything is wrong" }),
      ),
    });
    expect(score).toBe(0);
  });
});

describe("median", () => {
  it("odd and even counts", () => {
    expect(median([80, 100, 60])).toBe(80);
    expect(median([60, 100])).toBe(80);
    expect(median([70])).toBe(70);
  });
});

describe("gradeFinding (multi-judge panel)", () => {
  it("takes the median — one hostile judge cannot move the grade", async () => {
    const grade = await gradeFinding({
      ...FINDING,
      judges: [
        judge({ deductions: [] }, "lenient"),
        judge({ deductions: [{ code: "WEAK_EVIDENCE", points: 10, reason: "thin" }] }, "middle"),
        judge({ deductions: [{ code: "OVERCLAIM", points: 30, reason: "no" }, { code: "WEAK_EVIDENCE", points: 30, reason: "no" }] }, "hostile"),
      ],
    });
    expect(grade!.judgeCount).toBe(3);
    expect(grade!.medianScore).toBe(90); // scores 100, 90, 40 → median 90
  });

  it("drops malformed and crashing judges instead of guessing", async () => {
    const crash: JudgeProvider = { name: "boom", judge: async () => { throw new Error("x"); } };
    const grade = await gradeFinding({
      ...FINDING,
      judges: [
        judge({ deductions: [{ code: "NOT_A_CODE", points: 10, reason: "?" }] }, "invalid"),
        crash,
        judge({ deductions: [] }, "ok"),
      ],
    });
    expect(grade!.judgeCount).toBe(1);
    expect(grade!.medianScore).toBe(100);
    expect(grade!.scores[0]!.judge).toBe("ok");
  });

  it("zero valid judges → null; a grade is never invented", async () => {
    expect(await gradeFinding({ ...FINDING, judges: [] })).toBeNull();
    expect(await gradeFinding({ ...FINDING, judges: [judge("garbage")] })).toBeNull();
  });
});
