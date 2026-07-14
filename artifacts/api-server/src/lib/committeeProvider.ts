import { z } from "zod/v4";
import {
  selectModelTier,
  selectProviderId,
  type CommitteeProvider,
  type LlmProviderId,
  type ModelTier,
  type ProviderContext,
  type ProviderProse,
} from "@workspace/copilot-committee";

// SAFETY: this module is the ONLY place an LLM touches the committee, and it may
// influence prose ONLY. The orchestrator re-validates and strips anything unsafe
// and silently falls back to the deterministic read on any failure. Provider
// selection is env-gated: with no AI integration configured, getCommitteeProvider()
// returns null and the committee stays fully deterministic (the default in dev
// and tests). The provider is chosen from OpenAI / Gemini / Anthropic via the
// Replit AI integrations; a routine read uses the cheaper "quick" model and only
// escalations use the more capable "deep" model.

const SYSTEM_PROMPT = [
  "You are a read-only trading research assistant for a day-trading research terminal.",
  "A deterministic engine has already produced the single source of truth: the recommendation, confidence, biases, and supporting/contradicting evidence are FIXED and you must not change, contradict, or second-guess them.",
  "Your ONLY job is to rewrite three plain-English prose fields so a human reads the existing deterministic verdict more clearly.",
  "You must NEVER tell the user to buy, sell, enter, exit, add, or size a position, never invent prices, data, or signals, and never use order/execution language.",
  "If the event is hard-blocked, your prose must stay defensive and must not encourage any trade.",
  "Respond with a single valid JSON object and nothing else.",
].join(" ");

const proseSchema = z.object({
  oneSentenceRead: z.string().min(1),
  positionGuidance: z.array(z.string()),
  riskNotes: z.array(z.string()),
});

/** Per-provider quick (routine) and deep (escalation) model names. */
const MODELS: Record<LlmProviderId, Record<ModelTier, string>> = {
  openai: { quick: "gpt-5-mini", deep: "gpt-5.4" },
  gemini: { quick: "gemini-3-flash-preview", deep: "gemini-3.1-pro-preview" },
  anthropic: { quick: "claude-opus-4-8", deep: "claude-opus-4-8" },
};

function buildPrompt(context: ProviderContext): string {
  const det = context.deterministicRead;
  return [
    `Symbol: ${context.symbol}`,
    `Deterministic alert level: ${context.alertLevel ?? "none"}`,
    `Hard-blocked (no trade may be encouraged): ${context.l5Blocked}`,
    `Fixed recommendation (do NOT change): ${context.recommendation}`,
    `Fixed confidence (do NOT change): ${det.confidence}`,
    "",
    "Deterministic evidence (already decided — summarize, do not invent or contradict):",
    `- What supports: ${JSON.stringify(det.whatSupports)}`,
    `- What argues against: ${JSON.stringify(det.whatArguesAgainst)}`,
    `- What would confirm: ${JSON.stringify(det.whatConfirms)}`,
    `- What would invalidate: ${JSON.stringify(det.whatInvalidates)}`,
    `- Current one-sentence read: ${det.oneSentenceRead}`,
    `- Current position guidance: ${JSON.stringify(det.positionGuidance)}`,
    `- Current risk notes: ${JSON.stringify(det.riskNotes)}`,
    "",
    "Return ONLY a JSON object with EXACTLY these keys:",
    JSON.stringify(
      {
        oneSentenceRead: "one clear sentence restating the fixed read above",
        positionGuidance: ["short bullet strings; observational, never an order to transact"],
        riskNotes: ["short bullet strings describing risks to watch"],
      },
      null,
      2,
    ),
    "",
    "Rules: keep it grounded in the deterministic evidence; do not add new numbers; do not recommend buying, selling, or sizing; keep each list to 1-4 concise bullets.",
  ].join("\n");
}

/** Tolerant JSON extraction: handles models that wrap the object in prose. */
function extractProse(raw: string): ProviderProse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("provider returned no JSON object");
    }
    parsed = JSON.parse(raw.slice(start, end + 1));
  }

  const validated = proseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`provider prose failed validation: ${validated.error.message}`);
  }
  // Return ONLY the three allowed prose fields; nothing else is ever trusted.
  return {
    oneSentenceRead: validated.data.oneSentenceRead,
    positionGuidance: validated.data.positionGuidance,
    riskNotes: validated.data.riskNotes,
  };
}

/** Raw completion call for one provider; throws on transport/SDK errors. */
type CompletionFn = (prompt: string, model: string) => Promise<string>;

const completions: Record<LlmProviderId, CompletionFn> = {
  async openai(prompt, model) {
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const completion = await openai.chat.completions.create({
      model,
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    });
    return completion.choices[0]?.message?.content ?? "";
  },

  async gemini(prompt, model) {
    const { ai } = await import("@workspace/integrations-gemini-ai");
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
      },
    });
    return response.text ?? "";
  },

  async anthropic(prompt, model) {
    // NOTE: temperature/top_p/top_k are omitted entirely (deprecated on some
    // Anthropic models; setting them returns 400).
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const message = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    return block && block.type === "text" ? block.text : "";
  },
};

/**
 * A single LLM provider that produces prose-only enrichment. The orchestrator
 * re-validates and sanitizes everything this returns, so the provider is a soft
 * input only — never an authority.
 */
class LlmCommitteeProvider implements CommitteeProvider {
  readonly name: string;

  constructor(private readonly id: LlmProviderId) {
    this.name = id;
  }

  async enrich(context: ProviderContext): Promise<ProviderProse> {
    const tier = selectModelTier({
      alertLevel: context.alertLevel,
      l5Blocked: context.l5Blocked,
    });
    const model = MODELS[this.id][tier];
    const prompt = buildPrompt(context);
    const call = completions[this.id];

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await call(prompt, model);
        return extractProse(raw);
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(
      `Committee prose enrichment failed (${this.id}/${model}): ${
        lastError instanceof Error ? lastError.message : "unknown error"
      }`,
    );
  }
}

function isConfigured(prefix: "OPENAI" | "GEMINI" | "ANTHROPIC"): boolean {
  return (
    !!process.env[`AI_INTEGRATIONS_${prefix}_BASE_URL`] &&
    !!process.env[`AI_INTEGRATIONS_${prefix}_API_KEY`]
  );
}

/**
 * Returns the active LLM provider, or null when no AI integration is configured
 * (the default in development and tests — the committee then runs fully
 * deterministically). Selection is env-gated and safe-by-default:
 *
 * - `COPILOT_LLM_PROVIDER` (openai | gemini | anthropic) forces a provider; it
 *   is honored only when that integration is configured, else falls back to
 *   deterministic mode.
 * - Otherwise the first configured provider is chosen (OpenAI preferred).
 *
 * The deterministic read is always the single source of truth; a provider can
 * only refine prose, and the orchestrator re-validates everything it returns.
 */
export function getCommitteeProvider(): CommitteeProvider | null {
  const id = selectProviderId({
    requested: process.env.COPILOT_LLM_PROVIDER,
    configured: {
      openai: isConfigured("OPENAI"),
      gemini: isConfigured("GEMINI"),
      anthropic: isConfigured("ANTHROPIC"),
    },
  });
  return id ? new LlmCommitteeProvider(id) : null;
}
