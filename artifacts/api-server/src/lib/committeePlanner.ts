/**
 * Committee Planner (DeepFund pattern) — an LLM proposes WHICH lenses to run
 * for one ticker; deterministic code validates the proposal against the
 * verified lens registry. Fail-open: an invalid, empty, or crashing proposal
 * means ALL lenses run (parallel mode, the default). The planner can narrow
 * work, never widen it, and can never invent an agent.
 *
 * Opt-in via COMMITTEE_PLANNER=on — with it unset the committee behaves
 * exactly as before (every lens, no extra model call, no added latency).
 */
import { z } from "zod/v4";
import {
  SELECTABLE_LENSES,
  validateLensSelection,
  type SelectableLens,
} from "@workspace/copilot-committee";
import type { CopilotEvent } from "@workspace/copilot-core";
import { configuredProviders, getPlannerCompletion, selectBackbones } from "./researchProviders.js";
import { logger } from "./logger.js";

const PLANNER_SYSTEM = [
  "You are the committee planner for a day-trading research terminal.",
  "Given one ticker's deterministic event summary, choose which specialist lenses are worth running for THIS read.",
  `You may pick ONLY from this registry: ${SELECTABLE_LENSES.join(", ")}.`,
  "Bias toward inclusion — omit a lens only when it clearly cannot contribute (e.g. no position exists → position lens optional).",
  'Produce ONLY a JSON object: {"lenses": ["technical", ...]}.',
].join(" ");

const PlannerProposal = z.strictObject({ lenses: z.array(z.string()).min(1).max(8) });

export function plannerEnabled(): boolean {
  return process.env["COMMITTEE_PLANNER"]?.trim().toLowerCase() === "on";
}

/**
 * Per-ticker lens selection, or null for "run everything". Never throws.
 */
export async function planLenses(event: CopilotEvent): Promise<SelectableLens[] | null> {
  if (!plannerEnabled()) return null;
  const backbone = selectBackbones(configuredProviders(), process.env["COPILOT_LLM_PROVIDER"]).primary;
  if (!backbone) return null;

  try {
    const raw = await getPlannerCompletion(backbone.id, PLANNER_SYSTEM, JSON.stringify({
      symbol: event.symbol,
      alertLevel: event.alertLevel,
      l5Blocked: event.l5Blocked,
      mode: event.mode,
      warnings: event.warnings,
    }));
    const proposal = PlannerProposal.safeParse(raw);
    if (!proposal.success) return null;
    const validated = validateLensSelection(proposal.data.lenses);
    if (!validated.ok) {
      logger.warn({ issues: validated.issues, symbol: event.symbol }, "Planner proposal rejected; running all lenses");
      return null;
    }
    return validated.lenses;
  } catch (err) {
    logger.warn({ err: String(err), symbol: event.symbol }, "Planner unavailable; running all lenses");
    return null;
  }
}
