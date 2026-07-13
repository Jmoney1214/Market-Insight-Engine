/**
 * Live research runner — binds the Wave 2 Lead + specialists to real evidence:
 * SEC EDGAR (needs SEC_USER_AGENT), the news_events ledger, FMP index tape,
 * and the live LLM backbones from researchProviders.
 *
 * Every dependency degrades honestly: no SEC_USER_AGENT → no filings evidence;
 * no AI integration → narrator/entailment/sentiment abstain and the packet
 * comes back PARTIAL/BLOCKED with UNKNOWN checks — never fabricated.
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, newsEventsTable } from "@workspace/db";
import { gte, desc } from "drizzle-orm";
import { EdgarClient, type EdgarFilingRef } from "@workspace/research-adapters";
import {
  finalize,
  type CandidateSeed,
  type Claim,
  type CatalystRecord,
  type SourceDocument,
} from "@workspace/research-contracts";
import {
  auditClaim,
  buildCapitalStructure,
  buildMacroContext,
  classifyLifecycle,
  readSentiment,
  resolveContest,
  runLead,
  shouldRunMacro,
  verifyCatalyst,
  type CatalystEvidence,
  type LeadRunResult,
  type NewsClusterEvidence,
  type ResearchMode,
  type SpecialistRegistry,
} from "@workspace/research-agents";
import {
  getCatalystNarrator,
  getEntailmentProvider,
  getSecondNarrator,
  getSentimentProvider,
} from "./researchProviders.js";
import { blocksFromNewsRows } from "./sentimentContext.js";
import { mapEconomicCalendar } from "./macroCalendar.js";
import { checkpointAgentRun, loadCheckpoint, startAgentRun } from "./researchStore.js";
import * as fmp from "./providers/fmp.js";
import { logger } from "./logger.js";

const NEWS_WINDOW_HOURS = 48;
const PACKET_TTL_HOURS = 8;
const FILING_TEXT_CAP = 8000;

/** Filing forms that can actually substantiate a catalyst / dilution claim. */
export const MATERIAL_FORMS = new Set([
  "8-K", "8-K/A", "6-K", "10-Q", "10-K", "20-F",
  "424B1", "424B2", "424B3", "424B4", "424B5",
  "S-1", "S-1/A", "S-3", "S-3/A", "F-1", "F-3",
]);

/** One CORE claim derived from the verified catalyst (audited fail-closed). */
export function claimFromCatalyst(record: CatalystRecord, now: string): Claim | null {
  const sourceIds = [...record.primarySourceIds, ...record.secondarySourceIds];
  if (sourceIds.length === 0) return null;
  return {
    contract: "Claim",
    version: "1.0.0",
    claimId: `claim_${record.catalystId}`,
    symbol: record.symbol,
    cik: null,
    predicate: record.eventType,
    text: record.eventDescription,
    structuredValue: null,
    unit: null,
    assertedByAgent: "catalyst-verifier",
    assertedAt: now,
    criticality: "CORE",
    requiredForCompletion: true,
    evidence: sourceIds.map((id) => ({
      sourceDocumentId: id,
      passageLocator: { type: "WHOLE_DOCUMENT" as const, value: "" },
      supportType: "DIRECT" as const,
    })),
  };
}

interface GatheredEvidence {
  evidence: CatalystEvidence;
  /** Full text per sourceDocumentId (for entailment passages). */
  passages: Map<string, string>;
  documents: Map<string, SourceDocument>;
  filingRefs: EdgarFilingRef[];
  cik: string | null;
}

async function gatherEvidence(symbol: string, now: string): Promise<GatheredEvidence> {
  const documents = new Map<string, SourceDocument>();
  const passages = new Map<string, string>();
  let filingRefs: EdgarFilingRef[] = [];
  let cik: string | null = null;

  // SEC evidence — only with a declared User-Agent (SEC fair-access rule).
  if (process.env["SEC_USER_AGENT"]?.trim()) {
    try {
      const edgar = new EdgarClient({ cacheDir: join(tmpdir(), "mie-edgar-cache") });
      cik = await edgar.lookupCik(symbol);
      if (cik) {
        filingRefs = (await edgar.getSubmissions(cik)) ?? [];
        // Prefer a material filing for the audit document — a Form 144 or
        // ownership form can't substantiate a catalyst claim.
        const latest =
          filingRefs.find((f) => f.primaryDocument && MATERIAL_FORMS.has(f.form)) ??
          filingRefs.find((f) => f.primaryDocument);
        if (latest) {
          const filing = await edgar.getFiling(latest, { symbols: [symbol], now });
          if (filing) {
            documents.set(filing.document.sourceDocumentId, filing.document);
            passages.set(filing.document.sourceDocumentId, filing.text.slice(0, FILING_TEXT_CAP));
          }
        }
      }
    } catch (err) {
      logger.warn({ err: String(err), symbol }, "EDGAR evidence unavailable (non-fatal)");
    }
  }

  // News clusters from the point-in-time ledger.
  const since = new Date(Date.now() - NEWS_WINDOW_HOURS * 3_600_000);
  const rows = await db
    .select({
      clusterKey: newsEventsTable.clusterKey,
      headline: newsEventsTable.headline,
      symbols: newsEventsTable.symbols,
      firstSeen: newsEventsTable.firstSeen,
      publishedAt: newsEventsTable.publishedAt,
    })
    .from(newsEventsTable)
    .where(gte(newsEventsTable.firstSeen, since))
    .orderBy(desc(newsEventsTable.firstSeen))
    .limit(500);

  const newsClusters: NewsClusterEvidence[] = rows
    .filter((r) => r.symbols.includes(symbol))
    .slice(0, 20)
    .map((r) => ({
      clusterKey: r.clusterKey,
      headline: r.headline,
      isRepeat: false, // ledger rows are first-seen originals by construction
      firstSeen: r.firstSeen.toISOString(),
      publishedAt: r.publishedAt.toISOString(),
    }));

  return {
    evidence: { documents: [...documents.values()], newsClusters },
    passages,
    documents,
    filingRefs,
    cik,
  };
}

