/**
 * Verified lens registry for the Committee Planner (DeepFund pattern).
 *
 * A planner may SELECT which specialist lenses run for a ticker, but only
 * from this registry — a proposal naming anything else is rejected wholesale
 * and the committee runs every lens (parallel mode, the default). The three
 * synthesis agents (bull/bear/risk critic) are never selectable: they always
 * run, so every read keeps its adversarial check and risk ceiling.
 */
import type { AgentName } from "./types";

/** Lenses a planner may include or omit, in canonical run order. */
export const SELECTABLE_LENSES = [
  "technical",
  "pattern",
  "regime",
  "order_flow",
  "catalyst",
  "position",
  "memory",
  "sentiment",
] as const;
export type SelectableLens = (typeof SELECTABLE_LENSES)[number];

/** Always run regardless of any plan — the committee's safety spine. */
export const ALWAYS_RUN: readonly AgentName[] = ["bull_case", "bear_case", "risk_critic"];

export interface LensSelectionValidation {
  ok: boolean;
  /** Validated selection in canonical order; null means "run everything". */
  lenses: SelectableLens[] | null;
  issues: string[];
}

/**
 * Validates a planner proposal. Fail-open BY DESIGN: any violation returns
 * lenses=null ("run all") — a broken planner can never shrink coverage below
 * the deterministic default, only a valid plan can.
 */
export function validateLensSelection(input: unknown): LensSelectionValidation {
  const issues: string[] = [];
  if (!Array.isArray(input)) {
    return { ok: false, lenses: null, issues: ["selection must be an array of lens names"] };
  }
  const names = input.filter((v): v is string => typeof v === "string");
  if (names.length !== input.length) issues.push("selection contains non-string entries");

  const registry = new Set<string>(SELECTABLE_LENSES);
  for (const name of names) {
    if (!registry.has(name)) issues.push(`unknown lens: ${name} (planner may not invent agents)`);
  }
  const unique = [...new Set(names)];
  if (unique.length !== names.length) issues.push("selection contains duplicates");
  if (unique.length === 0) issues.push("selection is empty");

  if (issues.length > 0) return { ok: false, lenses: null, issues };
  // Canonical order regardless of proposal order — deterministic output.
  const ordered = SELECTABLE_LENSES.filter((l) => unique.includes(l));
  return { ok: true, lenses: [...ordered], issues: [] };
}
