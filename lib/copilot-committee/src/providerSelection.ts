// Pure, dependency-free provider-selection and model-tiering logic.
//
// SAFETY: this module only DECIDES which LLM provider/model tier to use. It
// never touches any SDK and never influences the deterministic read. Keeping it
// pure makes the selection path unit-testable without any live AI call.

/** The LLM providers the committee can route prose enrichment through. */
export type LlmProviderId = "openai" | "gemini" | "anthropic";

/** Which model size to use for a given event. */
export type ModelTier = "quick" | "deep";

/** Preference order used when no provider is explicitly requested. */
export const PROVIDER_PREFERENCE: readonly LlmProviderId[] = [
  "openai",
  "gemini",
  "anthropic",
];

function isLlmProviderId(value: string): value is LlmProviderId {
  return (PROVIDER_PREFERENCE as readonly string[]).includes(value);
}

/**
 * Chooses the active provider, env-gated and safe-by-default.
 *
 * - If `requested` names a provider, it is honored ONLY when that provider is
 *   configured; otherwise selection fails closed to `null` (deterministic).
 *   Explicit intent is never silently redirected to a different provider.
 * - If `requested` is empty/unknown, the first configured provider in
 *   {@link PROVIDER_PREFERENCE} order is chosen.
 * - When nothing is configured, returns `null` so the committee stays fully
 *   deterministic — the default in development and tests.
 */
export function selectProviderId(opts: {
  requested?: string | null;
  configured: Record<LlmProviderId, boolean>;
}): LlmProviderId | null {
  const requested = opts.requested?.trim().toLowerCase();

  if (requested && requested.length > 0) {
    if (!isLlmProviderId(requested)) return null;
    return opts.configured[requested] ? requested : null;
  }

  for (const id of PROVIDER_PREFERENCE) {
    if (opts.configured[id]) return id;
  }
  return null;
}

/**
 * Routine reads use the cheaper "quick" model; only escalations use the more
 * capable "deep" model. An escalation is a hard-blocked event or a high alert
 * level (L4/L5) — exactly the cases where careful wording matters most.
 */
export function selectModelTier(ctx: {
  alertLevel: string | null;
  l5Blocked: boolean;
}): ModelTier {
  if (ctx.l5Blocked) return "deep";
  if (ctx.alertLevel === "L4" || ctx.alertLevel === "L5") return "deep";
  return "quick";
}
