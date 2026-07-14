/**
 * Point-in-time research backtest — replays the FULL agent pipeline over the
 * brain's own recorded scan history (scan_scorecard) and grades the results.
 *
 * Discipline (non-negotiable):
 * - EVIDENCE CUTOFF: every run reconstructs evidence strictly as-of 08:30 ET
 *   on the historical date — EDGAR by acceptance time, Alpaca historical news
 *   by original published time. `asOf` on every contract is the cutoff.
 * - LABELING: every run id carries the backtest_ prefix; live accuracy,
 *   memory reinforcement, and episodic memory all exclude backtest rows.
 *   No memory episodes are written at all.
 * - CONTAMINATION HONESTY: LLM narrator/judges may remember historical
 *   events (training data) — their backtest scores are labeled
 *   contamination-prone. The deterministic layers (decision table, contest
 *   resolver, event study, committee lenses) are leakage-free by
 *   construction, and the committee read runs with NO provider.
 *
 * Runs in the background; progress and the final summary live on the batch's
 * agent_runs row (agent_id research-backtest).
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, agentRunsTable, scanScorecardTable } from "@workspace/db";
import { EdgarClient, type EdgarFilingRef } from "@workspace/research-adapters";
import { finalize, type CandidateSeed, type SourceDocument } from "@workspace/research-contracts";
import {
  auditClaim,
  readSentiment,
  resolveContest,
  runLead,
  buildMacroContext,
  shouldRunMacro,
  verifyCatalyst,
  type LeadRunResult,
  type NewsClusterEvidence,
  type ResearchMode,
  type SpecialistRegistry,
} from "@workspace/research-agents";
import { buildCopilotEvent } from "@workspace/copilot-core";
import { runCommittee } from "@workspace/copilot-committee";
import {
  getCatalystNarrator,
  getEntailmentProvider,
  getSecondNarrator,
  getSentimentProvider,
} from "./researchProviders.js";
import { claimFromCatalyst, MATERIAL_FORMS } from "./researchRunner.js";
import { persistLeadRun } from "./researchStore.js";
import { judgeLeadRun } from "./judgeStore.js";
import { gradeEventStudyByRef } from "./eventStudyGrader.js";
import { clusterKey } from "./newsEvents.js";
import { etEpochMs, etIso } from "./etTime.js";
import { mapEconomicCalendar } from "./macroCalendar.js";
import * as alpaca from "./providers/alpaca.js";
import type { MarketNewsItem } from "./providers/alpaca.js";
import * as fmp from "./providers/fmp.js";
import { logger } from "./logger.js";

const NEWS_LOOKBACK_HOURS = 48;
/** Event window (3d) + weekend slack must have printed before we grade. */
const UNIVERSE_MIN_AGE_DAYS = 7;

/**
 * Pure: filings accepted strictly before the cutoff (PIT discipline).
 * Timestamps are compared as EPOCH MS, never as strings — sources arrive in
 * mixed offsets (EDGAR ET-offset stamps, Alpaca Zulu) and lexicographic
 * comparison across formats silently drops the premarket window.
 */
export function filingsAsOf(refs: EdgarFilingRef[], cutoffIso: string): EdgarFilingRef[] {
  const cutoffMs = Date.parse(cutoffIso);
  return refs.filter((r) => {
    if (r.acceptanceDateTime == null) return false; // unknown time → never assume
    const t = Date.parse(r.acceptanceDateTime);
    return Number.isFinite(t) && t <= cutoffMs;
  });
}

/** Pure: historical news items → catalyst news-cluster evidence (deduped, epoch-ms cutoff). */
export function newsToClusters(items: MarketNewsItem[], cutoffIso: string): NewsClusterEvidence[] {
  const cutoffMs = Date.parse(cutoffIso);
  const seen = new Set<string>();
  const out: NewsClusterEvidence[] = [];
  for (const item of items) {
    if (!item.headline || !item.createdAt) continue;
    const t = Date.parse(item.createdAt);
    if (!Number.isFinite(t) || t > cutoffMs) continue;
    const key = clusterKey(item.headline);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      clusterKey: key,
      headline: item.headline,
      isRepeat: false,
      firstSeen: item.createdAt,
      publishedAt: item.createdAt,
    });
  }
  return out.slice(0, 20);
}

export interface BacktestCandidateResult {
  date: string;
  symbol: string;
  researchOutcome: string;
  verificationStatus: string | null;
  judgeMedianScore: number | null;
  eventStudied: boolean;
  committeeRecommendation: string | null;
  scanHit: boolean | null;
  scanChangePct: number | null;
}

