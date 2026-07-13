/**
 * Market Research Lead — OpenAI manager pattern: specialists are invoked as
 * TYPED FUNCTIONS (never handoffs), the plan is PROPOSED by an optional
 * planner and VALIDATED by deterministic code (only validated plans execute;
 * an invalid proposal falls back to the deterministic default plan), and the
 * CandidatePacket is assembled purely from specialist outputs — the Lead
 * cannot author a single research field itself.
 *
 * Failure mode RETURN_PARTIAL_OR_BLOCKED: specialist failures degrade the
 * packet's checks/outcome; they never throw past the Lead.
 */
import {
  canonicalSha256,
  finalize,
  type CandidatePacket,
  type CandidateSeed,
  type CapitalStructure,
  type CatalystRecord,
  type Claim,
  type Conflict,
  type MacroContext,
  type PacketDependencyManifest,
  type SentimentReading,
  type SourceAudit,
} from "@workspace/research-contracts";
import {
  defaultPlan,
  topoOrder,
  validateResearchPlan,
  type ResearchMode,
  type ResearchPlan,
  type SpecialistTool,
} from "./plan";
import type { AuditedClaim } from "./sourceGuardian";
import type { ContestResult } from "./contest";

/** A planner proposes; it never executes. Output is validated before use. */
export interface PlannerProvider {
  name: string;
  propose(input: { candidateId: string; symbol: string; researchMode: ResearchMode }): Promise<unknown>;
}

/**
 * The typed specialist registry — each entry wraps one Wave 2 agent with its
 * evidence already bound. Nullable results mean the specialist abstained
 * (e.g. provider unconfigured); they are recorded as UNKNOWN, not invented.
 */
export interface SpecialistRegistry {
  "catalyst.verify": () => Promise<CatalystRecord | null>;
  "catalyst.second_verify": (primary: CatalystRecord) => Promise<ContestResult | null>;
  "source.audit": (catalyst: CatalystRecord | null) => Promise<{ claims: Claim[]; audits: AuditedClaim[] } | null>;
  "sentiment.read": () => Promise<SentimentReading | null>;
  "macro.context": () => Promise<MacroContext | null>;
  "capital.structure": () => Promise<CapitalStructure | null>;
}

export type CheckState = "NOT_REQUIRED" | "COMPLETED" | "FAILED" | "UNKNOWN";

export interface LeadRunResult {
  packet: CandidatePacket;
  dependencyManifest: PacketDependencyManifest;
  plan: ResearchPlan;
  planIssues: string[];
  catalystRecords: CatalystRecord[];
  conflicts: Conflict[];
  claims: Claim[];
  audits: SourceAudit[];
  sentiment: SentimentReading | null;
  macro: MacroContext | null;
  capitalStructure: CapitalStructure | null;
}

export interface RunLeadInput {
  seed: CandidateSeed;
  researchMode: ResearchMode;
  specialists: SpecialistRegistry;
  planner?: PlannerProvider | null;
  runId: string;
  now: string;
  expiresAt: string;
  leadVersion?: string;
  sourcePolicyVersion?: string;
  configHash?: string | null;
  gitSha?: string | null;
  packetRevision?: number;
  supersedesPacketId?: string | null;
}

interface StepOutcome {
  tool: SpecialistTool;
  state: CheckState;
}

function manifestEntries(
  objects: Array<{ objectType: string; objectId: string; objectVersion: string; obj: Record<string, unknown> }>,
): PacketDependencyManifest["entries"] {
  return objects
    .map((o) => ({
      objectType: o.objectType,
      objectId: o.objectId,
      objectVersion: o.objectVersion,
      canonicalSha256: canonicalSha256(o.obj),
    }))
    .sort(
      (a, b) =>
        a.objectType.localeCompare(b.objectType) ||
        a.objectId.localeCompare(b.objectId) ||
        a.objectVersion.localeCompare(b.objectVersion),
    );
}

