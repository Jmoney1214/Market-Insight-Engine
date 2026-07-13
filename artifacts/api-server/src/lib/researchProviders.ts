/**
 * Live LLM backbones for the three research-agent roles: catalyst narrator,
 * entailment judge, and sentiment scorer.
 *
 * SAFETY (same layering as committeeProvider.ts): these providers can only
 * produce the narrow JSON payload each research-agents consumer strictly
 * parses; every DECISION (verification status, claim admission, sentiment
 * band) is computed by deterministic code downstream, and any malformed or
 * failing provider output degrades to UNKNOWN / not-admitted / no-reading.
 * Selection is env-gated: with no AI integration configured, every getter
 * returns null and the research layer stays fully deterministic.
 */
import { selectProviderId, type LlmProviderId } from "@workspace/copilot-committee";
import type {
  CatalystNarrator,
  EntailmentProvider,
  SentimentProvider,
} from "@workspace/research-agents";

export type ModelTier = "quick" | "deep";

/** Per-provider quick (routine) and deep (escalation) model names. */
const MODELS: Record<LlmProviderId, Record<ModelTier, string>> = {
  openai: { quick: "gpt-5-mini", deep: "gpt-5.4" },
  gemini: { quick: "gemini-3-flash-preview", deep: "gemini-3.1-pro-preview" },
  anthropic: { quick: "claude-haiku-4-5", deep: "claude-sonnet-4-6" },
};

type CompletionFn = (system: string, prompt: string, model: string) => Promise<string>;

const completions: Record<LlmProviderId, CompletionFn> = {
  async openai(system, prompt, model) {
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const completion = await openai.chat.completions.create({
      model,
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });
    return completion.choices[0]?.message?.content ?? "";
  },

  async gemini(system, prompt, model) {
    const { ai } = await import("@workspace/integrations-gemini-ai");
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
      },
    });
    return response.text ?? "";
  },

  async anthropic(system, prompt, model) {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const message = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    return block && block.type === "text" ? block.text : "";
  },
};

/** Tolerant JSON extraction; strict schema validation happens downstream. */
function extractJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("provider returned no JSON object");
    }
    return JSON.parse(raw.slice(start, end + 1));
  }
}

async function completeJson(
  id: LlmProviderId,
  tier: ModelTier,
  system: string,
  prompt: string,
): Promise<unknown> {
  const call = completions[id];
  const model = MODELS[id][tier];
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return extractJson(await call(system, prompt, model));
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `research provider call failed (${id}/${model}): ${lastError instanceof Error ? lastError.message : "unknown"}`,
  );
}

/** Generic quick-tier JSON completion for planner/judge callers. */
export function getPlannerCompletion(id: LlmProviderId, system: string, prompt: string): Promise<unknown> {
  return completeJson(id, "quick", system, prompt);
}

/** Raw JSON completion on an explicit backbone — used by the judge panel. */
export function completeOnBackbone(
  id: LlmProviderId,
  tier: ModelTier,
  system: string,
  prompt: string,
): Promise<unknown> {
  return completeJson(id, tier, system, prompt);
}

/** Model label for a backbone (provenance stamping). */
export function backboneLabel(id: LlmProviderId, tier: ModelTier): string {
  return `${id}:${MODELS[id][tier]}`;
}

function isConfigured(prefix: "OPENAI" | "GEMINI" | "ANTHROPIC"): boolean {
  return (
    !!process.env[`AI_INTEGRATIONS_${prefix}_BASE_URL`] &&
    !!process.env[`AI_INTEGRATIONS_${prefix}_API_KEY`]
  );
}

export function configuredProviders(): LlmProviderId[] {
  const flags = {
    openai: isConfigured("OPENAI"),
    gemini: isConfigured("GEMINI"),
    anthropic: isConfigured("ANTHROPIC"),
  };
  return (Object.keys(flags) as LlmProviderId[]).filter((id) => flags[id]);
}

export interface ResearchBackbones {
  /** Primary verification backbone, or null when nothing is configured. */
  primary: { id: LlmProviderId; tier: ModelTier } | null;
  /**
   * Independent second-verification backbone (ContestTrade contest mode):
   * a DIFFERENT provider when two are configured; the same provider's other
   * model tier when only one is — still an independent model run.
   */
  secondary: { id: LlmProviderId; tier: ModelTier } | null;
}

/** Pure backbone selection over the configured provider list (unit-tested). */
export function selectBackbones(configured: LlmProviderId[], requested?: string | null): ResearchBackbones {
  const primaryId = selectProviderId({
    requested: requested ?? null,
    configured: {
      openai: configured.includes("openai"),
      gemini: configured.includes("gemini"),
      anthropic: configured.includes("anthropic"),
    },
  });
  if (!primaryId) return { primary: null, secondary: null };
  const other = configured.find((id) => id !== primaryId);
  return {
    primary: { id: primaryId, tier: "deep" },
    secondary: other ? { id: other, tier: "deep" } : { id: primaryId, tier: "quick" },
  };
}

