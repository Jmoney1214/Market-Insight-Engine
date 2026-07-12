// In-product catalyst-scout worker — the agentic worker that lives in the
// server, not in a chat session. On each run it pulls real FMP news + Alpaca
// SIP tape for the requested symbols, reads its own graded memory, reasons
// with a Claude model under the catalyst-scout contract (including the
// intraday anchoring rules), and writes typed agent_findings rows as writer
// "catalyst-scout/server".
//
// HONESTY INVARIANTS:
//   - The ANCHOR is computed from market data by this code, never by the
//     model. The model supplies judgment (tier, direction, p); the worker
//     supplies facts (anchor price/ts, window, spent move).
//   - Findings are OPINIONS (THE WALL): this worker never touches
//     journal_entries and its output never counts as a validation sample.
//   - No execution language: verdicts are enum-validated; the deterministic
//     core never reads these rows for trading decisions.
//   - Model output is schema-validated; invalid output SKIPS the symbol and
//     reports the reason — it never writes a malformed or improvised row.

import { z } from "zod/v4";
import { insertAgentFindingSchema, type InsertAgentFinding } from "@workspace/db";

export type Completer = (system: string, user: string) => Promise<string>;

export interface ScoutInput {
  symbol: string;
  anchorPrice: number;
  anchorTs: Date;
  priorClose: number | null;
  spentMovePct: number | null; // (anchor - priorClose)/priorClose * 100
  news: Array<{ headline: string; source: string; publishedAt: number; url?: string | null }>;
}

export interface ScoutWorkerDeps {
  complete: Completer;
  fetchInput: (symbol: string) => Promise<ScoutInput>;
  /** Short lines summarizing this writer's recent graded record (may be empty). */
  readMemory: () => Promise<string[]>;
  insertFindings: (rows: InsertAgentFinding[]) => Promise<number[]>;
  now?: () => Date;
}

export interface ScoutRunResult {
  runId: string;
  findings: InsertAgentFinding[];
  insertedIds: number[];
  skipped: Array<{ symbol: string; reason: string }>;
  memoryLines: number;
}

const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);
const upper = (v: unknown) => (typeof v === "string" ? v.toUpperCase() : v);
const verdictEnum = z.preprocess(lower, z.enum(["support", "reject", "neutral", "unavailable"]));

const modelCallSchema = z.object({
  ticker: z.string().min(1),
  verdict: verdictEnum,
  catalystTier: z.preprocess(upper, z.enum(["HARD", "SOFT", "SYMPATHY", "NONE"])),
  catalyst: z.string(), // one line, with source + timestamp, or "none found"
  direction: z.preprocess(lower, z.enum(["up", "down", "flat"])),
  /** P(price beyond anchor in `direction` at window end), per the anchoring contract. */
  p: z.number().min(0).max(1),
  magnitudeBandPct: z.tuple([z.number(), z.number()]),
  evidence: z.array(z.string()).min(1).max(6),
  risks: z.array(z.string()).max(5),
});
const modelOutputSchema = z.object({ calls: z.array(modelCallSchema) });

