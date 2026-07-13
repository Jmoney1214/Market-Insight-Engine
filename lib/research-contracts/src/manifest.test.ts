import { describe, it, expect } from "vitest";
import { loadAgentManifest } from "./manifest";

const VALID = `
id: catalyst-verifier
version: 1.0.0
description: Verifies catalysts against primary sources.
category: research
model_policy:
  tier: deep
  structured_output: true
allowed_tools:
  - sec.get_filing
  - news.search
  - evidence.store
read_scopes: ["candidate_seed:current"]
write_scopes: ["catalyst_record:draft"]
budgets:
  maximum_model_calls: 5
  maximum_tool_calls: 24
  maximum_seconds: 120
  maximum_cost_usd: 2
failure_mode: RETURN_UNKNOWN
eval_suite: evals/catalyst-verifier.yaml
deterministic_guards: ["no_trade_language"]
memory_policy: current_run_only
`;

describe("loadAgentManifest", () => {
  it("accepts a valid manifest and produces a stable hash", () => {
    const a = loadAgentManifest(VALID);
    const b = loadAgentManifest(VALID);
    expect(a.manifest.id).toBe("catalyst-verifier");
    expect(a.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(a.manifestHash).toBe(b.manifestHash);
  });

  it("rejects wildcard and banned tool surfaces", () => {
    expect(() => loadAgentManifest(VALID.replace("- sec.get_filing", "- \"*\""))).toThrow(/banned tool/);
    expect(() => loadAgentManifest(VALID.replace("- sec.get_filing", "- shell.run"))).toThrow(/banned tool/);
    expect(() => loadAgentManifest(VALID.replace("- sec.get_filing", "- broker.connect"))).toThrow(/banned tool/);
    expect(() => loadAgentManifest(VALID.replace("- sec.get_filing", "- order.place"))).toThrow(/banned tool/);
    expect(() => loadAgentManifest(VALID.replace("- sec.get_filing", "- ui_evaluate"))).toThrow(/banned tool/);
  });

  it("requires budgets, eval suite, and failure mode", () => {
    expect(() => loadAgentManifest(VALID.replace("eval_suite: evals/catalyst-verifier.yaml", "eval_suite: \"\""))).toThrow();
    expect(() => loadAgentManifest(VALID.replace("failure_mode: RETURN_UNKNOWN", "failure_mode: WING_IT"))).toThrow();
    expect(() => loadAgentManifest(VALID.replace("maximum_seconds: 120", "maximum_seconds: 0"))).toThrow();
  });

  it("deterministic agents must declare zero model calls; LLM agents at least one", () => {
    const deterministic = VALID.replace("tier: deep", "tier: none");
    expect(() => loadAgentManifest(deterministic)).toThrow(/maximum_model_calls: 0/);
    expect(() => loadAgentManifest(VALID.replace("maximum_model_calls: 5", "maximum_model_calls: 0"))).toThrow(/>= 1/);
    const fixedDeterministic = deterministic.replace("maximum_model_calls: 5", "maximum_model_calls: 0");
    expect(loadAgentManifest(fixedDeterministic).manifest.model_policy.tier).toBe("none");
  });

  it("LLM agents must use structured outputs", () => {
    expect(() => loadAgentManifest(VALID.replace("structured_output: true", "structured_output: false"))).toThrow(/structured outputs/);
  });

  it("hash changes when config changes (config identity)", () => {
    const a = loadAgentManifest(VALID).manifestHash;
    const b = loadAgentManifest(VALID.replace("maximum_tool_calls: 24", "maximum_tool_calls: 25")).manifestHash;
    expect(a).not.toBe(b);
  });
});
