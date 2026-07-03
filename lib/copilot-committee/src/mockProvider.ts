// Deterministic, network-free provider for tests. Never makes live LLM calls.

import type { CommitteeProvider, ProviderContext, ProviderProse } from "./types";

/**
 * Creates a safe mock provider. Pass `overrides` to simulate specific provider
 * output (including intentionally unsafe text in guardrail tests).
 */
export function createMockProvider(
  overrides?: ProviderProse | ((ctx: ProviderContext) => ProviderProse),
): CommitteeProvider {
  return {
    name: "mock",
    async enrich(ctx: ProviderContext): Promise<ProviderProse> {
      if (typeof overrides === "function") return overrides(ctx);
      if (overrides) return overrides;
      return {
        oneSentenceRead: `${ctx.symbol}: committee read is ${ctx.recommendation}. Research only.`,
      };
    },
  };
}
