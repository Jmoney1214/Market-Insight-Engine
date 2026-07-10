import { parseIntent } from "./intent.js";
import { strategyEvidence, sessionEvidence, systemEvidence } from "./evidence.js";
import { synthesize, type Completer } from "./synthesize.js";
import type { ReadClient } from "./supabaseClient.js";
import type { EvidencePack, GroundedAnswer } from "./types.js";

/** The one read-only engine: intent -> evidence (Supabase) -> synthesize (Claude).
 * Shared by the CLI and the POST /brain/ask route. Zero write-back. */
export async function diagnose(
  deps: { db: ReadClient; complete: Completer },
  question: string,
): Promise<GroundedAnswer> {
  const subject = parseIntent(question);
  let pack: EvidencePack;
  if (subject.kind === "strategy") pack = await strategyEvidence(deps.db, subject.id);
  else if (subject.kind === "session") pack = await sessionEvidence(deps.db, subject.date);
  else pack = await systemEvidence(deps.db, subject.sinceHours);
  return synthesize(deps.complete, question, pack);
}
