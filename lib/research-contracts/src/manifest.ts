/**
 * Agent manifests — the SOLE configuration source for every agent.
 *
 * Rules (research-layer buildout §4/§9; Anthropic/OpenAI agent guidance):
 * - default-deny tools: explicit allowlist, no wildcards, banned surfaces
 *   (shell/broker/DDL/browser-eval) rejected at load time;
 * - budgets are mandatory: model calls, tool calls, wall seconds, cost;
 * - a declared failure mode is mandatory — agents fail in a designed way;
 * - an eval-suite reference is mandatory — no evals, no agent;
 * - tier "none" = deterministic component: zero model calls allowed;
 * - manifestHash (canonical SHA-256) is the agent's config identity, stamped
 *   onto every row the agent writes.
 */
import { z } from "zod/v4";
import { parse as parseYaml } from "yaml";
import { canonicalSha256 } from "./canonical";

export const FailureMode = z.enum([
  "RETURN_UNKNOWN",
  "FAIL_CLOSED",
  "RETURN_PARTIAL_OR_BLOCKED",
  "RETURN_NOT_REQUIRED",
  "ABSTAIN",
]);

export const ModelTier = z.enum(["deep", "quick", "none"]);

const BANNED_TOOL_SUBSTRINGS = [
  "*",
  "shell",
  "bash",
  "exec",
  "spawn",
  "broker",
  "order.place",
  "order.cancel",
  "order.modify",
  "account.",
  "ddl",
  "sql.raw",
  "ui_evaluate",
  "browser.evaluate",
  "fs.write",
];

const Budgets = z.strictObject({
  maximum_model_calls: z.int().min(0),
  maximum_tool_calls: z.int().min(0),
  maximum_seconds: z.int().min(1),
  maximum_cost_usd: z.number().min(0),
});

export const AgentManifest = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "kebab-case id required"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    description: z.string().min(8),
    category: z.enum([
      "scanner",
      "research",
      "committee",
      "pine",
      "signal",
      "memory",
      "grading",
      "forecast",
      "reports",
      "infra",
    ]),
    model_policy: z.strictObject({
      tier: ModelTier,
      structured_output: z.boolean(),
    }),
    allowed_tools: z.array(z.string().min(1)),
    read_scopes: z.array(z.string()),
    write_scopes: z.array(z.string()),
    budgets: Budgets,
    failure_mode: FailureMode,
    eval_suite: z.string().min(1),
    deterministic_guards: z.array(z.string()),
    memory_policy: z.enum(["current_run_only", "gated_cross_run"]),
  })
  .superRefine((m, ctx) => {
    for (const tool of m.allowed_tools) {
      const hit = BANNED_TOOL_SUBSTRINGS.find((b) => tool.includes(b));
      if (hit) {
        ctx.addIssue({ code: "custom", message: `banned tool surface "${hit}" in allowed_tools: ${tool}`, path: ["allowed_tools"] });
      }
    }
    if (m.model_policy.tier === "none" && m.budgets.maximum_model_calls !== 0) {
      ctx.addIssue({ code: "custom", message: "deterministic agents (tier none) must declare maximum_model_calls: 0", path: ["budgets", "maximum_model_calls"] });
    }
    if (m.model_policy.tier !== "none" && m.budgets.maximum_model_calls < 1) {
      ctx.addIssue({ code: "custom", message: "LLM agents must declare maximum_model_calls >= 1", path: ["budgets", "maximum_model_calls"] });
    }
    if (m.model_policy.tier !== "none" && !m.model_policy.structured_output) {
      ctx.addIssue({ code: "custom", message: "LLM agents must use structured outputs (2026 standard)", path: ["model_policy", "structured_output"] });
    }
  });

export type AgentManifest = z.infer<typeof AgentManifest>;

export interface LoadedManifest {
  manifest: AgentManifest;
  /** Canonical SHA-256 of the manifest — the agent's config identity. */
  manifestHash: string;
}

/** Parse + validate a YAML manifest; throws with readable issues on any violation. */
export function loadAgentManifest(yamlSource: string): LoadedManifest {
  const raw: unknown = parseYaml(yamlSource);
  const parsed = AgentManifest.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid agent manifest: ${issues}`);
  }
  return {
    manifest: parsed.data,
    manifestHash: canonicalSha256(parsed.data as unknown as Record<string, unknown>, "__none__"),
  };
}
