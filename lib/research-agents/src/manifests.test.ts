import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { loadAgentManifest } from "@workspace/research-contracts";

const dir = join(import.meta.dirname, "..", "manifests");

describe("wave-2 agent manifests", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));

  it("covers the seven research agents plus the two wave-3 committee agents", () => {
    expect(files.sort()).toEqual([
      "catalyst-verifier.yaml",
      "committee-planner.yaml",
      "ipo-dilution-analyst.yaml",
      "judge-panel.yaml",
      "macro-context-analyst.yaml",
      "market-research-lead.yaml",
      "second-verifier.yaml",
      "sentiment-analyst.yaml",
      "source-guardian.yaml",
    ]);
  });

  for (const file of files) {
    it(`${file} validates with a stable manifest hash`, () => {
      const { manifest, manifestHash } = loadAgentManifest(readFileSync(join(dir, file), "utf8"));
      expect(manifest.id).toBe(file.replace(".yaml", ""));
      expect(["research", "committee"]).toContain(manifest.category);
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