function backbones(): ResearchBackbones {
  return selectBackbones(configuredProviders(), process.env["COPILOT_LLM_PROVIDER"]);
}

// ---- Catalyst narrator -------------------------------------------------------

const NARRATOR_SYSTEM = [
  "You are the narration component of a catalyst verifier on a day-trading research desk.",
  "You receive pre-fetched evidence: SEC filing metadata/sections and clustered news headlines.",
  "Considering the nine verification questions provided, produce ONLY a JSON object:",
  '{"eventType": <one of the allowed enum values>, "eventDescription": <one factual sentence, max 600 chars>}.',
  "Describe ONLY what the evidence states — never invent facts, numbers, or outcomes.",
  "You do NOT decide verification status; deterministic code does. Never claim something is confirmed or verified.",
].join(" ");

function narrator(id: LlmProviderId, tier: ModelTier): CatalystNarrator {
  return {
    name: `${id}:${MODELS[id][tier]}`,
    narrate: (input) =>
      completeJson(
        id,
        tier,
        NARRATOR_SYSTEM,
        JSON.stringify({
          symbol: input.symbol,
          questions: input.questions,
          allowedEventTypes: [
            "EARNINGS_GUIDANCE", "SEC_FILING", "OFFERING_DILUTION", "MERGER_ACQUISITION",
            "ANALYST_ACTION", "FDA_CLINICAL", "CONTRACT_AWARD", "MANAGEMENT_CHANGE",
            "LITIGATION_REGULATORY", "EXCHANGE_NOTICE", "PRESS_RELEASE", "SECTOR_SYMPATHY",
            "CORPORATE_ACTION",
          ],
          documents: input.documents.map((d) => ({
            sourceDocumentId: d.sourceDocumentId,
            documentType: d.documentType,
            publisher: d.publisher,
            publicationTime: d.publicationTime,
          })),
          newsClusters: input.newsClusters.map((c) => ({
            headline: c.headline,
            publishedAt: c.publishedAt,
            isRepeat: c.isRepeat,
          })),
        }),
      ),
  };
}

/** Primary catalyst narrator, or null when no AI integration is configured. */
export function getCatalystNarrator(): CatalystNarrator | null {
  const b = backbones().primary;
  return b ? narrator(b.id, b.tier) : null;
}

/** Independent second-verification narrator (different backbone), or null. */
export function getSecondNarrator(): CatalystNarrator | null {
  const b = backbones().secondary;
  return b ? narrator(b.id, b.tier) : null;
}

// ---- Entailment judge --------------------------------------------------------

const ENTAILMENT_SYSTEM = [
  "You are an entailment judge for a source-audit system.",
  "For EACH passage, decide whether the passage ENTAILS the claim, CONTRADICTS it, or is NEUTRAL.",
  "Judge strictly from the passage text — outside knowledge must not rescue a claim.",
  'Produce ONLY a JSON object: {"perPassage":[{"sourceDocumentId": <id>, "verdict": "ENTAILS"|"CONTRADICTS"|"NEUTRAL"}]}',
  "with exactly one entry per input passage.",
].join(" ");

/** Entailment judge on the quick tier, or null when unconfigured. */
export function getEntailmentProvider(): EntailmentProvider | null {
  const b = backbones().primary;
  if (!b) return null;
  return {
    name: `${b.id}:${MODELS[b.id].quick}`,
    judge: (input) =>
      completeJson(
        b.id,
        "quick",
        ENTAILMENT_SYSTEM,
        JSON.stringify({
          claim: input.claimText,
          passages: input.passages.map((p) => ({
            sourceDocumentId: p.sourceDocumentId,
            text: p.text.slice(0, 4000),
          })),
        }),
      ),
  };
}

// ---- Sentiment scorer --------------------------------------------------------

const SENTIMENT_SYSTEM = [
  "You score aggregate market ATTENTION sentiment for one symbol from pre-fetched text blocks.",
  "This is an attention signal only — it is never proof that an event occurred.",
  'Produce ONLY a JSON object: {"score": <-1..1>, "confidence": <0..1>, "citedBlockIds": [<ids of blocks that drove the score>]}.',
  "citedBlockIds MUST contain only blockId values that appear in the input; citing anything else voids the reading.",
].join(" ");

/** Sentiment scorer on the quick tier, or null when unconfigured. */
export function getSentimentProvider(): SentimentProvider | null {
  const b = backbones().primary;
  if (!b) return null;
  return {
    name: `${b.id}:${MODELS[b.id].quick}`,
    score: (input) =>
      completeJson(
        b.id,
        "quick",
        SENTIMENT_SYSTEM,
        JSON.stringify({
          symbol: input.symbol,
          blocks: input.blocks.map((blk) => ({
            blockId: blk.blockId,
            kind: blk.kind,
            text: blk.text.slice(0, 500),
            publishedAt: blk.publishedAt,
          })),
        }),
      ),
  };
}
