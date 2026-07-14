/**
 * Judge Panel — ContestTrade deduction-only scoring.
 *
 * Every finding starts at 100. Judges may ONLY subtract, only for reasons in
 * the fixed rubric below, and only with a cited reason string. Deterministic
 * code clamps each deduction to the rubric's ceiling, floors the score at 0,
 * and takes the multi-judge MEDIAN — one lenient or hostile judge cannot move
 * the grade. Malformed judge output drops that judge; zero valid judges →
 * null (no grade is ever invented).
 */
import { z } from "zod/v4";

/** The complete deduction rubric — a judge may not invent a category. */
export const DEDUCTION_RUBRIC = {
  WEAK_EVIDENCE: { maxPoints: 30, description: "evidence is thin, secondary-only, or does not directly support the finding" },
  OVERCLAIM: { maxPoints: 30, description: "the finding states more than the evidence supports" },
  MISSING_INVALIDATION: { maxPoints: 20, description: "no condition is given that would prove the finding wrong" },
  STALE_EVIDENCE: { maxPoints: 20, description: "evidence is old or was already priced/republished" },
  ENTITY_DOUBT: { maxPoints: 25, description: "the evidence may concern a different entity than the ticker" },
  NUMERIC_DOUBT: { maxPoints: 25, description: "figures in the finding are inconsistent with the evidence" },
  VAGUE_TIMING: { maxPoints: 15, description: "when the event occurred/publishes is unclear" },
} as const;
export type DeductionCode = keyof typeof DEDUCTION_RUBRIC;

export const JudgeVerdict = z.strictObject({
  deductions: z.array(
    z.strictObject({
      code: z.enum(Object.keys(DEDUCTION_RUBRIC) as [DeductionCode, ...DeductionCode[]]),
      points: z.number().min(0),
      reason: z.string().min(1).max(300),
    }),
  ),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

export interface JudgeProvider {
  /** Provenance label, e.g. "openai:gpt-5-mini". */
  name: string;
  judge(input: JudgeInput): Promise<unknown>;
}

export interface JudgeInput {
  findingType: string;
  findingId: string;
  symbol: string;
  /** The finding text under judgment. */
  text: string;
  /** Whatever evidence context the caller can supply (already grounded). */
  evidence: Record<string, unknown>;
  rubric: Record<string, { maxPoints: number; description: string }>;
}

export interface JudgeScore {
  judge: string;
  score: number;
  deductions: Array<{ code: DeductionCode; points: number; reason: string }>;
}

export interface FindingGrade {
  findingType: string;
  findingId: string;
  symbol: string;
  medianScore: number;
  judgeCount: number;
  scores: JudgeScore[];
}

/** Deterministic: clamp each deduction to its rubric ceiling, floor at 0. */
export function scoreFromVerdict(verdict: JudgeVerdict): { score: number; deductions: JudgeScore["deductions"] } {
  const deductions = verdict.deductions.map((d) => ({
    code: d.code,
    points: Math.min(d.points, DEDUCTION_RUBRIC[d.code].maxPoints),
    reason: d.reason,
  }));
  const total = deductions.reduce((sum, d) => sum + d.points, 0);
  return { score: Math.max(0, 100 - total), deductions };
}

/** Median: middle value, or the mean of the two middle values (even count). */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Grades one finding with the given judge panel. Judges run independently;
 * a judge whose output is malformed or who crashes is dropped, never guessed.
 */
export async function gradeFinding(input: {
  findingType: string;
  findingId: string;
  symbol: string;
  text: string;
  evidence: Record<string, unknown>;
  judges: JudgeProvider[];
}): Promise<FindingGrade | null> {
  if (input.judges.length === 0) return null;

  const judgeInput: JudgeInput = {
    findingType: input.findingType,
    findingId: input.findingId,
    symbol: input.symbol,
    text: input.text,
    evidence: input.evidence,
    rubric: DEDUCTION_RUBRIC,
  };

  const settled = await Promise.allSettled(input.judges.map((j) => j.judge(judgeInput)));
  const scores: JudgeScore[] = [];
  settled.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    const parsed = JudgeVerdict.safeParse(result.value);
    if (!parsed.success) return;
    const { score, deductions } = scoreFromVerdict(parsed.data);
    scores.push({ judge: input.judges[i]!.name, score, deductions });
  });

  if (scores.length === 0) return null;
  return {
    findingType: input.findingType,
    findingId: input.findingId,
    symbol: input.symbol,
    medianScore: median(scores.map((s) => s.score)),
    judgeCount: scores.length,
    scores,
  };
}
