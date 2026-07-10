import { db, journalEntriesTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import {
  buildCopilotEvent,
  computeScoreboard,
  journalOutcomeToSample,
  type BuildEventInput,
  type CopilotEvent,
  type TradeSample,
  type TriggerStack,
  type ValidationSnapshot,
} from "@workspace/copilot-core";
import { logger } from "./logger.js";

// Memory-loop wiring: the measured, journal-derived edge for the fired trigger
// stack is injected into the event so the memory agent (and alert level, and the
// validation gate) reflect REAL data instead of a placeholder. Journal-derived
// on purpose — the `validation_state` table is intentionally unused (the live
// scoreboard is computed on the fly from outcomes and cannot drift).

const DEFAULT_VALIDATION: ValidationSnapshot = {
  status: "insufficient_sample",
  sampleCount: 0,
  expectancyR: null,
};

/** Fired primary-edge trigger → its hypothesis name (strip the _LONG/_SHORT
 * side suffix). Refinement-only or empty stacks have no measurable hypothesis. */
function hypothesisForStack(stack: TriggerStack): string | null {
  if (stack.category !== "primary_edge" || !stack.stackName || stack.stackName === "NONE") {
    return null;
  }
  return stack.stackName.replace(/_(LONG|SHORT)$/, "");
}

async function loadJournalSamples(): Promise<TradeSample[]> {
  // Only mode + manualOutcome are needed to build a sample — select just those.
  const rows = await db
    .select({
      mode: journalEntriesTable.mode,
      manualOutcome: journalEntriesTable.manualOutcome,
    })
    .from(journalEntriesTable)
    .orderBy(desc(journalEntriesTable.createdAt))
    .limit(2000);
  const samples: TradeSample[] = [];
  for (const row of rows) {
    const sample = journalOutcomeToSample({ mode: row.mode, manualOutcome: row.manualOutcome });
    if (sample) samples.push(sample);
  }
  return samples;
}

// The scoreboard only changes when a journal outcome is added; a short TTL cache
// keeps a burst of per-symbol event/explain requests from re-querying and
// recomputing it every time. Per-instance is fine — 30s staleness on a
// measured-edge signal is immaterial.
let cachedScores: ReturnType<typeof computeScoreboard> | null = null;
let cacheStampMs = 0;
const CACHE_TTL_MS = 30_000;

async function currentScoreboard(): Promise<ReturnType<typeof computeScoreboard>> {
  const now = Date.now();
  if (!cachedScores || now - cacheStampMs > CACHE_TTL_MS) {
    cachedScores = computeScoreboard(await loadJournalSamples());
    cacheStampMs = now;
  }
  return cachedScores;
}

/**
 * Measured-edge validation for the event's fired edge. Falls back to
 * insufficient_sample on any error (no journal data, DB unavailable, no primary
 * edge) so a lookup failure can NEVER block or alter an event beyond leaving it
 * at the honest default.
 */
export async function resolveValidation(stack: TriggerStack): Promise<ValidationSnapshot> {
  const hypothesis = hypothesisForStack(stack);
  if (!hypothesis) return DEFAULT_VALIDATION;
  try {
    const scores = await currentScoreboard();
    const score = scores.find((s) => s.hypothesisName === hypothesis);
    if (!score) return DEFAULT_VALIDATION;
    return {
      status: score.validationStatus,
      sampleCount: score.sampleCount,
      expectancyR: score.expectancyR,
    };
  } catch (err) {
    // Keep the fail-safe fallback (a DB blip must never block/alter a live event), but log at
    // ERROR: reaching here means the read-back is BROKEN, which is different from the normal
    // "no journal data yet" path (that returns DEFAULT above without throwing). Surfacing it as
    // error makes a silently-broken memory loop alertable instead of indistinguishable from empty.
    logger.error({ err: String(err), hypothesis }, "validation read-back FAILED; falling back to insufficient_sample");
    return DEFAULT_VALIDATION;
  }
}

/**
 * Build a live event with real measured-edge validation. Two-pass: the first
 * build determines the trigger stack (validation never affects it); the second
 * rebuilds with the resolved snapshot so the alert level, validation gate, and
 * memory agent all reflect it. Used only by the LIVE routes — replay stays
 * deterministic on the default snapshot.
 */
export async function buildEventWithValidation(input: BuildEventInput): Promise<CopilotEvent> {
  const draft = buildCopilotEvent(input);
  const validation = await resolveValidation(draft.triggerStack);
  return buildCopilotEvent({ ...input, validation });
}