export const SCOUT_SYSTEM_PROMPT = [
  "You are catalyst-scout, the news-catalyst analyst of a trading research crew.",
  "For each symbol you receive REAL headlines (FMP paid feed) and the REAL tape anchor",
  "(Alpaca SIP). Your job: say WHY each name is moving and what remains of the move.",
  "House rules (non-negotiable):",
  "1. Never invent a catalyst. No verifiable headline explaining the move => catalystTier",
  '   NONE or SYMPATHY and say "none found". Dilution/offerings are supply events, not bullish.',
  "2. Tier strictly: HARD = name-specific, <=1 session old, concrete (earnings actually",
  "   reported / clinical readout / signed contract WITH dollar value / regulatory approval).",
  "   SOFT = MOU without $, analyst action alone, stale-but-real story. SYMPATHY = sector/peer",
  "   move only. NONE = nothing found.",
  "3. TWO CLAIMS, NEVER ONE (anchoring contract): the catalyst being real is separate from",
  "   there being remaining move. Your verdict + p are about the RESIDUAL move from the",
  "   stated anchor over the stated window - NOT about the day's narrative. If the spent move",
  "   already matches a typical full reaction for that catalyst class, verdict neutral, p near 0.5,",
  "   unless you cite a specific unexhausted leg.",
  "4. Your graded memory is provided. Respect it: your skeptical calls have graded well;",
  "   your soft-catalyst conviction has graded poorly. Temper accordingly and cite it.",
  "5. Research only. Never output trade instructions of any kind.",
  'Respond ONLY as JSON: {"calls": [{"ticker","verdict","catalystTier","catalyst","direction",',
  '"p","magnitudeBandPct":[lo,hi],"evidence":[...],"risks":[...]}]} - one entry per symbol,',
  "evidence strings must be concrete with sources and timestamps.",
].join("\n");

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("model returned no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

/** Runs one scout sweep. Pure orchestration; all I/O via deps. */
export async function runScoutWorker(
  deps: ScoutWorkerDeps,
  opts: { symbols: string[]; windowEnd: Date; runId?: string; dryRun?: boolean },
): Promise<ScoutRunResult> {
  const now = deps.now?.() ?? new Date();
  const runId =
    opts.runId ?? `scout-server-${now.toISOString().slice(0, 10)}-${now.getUTCHours()}${String(now.getUTCMinutes()).padStart(2, "0")}`;

  const skipped: Array<{ symbol: string; reason: string }> = [];
  const inputs: ScoutInput[] = [];
  for (const symbol of opts.symbols) {
    try {
      inputs.push(await deps.fetchInput(symbol));
    } catch (err) {
      skipped.push({ symbol, reason: `input unavailable: ${String(err)}` });
    }
  }

  const memory = await deps.readMemory().catch(() => [] as string[]);
  if (inputs.length === 0) {
    return { runId, findings: [], insertedIds: [], skipped, memoryLines: memory.length };
  }

  const user = [
    `Run: ${runId}. Current time: ${now.toISOString()}.`,
    `Residual-claim window for every call: anchor -> ${opts.windowEnd.toISOString()}.`,
    "",
    "YOUR GRADED MEMORY (read before verdict):",
    ...(memory.length > 0 ? memory : ["(no graded history reachable - you are memory-blind; say so in evidence)"]),
    "",
    ...inputs.map((i) =>
      [
        `=== ${i.symbol} ===`,
        `ANCHOR (computed, do not restate differently): ${i.anchorTs.toISOString()} @ ${i.anchorPrice}`,
        `PRIOR CLOSE: ${i.priorClose ?? "unknown"} | SPENT MOVE: ${i.spentMovePct === null ? "unknown" : `${i.spentMovePct.toFixed(1)}%`}`,
        `HEADLINES (${i.news.length}):`,
        ...i.news
          .slice(0, 12)
          .map((n) => `- [${new Date(n.publishedAt * 1000).toISOString()}] (${n.source}) ${n.headline}`),
      ].join("\n"),
    ),
  ].join("\n");

  const raw = await deps.complete(SCOUT_SYSTEM_PROMPT, user);
  let calls: z.infer<typeof modelOutputSchema>["calls"];
  try {
    calls = modelOutputSchema.parse(extractJson(raw)).calls;
  } catch (err) {
    throw new Error(`scout model output failed validation: ${String(err)}`);
  }

  const bySymbol = new Map(inputs.map((i) => [i.symbol.toUpperCase(), i]));
  const findings: InsertAgentFinding[] = [];
  for (const call of calls) {
    const input = bySymbol.get(call.ticker.toUpperCase());
    if (!input) {
      skipped.push({ symbol: call.ticker, reason: "model invented a symbol not in the request" });
      continue;
    }
    // The worker, not the model, assembles the anchored evidence lines.
    const anchorLine = `ANCHOR: ${input.anchorTs.toISOString()} @ ${input.anchorPrice} | SPENT: ${input.spentMovePct === null ? "unknown" : `${input.spentMovePct.toFixed(1)}% from prior close`}`;
    const residualLine = `RESIDUAL: direction=${call.direction} band=[${call.magnitudeBandPct[0]}%,${call.magnitudeBandPct[1]}%] window->${opts.windowEnd.toISOString()} p=${call.p}`;
    const tierLine = `CATALYST[${call.catalystTier}]: ${call.catalyst}`;

    const candidate = {
      runId,
      agentName: "catalyst-scout",
      ticker: input.symbol,
      strategyId: null,
      verdict: call.verdict,
      confidence: Math.round(Math.max(call.p, 1 - call.p) * 100) / 100,
      evidence: [anchorLine, tierLine, residualLine, ...call.evidence],
      risks: call.risks.length > 0 ? call.risks : null,
      requiredFollowup: [`grade on the ${opts.windowEnd.toISOString()} window close (anchored leg only)`],
      eventTimestamp: opts.windowEnd,
      provenance: {
        source: "catalyst-scout/server",
        gitSha: process.env.GIT_SHA ?? "server-unknown",
        runRef: runId,
      },
    };
    const parsed = insertAgentFindingSchema.safeParse(candidate);
    if (!parsed.success) {
      skipped.push({ symbol: input.symbol, reason: `finding failed schema: ${parsed.error.message}` });
      continue;
    }
    findings.push(parsed.data as InsertAgentFinding);
  }

  const insertedIds = opts.dryRun || findings.length === 0 ? [] : await deps.insertFindings(findings);
  return { runId, findings, insertedIds, skipped, memoryLines: memory.length };
}
