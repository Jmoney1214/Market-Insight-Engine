import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { loadAgentManifest } from "@workspace/research-contracts";

const dir = join(import.meta.dirname, "..", "manifests");

describe("wave-2 agent manifests", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));

  it("covers research (7), committee (2), memory (4), grading (2), forecast (2)", () => {
    expect(files.sort()).toEqual([
      "agent-accuracy-ranker.yaml",
      "catalyst-verifier.yaml",
      "committee-planner.yaml",
      "decision-memory.yaml",
      "event-study-grader.yaml",
      "ipo-dilution-analyst.yaml",
      "judge-panel.yaml",
      "kronos-calibrator.yaml",
      "kronos-forecaster.yaml",
      "macro-context-analyst.yaml",
      "market-research-lead.yaml",
      "memory-retrieval-ranker.yaml",
      "outcome-reinforcer.yaml",
      "second-verifier.yaml",
      "sentiment-analyst.yaml",
      "source-guardian.yaml",
      "tiered-memory-store.yaml",
    ]);
  });

  for (const file of files) {
    it(`${file} validates with a stable manifest hash`, () => {
      const { manifest, manifestHash } = loadAgentManifest(readFileSync(join(dir, file), "utf8"));
      expect(manifest.id).toBe(file.replace(".yaml", ""));
      expect(["research", "committee", "memory", "grading", "forecast"]).toContain(manifest.category);
      expect(manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      // Deterministic components declare zero model calls; LLM agents ≥ 1.
      if (manifest.model_policy.tier === "none") {
        expect(manifest.budgets.maximum_model_calls).toBe(0);
      } else {
        expect(manifest.budgets.maximum_model_calls).toBeGreaterThanOrEqual(1);
        expect(manifest.model_policy.structured_output).toBe(true);
      }
    });
  }

  it("declared failure modes match the approved wave plan", () => {
    const failureModeOf = (name: string) =>
      loadAgentManifest(readFileSync(join(dir, name), "utf8")).manifest.failure_mode;
    expect(failureModeOf("market-research-lead.yaml")).toBe("RETURN_PARTIAL_OR_BLOCKED");
    expect(failureModeOf("source-guardian.yaml")).toBe("FAIL_CLOSED");
    expect(failureModeOf("macro-context-analyst.yaml")).toBe("RETURN_NOT_REQUIRED");
    expect(failureModeOf("catalyst-verifier.yaml")).toBe("RETURN_UNKNOWN");
  });
});
