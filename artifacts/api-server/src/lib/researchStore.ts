/**
 * Persists a lead research run into the Supabase brain:
 * every referenced record → research_objects (content-addressed, dedupes on
 * canonical SHA-256), the packet → research_packets, and the run itself →
 * the agent_runs ledger. Append-only; integrity is re-verifiable forever by
 * walking the packet's dependency manifest against object hashes.
 */
import {
  db,
  agentRunsTable,
  researchObjectsTable,
  researchPacketsTable,
} from "@workspace/db";
import { canonicalSha256 } from "@workspace/research-contracts";
import type { LeadRunResult } from "@workspace/research-agents";
import { logger } from "./logger.js";

interface StorableObject {
  objectType: string;
  objectId: string;
  objectVersion: string;
  payload: Record<string, unknown>;
}

/** Pure: flatten a lead run into content-addressed object rows. */
export function objectsFromLeadRun(result: LeadRunResult): StorableObject[] {
  const objects: StorableObject[] = [
    ...result.catalystRecords.map((r) => ({
      objectType: "CatalystRecord", objectId: r.catalystId, objectVersion: r.version, payload: r as unknown as Record<string, unknown>,
    })),
    ...result.claims.map((c) => ({
      objectType: "Claim", objectId: c.claimId, objectVersion: c.version, payload: c as unknown as Record<string, unknown>,
    })),
    ...result.audits.map((a) => ({
      objectType: "SourceAudit", objectId: a.auditId, objectVersion: a.version, payload: a as unknown as Record<string, unknown>,
    })),
    ...result.conflicts.map((c) => ({
      objectType: "Conflict", objectId: c.conflictId, objectVersion: c.version, payload: c as unknown as Record<string, unknown>,
    })),
  ];
  if (result.sentiment) {
    objects.push({ objectType: "SentimentReading", objectId: result.sentiment.readingId, objectVersion: result.sentiment.version, payload: result.sentiment as unknown as Record<string, unknown> });
  }
  if (result.macro) {
    objects.push({ objectType: "MacroContext", objectId: result.macro.macroContextId, objectVersion: result.macro.version, payload: result.macro as unknown as Record<string, unknown> });
  }
  if (result.capitalStructure) {
    objects.push({ objectType: "CapitalStructure", objectId: result.capitalStructure.diligenceId, objectVersion: result.capitalStructure.version, payload: result.capitalStructure as unknown as Record<string, unknown> });
  }
  // The manifest itself is content-addressed evidence too.
  objects.push({
    objectType: "PacketDependencyManifest",
    objectId: result.dependencyManifest.manifestId,
    objectVersion: result.dependencyManifest.version,
    payload: result.dependencyManifest as unknown as Record<string, unknown>,
  });
  return objects;
}

/**
 * Best-effort persistence — a storage failure must never lose the computed
 * research response. Returns true when everything landed.
 */
export async function persistLeadRun(result: LeadRunResult): Promise<boolean> {
  const packet = result.packet;
  try {
    const objects = objectsFromLeadRun(result);
    if (objects.length > 0) {
      await db
        .insert(researchObjectsTable)
        .values(
          objects.map((o) => ({
            objectType: o.objectType,
            objectId: o.objectId,
            objectVersion: o.objectVersion,
            canonicalSha256: canonicalSha256(o.payload),
            symbol: packet.symbol,
            runId: packet.provenance.runId,
            payload: o.payload,
          })),
        )
        .onConflictDoNothing(); // content-addressed: identical objects store once
    }

    await db
      .insert(researchPacketsTable)
      .values({
        packetId: packet.packetId,
        packetRevision: packet.packetRevision,
        candidateId: packet.candidateId,
        symbol: packet.symbol,
        researchMode: packet.researchMode,
        researchOutcome: packet.researchOutcome,
        runId: packet.provenance.runId,
        checks: packet.checks,
        manifestId: packet.dependencyManifestRef.manifestId,
        manifestSha256: packet.dependencyManifestRef.manifestSha256,
        canonicalSha256: packet.canonicalSha256,
        packet,
        expiresAt: new Date(packet.expiresAt),
      })
      .onConflictDoNothing();

    await db
      .insert(agentRunsTable)
      .values({
        runId: packet.provenance.runId,
        agentId: packet.provenance.leadAgentId,
        agentVersion: packet.provenance.leadAgentVersion,
        configHash: packet.provenance.configHash,
        gitSha: packet.provenance.gitSha,
        status: "completed",
        checkpoint: { researchOutcome: packet.researchOutcome, checks: packet.checks },
        endedAt: new Date(),
      })
      .onConflictDoNothing();

    return true;
  } catch (err) {
    logger.warn({ err: String(err), packetId: packet.packetId }, "Research persistence failed (response still served)");
    return false;
  }
}
