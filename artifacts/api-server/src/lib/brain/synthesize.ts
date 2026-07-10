import Anthropic from "@anthropic-ai/sdk";
import type { EvidencePack, GroundedAnswer } from "./types.ts";

export type Completer = (system: string, user: string) => Promise<string>;

const SYSTEM = [
  "You are a trading-system diagnostician. You are given a QUESTION and an EVIDENCE",
  "pack of facts pulled from the database. Explain the answer using ONLY those facts.",
  "Rules: (1) cite the exact fact ids you rely on (source:id). (2) If the evidence does",
  "not support a conclusion, say 'insufficient evidence to say why' and name what data",
  "would be needed. (3) Never invent numbers, trades, or causes not in the pack.",
  'Respond ONLY as JSON: {"answer": string, "citations": string[]} where each citation',
  'is a "source:id" from the evidence pack.',
].join(" ");

/** Wrap the Anthropic SDK as a Completer. claude-opus-4-8 + adaptive thinking. */
export function anthropicCompleter(client: Anthropic): Completer {
  return async (system, user) => {
    const res = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: user }],
    });
    // content is a discriminated union; take the first text block.
    const textBlock = res.content.find((b) => b.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text : "";
  };
}

export async function synthesize(complete: Completer, question: string, pack: EvidencePack): Promise<GroundedAnswer> {
  const user = `QUESTION: ${question}\n\nEVIDENCE (JSON):\n${JSON.stringify(pack, null, 2)}`;
  const raw = await complete(SYSTEM, user);
  try {
    const parsed = JSON.parse(raw) as { answer?: string; citations?: string[] };
    if (typeof parsed.answer === "string") {
      return {
        answer: parsed.answer,
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        evidencePack: pack,
      };
    }
  } catch {
    // fall through — model returned prose, not JSON
  }
  return { answer: raw.trim(), citations: [], evidencePack: pack };
}
