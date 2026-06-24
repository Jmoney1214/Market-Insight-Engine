import { z } from "zod/v4";
import type {
  CommitteeProvider,
  ProviderContext,
  ProviderProse,
} from "@workspace/copilot-committee";

// SAFETY: this provider is the ONLY place an LLM touches the committee, and it
// may influence prose only. The orchestrator re-validates and strips anything
// unsafe, and silently falls back to the deterministic read on any failure.
// The provider is also env-gated: without the OpenAI integration configured,
// getCommitteeProvider() returns null and the committee stays fully
// deterministic (the default in dev and tests).

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

async function requestProse(prompt: string): Promise<string> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const completion = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });
  return completion.choices[0]?.message?.content ?? "";
}

class OpenAiCommitteeProvider implements CommitteeProvider {
  readonly name = "openai:gpt-5.4";

  async enrich(context: ProviderContext): Promise<ProviderProse> {
    const prompt = buildPrompt(context);

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let raw: string;
      try {
        raw = await requestProse(prompt);
      } catch (err) {
        lastError = err;
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        lastError = err;
        continue;
      }

      const validated = proseSchema.safeParse(parsed);
      if (validated.success) {
        // Return ONLY the three allowed prose fields; nothing else is trusted.
        return {
          oneSentenceRead: validated.data.oneSentenceRead,
          positionGuidance: validated.data.positionGuidance,
          riskNotes: validated.data.riskNotes,
        };
      }
      lastError = validated.error;
    }

    throw new Error(
      `Committee prose enrichment failed: ${
        lastError instanceof Error ? lastError.message : "unknown error"
      }`,
    );
  }
}

/**
 * Returns an LLM provider only when the OpenAI integration is configured.
 * Returns null otherwise so the committee runs fully deterministically — the
 * default in development and tests. The deterministic read is always the
 * single source of truth; the provider can only refine prose.
 */
export function getCommitteeProvider(): CommitteeProvider | null {
  if (
    !process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||
    !process.env.AI_INTEGRATIONS_OPENAI_API_KEY
  ) {
    return null;
  }
  return new OpenAiCommitteeProvider();
}