export async function runResearch(
  symbol: string,
  mode: ResearchMode,
  resumeRunId?: string | null,
): Promise<LeadRunResult> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PACKET_TTL_HOURS * 3_600_000).toISOString();

  // Resume reuses the crashed run's id so its checkpoint and ledger row match;
  // a shape-hash mismatch inside runLead silently discards stale snapshots.
  const runId = resumeRunId?.trim() || `research_${randomUUID().slice(0, 8)}`;
  const checkpoint = resumeRunId ? await loadCheckpoint(runId) : null;
  await startAgentRun(runId, "market-research-lead", "1.0.0");

  const gathered = await gatherEvidence(symbol, now);

  const seed = finalize({
    contract: "CandidateSeed" as const,
    version: "1.0.0",
    candidateId: `cand_${symbol}_${runId}`,
    symbol,
    securityIdentity: { cik: gathered.cik, figi: null, securityType: "COMMON_STOCK" },
    discoveryReasonCodes: ["MANUAL_RESEARCH_REQUEST"],
    marketDataProvider: "alpaca",
    marketDataFeed: "sip",
    marketDataAsOf: now,
    scannerVersion: "research-route-1.0.0",
    scannerConfigHash: null,
    createdAt: now,
    expiresAt,
  }) as CandidateSeed;

  const specialists: SpecialistRegistry = {
    "catalyst.verify": () =>
      verifyCatalyst({
        catalystId: `cat_${runId}`,
        symbol,
        evidence: gathered.evidence,
        narrator: getCatalystNarrator(),
        now,
        expiresAt,
      }),

    "catalyst.second_verify": async (primary) => {
      const second = getSecondNarrator();
      if (!second) return null; // no independent backbone → contest abstains
      const secondary = await verifyCatalyst({
        catalystId: `cat_${runId}_b`,
        symbol,
        evidence: gathered.evidence,
        narrator: second,
        now,
        expiresAt,
      });
      return resolveContest({ primary, secondary, now, conflictIdPrefix: `cfl_${runId}` });
    },

    "source.audit": async (catalyst) => {
      if (!catalyst || gathered.documents.size === 0) return null;
      const claim = claimFromCatalyst(catalyst, now);
      if (!claim) return null;
      const audited = await auditClaim({
        auditId: `audit_${runId}`,
        claim,
        documents: gathered.documents,
        passages: gathered.passages,
        entailment: getEntailmentProvider(),
        now,
      });
      return { claims: [claim], audits: [audited] };
    },

    "sentiment.read": async () => {
      const provider = getSentimentProvider();
      if (!provider) return null;
      const blocks = blocksFromNewsRows(
        gathered.evidence.newsClusters.map((c) => ({
          clusterKey: c.clusterKey,
          headline: c.headline,
          symbols: [symbol],
          firstSeen: new Date(c.firstSeen),
        })),
        symbol,
      );
      return readSentiment({ readingId: `sent_${runId}`, symbol, blocks, provider, now });
    },

    "macro.context": async () => {
      let indexMovePct: number | null = null;
      try {
        const spy = await fmp.getQuote("SPY");
        indexMovePct = spy?.changePercentage ?? null;
      } catch {
        indexMovePct = null;
      }
      // FMP economic calendar: yesterday → +2 days covers the router's
      // after/before windows; unavailable calendar degrades to tape-only.
      let calendar: ReturnType<typeof mapEconomicCalendar> = [];
      try {
        const day = 86_400_000;
        const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
        const rows = await fmp.getEconomicCalendar(dateOf(Date.now() - day), dateOf(Date.now() + 2 * day));
        calendar = rows ? mapEconomicCalendar(rows) : [];
      } catch {
        calendar = [];
      }
      const trigger = shouldRunMacro({ now, calendar, indexMovePct });
      return buildMacroContext({ macroContextId: `macro_${runId}`, trigger, now });
    },

    "capital.structure": async () => {
      if (gathered.filingRefs.length === 0) return null;
      const lifecycle = classifyLifecycle({
        now,
        listingDate: null,
        forms: gathered.filingRefs.map((f) => ({ form: f.form, acceptedAt: f.acceptanceDateTime })),
      });
      const filings = [...gathered.documents.entries()].map(([id, doc]) => ({
        form: doc.documentType.replace(/^SEC_/, "").replace(/_/g, "-"),
        accessionNumber: doc.providerDocumentId ?? id,
        acceptedAt: doc.publicationTime,
        sourceDocumentId: id,
        text: gathered.passages.get(id) ?? "",
      }));
      return buildCapitalStructure({ diligenceId: `cap_${runId}`, symbol, lifecycle, filings, now });
    },
  };

  return runLead({
    seed,
    researchMode: mode,
    specialists,
    runId,
    now,
    expiresAt,
    checkpoint,
    onCheckpoint: (cp) => checkpointAgentRun(runId, cp),
  });
}
