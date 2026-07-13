/**
 * Judge-panel wiring: builds independent judges from the configured LLM
 * backbones, grades a research run's catalyst records, and lands scores in
 * the unified finding_grades ledger. Two providers configured → two different backbones judge;
 * one provider → its quick AND deep tiers judge (still independent runs).
 * Best-effort: grading failure never affects the research response.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, findingGradesTable } from "@workspace/db";
import { gradeFinding, type FindingGrade, type JudgeProvider } from "@workspace/research-agents";
import type { LeadRunResult } from "@workspace/research-agents";
import {
  backboneLabel,
  completeOnBackbone,
  configuredProviders,
  type ModelTier,
} from "./researchProviders.js";
import type { LlmProviderId } from "@workspace/copilot-committee";
import { logger } from "./logger.js";

const JUDGE_SYSTEM = [
  "You are one judge on a deduction-only grading panel for trading research findings.",
  "The finding starts at 100 points. You may ONLY subtract points, ONLY for the rubric categories provided, each with a one-sentence cited reason grounded in the finding/evidence given.",
  "Do not award points, do not exceed a category's maxPoints, and do not invent categories.",
  'Produce ONLY a JSON object: {"deductions":[{"code": <rubric code>, "points": <number>, "reason": <string>}]} — an empty deductions array means a perfect 100.',
].join(" ");

function judgeOn(id: LlmProviderId, tier: ModelTier): JudgeProvider {
  return {
    name: backboneLabel(id, tier),
    judge: (input) => completeOnBackbone(id, tier, JUDGE_SYSTEM, JSON.stringify(input)),
  };
}

/** Independent judge panel from whatever is configured; [] when nothing is. */
export function getJudgePanel(): JudgeProvider[] {
  const configured = configuredProviders();
  if (configured.length === 0) return [];
  if (configured.length === 1) {
    const id = configured[0]!;
    return [judgeOn(id, "quick"), judgeOn(id, "deep")];
  }
  return configured.slice(0, 3).map((id) => judgeOn(id, "quick"));
}

/** Grades every catalyst record in a run and persists the grades. */
export async function judgeLeadRun(result: LeadRunResult): Promise<FindingGrade[]> {
  const judges = getJudgePanel();
  if (judges.length === 0) return [];
  const packet = result.packet;

  const grades: FindingGrade[] = [];
  try {
    // Secondary verifications are judged alongside the merged records — the
    // accuracy ranker attributes them via the _b id suffix.
    const records = [...result.catalystRecords, ...result.secondaryCatalysts];

    // One row per finding lifecycle: a resumed run reuses its runId and
    // therefore its catalyst ids — never judge the same finding twice.
    const existing = await db
      .select({ findingRef: findingGradesTable.findingRef })
      .from(findingGradesTable)
      .where(
        and(
          eq(findingGradesTable.findingType, "CatalystRecord"),
          isNotNull(findingGradesTable.judgedAt),
          inArray(findingGradesTable.findingRef, records.map((r) => r.catalystId)),
        ),
      );
    const alreadyJudged = new Set(existing.map((e) => e.findingRef));

    for (const record of records.filter((r) => !alreadyJudged.has(r.catalystId))) {
      const grade = await gradeFinding({
        findingType: "CatalystRecord",
        findingId: record.catalystId,
        symbol: record.symbol,
        text: record.eventDescription,
        evidence: {
          verificationStatus: record.verificationStatus,
          materiality: record.materiality,
          primarySourceCount: record.primarySourceIds.length,
          secondarySourceCount: record.secondarySourceIds.length,
          conflictCount: record.conflictIds.length,
          publicationTime: record.publicationTime,
          eventTime: record.eventTime,
          firstKnownTime: record.firstKnownTime,
          duplicateClusterId: record.duplicateClusterId,
          unknownFields: record.unknownFields,
        },
        judges,
      });
      if (grade) grades.push(grade);
    }

    if (grades.length > 0) {
      // Unified ledger row: ex-ante judge columns now; the outcome grader
      // fills grade/realized columns on this row after the window closes.
      await db.insert(findingGradesTable).values(
        grades.map((g) => ({
          findingType: g.findingType,
          findingRef: g.findingId,
          symbol: g.symbol,
          runId: packet.provenance.runId,
          packetId: packet.packetId,
          judgeMedianScore: g.medianScore,
          judgeCount: g.judgeCount,
          judgeScores: g.scores,
          judgedAt: new Date(),
        })),
      );
    }
  } catch (err) {
    logger.warn({ err: String(err), packetId: packet.packetId }, "Judge panel failed (non-fatal)");
  }
  return grades;
}