export async function runLead(input: RunLeadInput): Promise<LeadRunResult> {
  const { seed, specialists } = input;
  const mode = input.researchMode;

  // 1) Plan: proposed by the planner, validated by code; invalid → default.
  let plan = defaultPlan(seed.candidateId, mode);
  const planIssues: string[] = [];
  if (input.planner) {
    try {
      const proposed = await input.planner.propose({
        candidateId: seed.candidateId,
        symbol: seed.symbol,
        researchMode: mode,
      });
      const validation = validateResearchPlan(proposed, mode);
      if (validation.ok) {
        plan = proposed as ResearchPlan;
      } else {
        planIssues.push(...validation.issues, "proposed plan rejected; default plan used");
      }
    } catch {
      planIssues.push("planner unavailable; default plan used");
    }
  }
  const ordered = topoOrder(plan) ?? defaultPlan(seed.candidateId, mode).steps;

  // 2) Execute validated steps in dependency order, collecting typed outputs.
  const outcomes: StepOutcome[] = [];
  const catalystRecords: CatalystRecord[] = [];
  const conflicts: Conflict[] = [];
  let claims: Claim[] = [];
  let auditedClaims: AuditedClaim[] = [];
  let sentiment: SentimentReading | null = null;
  let macro: MacroContext | null = null;
  let capitalStructure: CapitalStructure | null = null;
  let primaryCatalyst: CatalystRecord | null = null;

  for (const step of ordered) {
    try {
      switch (step.tool) {
        case "catalyst.verify": {
          primaryCatalyst = await specialists["catalyst.verify"]();
          if (primaryCatalyst) catalystRecords.push(primaryCatalyst);
          outcomes.push({ tool: step.tool, state: primaryCatalyst ? "COMPLETED" : "UNKNOWN" });
          break;
        }
        case "catalyst.second_verify": {
          if (!primaryCatalyst) {
            outcomes.push({ tool: step.tool, state: "UNKNOWN" });
            break;
          }
          const contest = await specialists["catalyst.second_verify"](primaryCatalyst);
          if (contest) {
            conflicts.push(...contest.conflicts);
            // The contested record supersedes the primary in the packet.
            catalystRecords[catalystRecords.indexOf(primaryCatalyst)] = contest.record;
            primaryCatalyst = contest.record;
          }
          outcomes.push({ tool: step.tool, state: contest ? "COMPLETED" : "UNKNOWN" });
          break;
        }
        case "source.audit": {
          const result = await specialists["source.audit"](primaryCatalyst);
          if (result) {
            claims = result.claims;
            auditedClaims = result.audits;
          }
          outcomes.push({ tool: step.tool, state: result ? "COMPLETED" : "UNKNOWN" });
          break;
        }
        case "sentiment.read": {
          sentiment = await specialists["sentiment.read"]();
          outcomes.push({ tool: step.tool, state: sentiment ? "COMPLETED" : "UNKNOWN" });
          break;
        }
        case "macro.context": {
          macro = await specialists["macro.context"]();
          outcomes.push({
            tool: step.tool,
            state: macro ? (macro.required ? "COMPLETED" : "NOT_REQUIRED") : "UNKNOWN",
          });
          break;
        }
        case "capital.structure": {
          capitalStructure = await specialists["capital.structure"]();
          outcomes.push({ tool: step.tool, state: capitalStructure ? "COMPLETED" : "UNKNOWN" });
          break;
        }
      }
    } catch {
      outcomes.push({ tool: step.tool, state: "FAILED" });
    }
  }

  // 3) Fail-closed admission: only claims with SUPPORTED audits enter.
  const admitted = new Set(auditedClaims.filter((a) => a.admitted).map((a) => a.audit.claimId));
  const admittedClaimList = claims.filter((c) => admitted.has(c.claimId));
  const audits = auditedClaims.map((a) => a.audit);

  const stateOf = (tool: SpecialistTool): CheckState =>
    outcomes.find((o) => o.tool === tool)?.state ?? "NOT_REQUIRED";

  const checks = {
    catalyst: stateOf("catalyst.verify"),
    sourceAudit: stateOf("source.audit"),
    sentiment: stateOf("sentiment.read"),
    macro: stateOf("macro.context"),
    capitalStructure: stateOf("capital.structure"),
  };

  // 4) Outcome: catalyst+audit are the core; their failure blocks the packet.
  const coreStates = [checks.catalyst, checks.sourceAudit];
  const allStates = Object.values(checks);
  const researchOutcome: CandidatePacket["researchOutcome"] = coreStates.some(
    (s) => s === "FAILED" || s === "UNKNOWN",
  )
    ? "BLOCKED"
    : allStates.some((s) => s === "FAILED" || s === "UNKNOWN")
      ? "PARTIAL"
      : "COMPLETE";

  // 5) Dependency manifest — every referenced object, content-hashed, sorted.
  const entries = manifestEntries([
    { objectType: "CandidateSeed", objectId: seed.candidateId, objectVersion: seed.version, obj: seed },
    ...catalystRecords.map((r) => ({ objectType: "CatalystRecord", objectId: r.catalystId, objectVersion: r.version, obj: r })),
    ...admittedClaimList.map((c) => ({ objectType: "Claim", objectId: c.claimId, objectVersion: c.version, obj: c })),
    ...audits.map((a) => ({ objectType: "SourceAudit", objectId: a.auditId, objectVersion: a.version, obj: a })),
    ...conflicts.map((c) => ({ objectType: "Conflict", objectId: c.conflictId, objectVersion: c.version, obj: c })),
    ...(sentiment ? [{ objectType: "SentimentReading", objectId: sentiment.readingId, objectVersion: sentiment.version, obj: sentiment }] : []),
    ...(macro ? [{ objectType: "MacroContext", objectId: macro.macroContextId, objectVersion: macro.version, obj: macro }] : []),
    ...(capitalStructure ? [{ objectType: "CapitalStructure", objectId: capitalStructure.diligenceId, objectVersion: capitalStructure.version, obj: capitalStructure }] : []),
  ]);

  const dependencyManifest = finalize({
    contract: "PacketDependencyManifest" as const,
    version: "1.0.0",
    manifestId: `pdm_${input.runId}`,
    entries,
    createdAt: input.now,
  }) as PacketDependencyManifest;

  const includedSourceIds = [
    ...new Set(
      catalystRecords.flatMap((r) => [...r.primarySourceIds, ...r.secondarySourceIds]),
    ),
  ].sort();

  // 6) Packet assembly — ids and states only; every field traces to a specialist.
  const packet = finalize({
    contract: "CandidatePacket" as const,
    version: "1.0.0",
    packetId: `packet_${input.runId}`,
    packetRevision: input.packetRevision ?? 1,
    supersedesPacketId: input.supersedesPacketId ?? null,
    candidateId: seed.candidateId,
    symbol: seed.symbol,
    researchOutcome,
    researchMode: mode,
    checks,
    catalystRecordIds: catalystRecords.map((r) => r.catalystId),
    textFactorIds: [],
    sentimentReadingId: sentiment?.readingId ?? null,
    macroContextId: macro?.macroContextId ?? null,
    capitalStructureId: capitalStructure?.diligenceId ?? null,
    sourceAuditIds: audits.map((a) => a.auditId),
    conflictIds: conflicts.map((c) => c.conflictId),
    unknownFields: [],
    includedSourceIds,
    dependencyManifestRef: {
      manifestId: dependencyManifest.manifestId,
      manifestSha256: dependencyManifest.canonicalSha256,
    },
    provenance: {
      runId: input.runId,
      leadAgentId: "market-research-lead",
      leadAgentVersion: input.leadVersion ?? "1.0.0",
      configHash: input.configHash ?? null,
      gitSha: input.gitSha ?? null,
      sourcePolicyVersion: input.sourcePolicyVersion ?? "1.0.0",
    },
    createdAt: input.now,
    asOf: input.now,
    expiresAt: input.expiresAt,
  }) as CandidatePacket;

  return {
    packet,
    dependencyManifest,
    plan,
    planIssues,
    catalystRecords,
    conflicts,
    claims: admittedClaimList,
    audits,
    sentiment,
    macro,
    capitalStructure,
  };
}