interface BatchProgress {
  status: "running" | "completed" | "failed";
  total: number;
  done: number;
  current: string | null;
  results: BacktestCandidateResult[];
  contaminationNote: string;
}

async function updateBatch(batchId: string, progress: BatchProgress): Promise<void> {
  await db
    .update(agentRunsTable)
    .set({
      checkpoint: progress,
      status: progress.status,
      ...(progress.status !== "running" ? { endedAt: new Date() } : {}),
    })
    .where(eq(agentRunsTable.runId, batchId));
}

/**
 * Pure: the last `days` weekdays ending at `maxDate` (newest first). Market
 * holidays are not filtered — a holiday candidate simply finds no bars/news
 * at the cutoff and degrades honestly.
 */
export function weekdaysEndingAt(maxDate: string, days: number): string[] {
  const out: string[] = [];
  const d = new Date(`${maxDate}T12:00:00Z`);
  while (out.length < days) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

/**
 * Historical scan picks: top-K by score per graded session, EXCLUDING the
 * most recent week — the 3-day event-study window must already have printed
 * or every candidate's deterministic grade would be skipped as too fresh.
 */
async function pickUniverse(days: number, symbolsPerDay: number): Promise<Array<{ date: string; symbol: string; hit: boolean | null; changePct: number | null }>> {
  const maxDate = new Date(Date.now() - UNIVERSE_MIN_AGE_DAYS * 86_400_000)
    .toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const rows = await db
    .select({
      scanDate: scanScorecardTable.scanDate,
      symbol: scanScorecardTable.symbol,
      score: scanScorecardTable.score,
      hit: scanScorecardTable.hit,
      changePct: scanScorecardTable.changePct,
    })
    .from(scanScorecardTable)
    .where(and(isNotNull(scanScorecardTable.gradedAt), sql`${scanScorecardTable.scanDate} <= ${maxDate}`))
    .orderBy(desc(scanScorecardTable.scanDate), desc(scanScorecardTable.score))
    .limit(days * 40);

  const byDate = new Map<string, Array<{ symbol: string; score: number; hit: boolean | null; changePct: number | null }>>();
  for (const r of rows) {
    byDate.set(r.scanDate, [...(byDate.get(r.scanDate) ?? []), r]);
  }
  const out: Array<{ date: string; symbol: string; hit: boolean | null; changePct: number | null }> = [];
  for (const [date, picks] of [...byDate.entries()].slice(0, days)) {
    const seen = new Set<string>();
    for (const p of picks) {
      if (seen.has(p.symbol)) continue;
      seen.add(p.symbol);
      out.push({ date, symbol: p.symbol, hit: p.hit, changePct: p.changePct });
      if (seen.size >= symbolsPerDay) break;
    }
  }
  return out;
}

/** One point-in-time research run; mirrors the live runner at the cutoff. */
async function runCandidate(
  batchId: string,
  date: string,
  symbol: string,
  mode: ResearchMode,
): Promise<LeadRunResult> {
  const cutoff = etIso(date, "08:30:00"); // DST-correct, never a hardcoded offset
  const expiresAt = etIso(date, "16:00:00");
  const runId = `${batchId}_${date.replace(/-/g, "")}_${symbol}`;

  // --- evidence strictly as-of the cutoff ---
  const documents = new Map<string, SourceDocument>();
  const passages = new Map<string, string>();
  let filingRefs: EdgarFilingRef[] = [];
  let cik: string | null = null;
  if (process.env["SEC_USER_AGENT"]?.trim()) {
    try {
      const edgar = new EdgarClient({ cacheDir: join(tmpdir(), "mie-edgar-cache") });
      cik = await edgar.lookupCik(symbol);
      if (cik) {
        filingRefs = filingsAsOf((await edgar.getSubmissions(cik)) ?? [], cutoff);
        // Same rule as the live runner: a Form 144 can't substantiate a catalyst.
        const latest =
          filingRefs.find((f) => f.primaryDocument && MATERIAL_FORMS.has(f.form)) ??
          filingRefs.find((f) => f.primaryDocument);
        if (latest) {
          const filing = await edgar.getFiling(latest, { symbols: [symbol], now: cutoff });
          if (filing) {
            documents.set(filing.document.sourceDocumentId, filing.document);
            passages.set(filing.document.sourceDocumentId, filing.text.slice(0, 8000));
          }
        }
      }
    } catch (err) {
      logger.warn({ err: String(err), symbol, date }, "Backtest EDGAR evidence unavailable");
    }
  }

  const newsStart = new Date(new Date(cutoff).getTime() - NEWS_LOOKBACK_HOURS * 3_600_000).toISOString();
  const news = (await alpaca.getHistoricalNews(symbol, newsStart, cutoff)) ?? [];
  const newsClusters = newsToClusters(news, cutoff);
  const evidence = { documents: [...documents.values()], newsClusters };

  const seed = finalize({
    contract: "CandidateSeed" as const,
    version: "1.0.0",
    candidateId: `cand_${symbol}_${runId}`,
    symbol,
    securityIdentity: { cik, figi: null, securityType: "COMMON_STOCK" },
    discoveryReasonCodes: ["BACKTEST_SCAN_PICK"],
    marketDataProvider: "alpaca",
    marketDataFeed: "sip",
    marketDataAsOf: cutoff,
    scannerVersion: "backtest-1.0.0",
    scannerConfigHash: null,
    createdAt: cutoff,
    expiresAt,
  }) as CandidateSeed;

  const specialists: SpecialistRegistry = {
    "catalyst.verify": () =>
      verifyCatalyst({ catalystId: `cat_${runId}`, symbol, evidence, narrator: getCatalystNarrator(), now: cutoff, expiresAt }),
    "catalyst.second_verify": async (primary) => {
      const second = getSecondNarrator();
      if (!second) return null;
      const secondary = await verifyCatalyst({ catalystId: `cat_${runId}_b`, symbol, evidence, narrator: second, now: cutoff, expiresAt });
      return resolveContest({ primary, secondary, now: cutoff, conflictIdPrefix: `cfl_${runId}` });
    },
    "source.audit": async (catalyst) => {
      if (!catalyst || documents.size === 0) return null;
      const claim = claimFromCatalyst(catalyst, cutoff);
      if (!claim) return null;
      const audited = await auditClaim({
        auditId: `audit_${runId}`,
        claim,
        documents,
        passages,
        entailment: getEntailmentProvider(),
        now: cutoff,
      });
      return { claims: [claim], audits: [audited] };
    },
    "sentiment.read": async () => {
      const provider = getSentimentProvider();
      if (!provider || newsClusters.length === 0) return null;
      return readSentiment({
        readingId: `sent_${runId}`,
        symbol,
        blocks: newsClusters.map((c) => ({ blockId: `news:${c.clusterKey}`, kind: "NEWS" as const, text: c.headline, publishedAt: c.publishedAt })),
        provider,
        now: cutoff,
      });
    },
    "macro.context": async () => {
      let calendar: ReturnType<typeof mapEconomicCalendar> = [];
      try {
        const day = 86_400_000;
        const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
        const base = new Date(cutoff).getTime();
        const rows = await fmp.getEconomicCalendar(dateOf(base - day), dateOf(base + 2 * day));
        calendar = rows ? mapEconomicCalendar(rows) : [];
      } catch {
        calendar = [];
      }
      // PIT honesty: hide prints that were not yet out at the cutoff
      // (epoch-ms comparison — offsets vary across sources and DST).
      const cutoffMs = Date.parse(cutoff);
      calendar = calendar.map((e) =>
        e.scheduledTime != null && Date.parse(e.scheduledTime) > cutoffMs
          ? { ...e, reportedValue: null, revisionStatus: "UNKNOWN" as const }
          : e,
      );
      const trigger = shouldRunMacro({ now: cutoff, calendar, indexMovePct: null });
      return buildMacroContext({ macroContextId: `macro_${runId}`, trigger, now: cutoff });
    },
    "capital.structure": async () => null, // full-filing pulls per candidate are too slow for batches
  };

  return runLead({ seed, researchMode: mode, specialists, runId, now: cutoff, expiresAt });
}

/** Deterministic committee read at the cutoff — NO provider, zero leakage. */
async function committeeReadAt(date: string, symbol: string): Promise<string | null> {
  try {
    const cutoffMs = etEpochMs(date, "08:30:00");
    const dayStart = new Date(etEpochMs(date, "04:00:00")).toISOString();
    const bars = await alpaca.getIntradayBars5m(symbol, dayStart, new Date(cutoffMs).toISOString());
    if (!bars || bars.length === 0) return null;
    const last = bars[bars.length - 1]!;
    const core = buildCopilotEvent({
      symbol,
      mode: "LIVE",
      dataSource: "alpaca_backtest",
      bars,
      quote: { bid: null, ask: null, last: last.c, quoteTime: last.t },
      nowMs: cutoffMs,
    });
    const result = await runCommittee(core);
    return result.dashboardRead.recommendation;
  } catch {
    return null;
  }
}

export interface StartBacktestOptions {
  days?: number;
  symbolsPerDay?: number;
  mode?: ResearchMode;
  /**
   * Explicit universe override: replay THESE symbols over the last `days`
   * trading days instead of the recorded scan history. This is the only way
   * to backtest before the scorecard has graded rows; scanHit/scanChangePct
   * are null (there was no scan pick to compare against).
   */
  symbols?: string[];
}

/** Launches a background backtest batch; returns its batch id immediately. */
export async function startResearchBacktest(opts: StartBacktestOptions): Promise<{ batchId: string; total: number }> {
  const days = Math.min(Math.max(opts.days ?? 5, 1), 30);
  const symbolsPerDay = Math.min(Math.max(opts.symbolsPerDay ?? 3, 1), 10);
  const mode = opts.mode ?? "STANDARD";
  const batchId = `backtest_${randomUUID().slice(0, 8)}`;

  let universe: Array<{ date: string; symbol: string; hit: boolean | null; changePct: number | null }>;
  if (opts.symbols && opts.symbols.length > 0) {
    const maxDate = new Date(Date.now() - UNIVERSE_MIN_AGE_DAYS * 86_400_000)
      .toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    universe = weekdaysEndingAt(maxDate, days).flatMap((date) =>
      opts.symbols!.map((symbol) => ({ date, symbol, hit: null, changePct: null })),
    );
  } else {
    universe = await pickUniverse(days, symbolsPerDay);
  }
  await db.insert(agentRunsTable).values({ runId: batchId, agentId: "research-backtest", agentVersion: "1.0.0", status: "running" }).onConflictDoNothing();

  const progress: BatchProgress = {
    status: "running",
    total: universe.length,
    done: 0,
    current: null,
    results: [],
    contaminationNote:
      "LLM narrator/judge scores over historical events carry look-ahead risk (training data); deterministic layers (decision table, contest, event study, committee) are leakage-free.",
  };
  await updateBatch(batchId, progress);

  // Fire-and-forget: progress is pollable at GET /api/research/backtest/:id.
  void (async () => {
    try {
      // One SPY series serves every event-study grade in the batch.
      const market = await alpaca.getDailyClosesDated("SPY").catch(() => null);
      for (const candidate of universe) {
        progress.current = `${candidate.date} ${candidate.symbol}`;
        await updateBatch(batchId, progress);

        const result = await runCandidate(batchId, candidate.date, candidate.symbol, mode);
        await persistLeadRun(result); // labeled by the backtest_ run id
        const grades = await judgeLeadRun(result);
        const primaryCatalyst = result.catalystRecords[0] ?? null;
        const eventStudied = primaryCatalyst
          ? await gradeEventStudyByRef(primaryCatalyst.catalystId, {
              symbol: candidate.symbol,
              runId: result.packet.provenance.runId,
              packetId: result.packet.packetId,
              market,
            })
          : false;
        const committeeRecommendation = await committeeReadAt(candidate.date, candidate.symbol);

        progress.results.push({
          date: candidate.date,
          symbol: candidate.symbol,
          researchOutcome: result.packet.researchOutcome,
          verificationStatus: primaryCatalyst?.verificationStatus ?? null,
          judgeMedianScore: grades[0]?.medianScore ?? null,
          eventStudied,
          committeeRecommendation,
          scanHit: candidate.hit,
          scanChangePct: candidate.changePct,
        });
        progress.done += 1;
        await updateBatch(batchId, progress);
      }
      progress.status = "completed";
      progress.current = null;
      await updateBatch(batchId, progress);
      logger.info({ batchId, done: progress.done }, "Research backtest completed");
    } catch (err) {
      progress.status = "failed";
      await updateBatch(batchId, progress).catch(() => {});
      logger.error({ err: String(err), batchId }, "Research backtest failed");
    }
  })();

  return { batchId, total: universe.length };
}

export async function getBacktestStatus(batchId: string): Promise<BatchProgress | null> {
  const rows = await db
    .select({ checkpoint: agentRunsTable.checkpoint })
    .from(agentRunsTable)
    .where(and(eq(agentRunsTable.runId, batchId), sql`${agentRunsTable.agentId} = 'research-backtest'`))
    .limit(1);
  return (rows[0]?.checkpoint as BatchProgress | undefined) ?? null;
}
