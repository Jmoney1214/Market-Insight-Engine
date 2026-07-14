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
import { eq } from "drizzle-orm";
import { canonicalSha256 } from "@workspace/research-contracts";
import type { LeadCheckpoint, LeadRunResult } from "@workspace/research-agents";
import { logger } from "./logger.js";

/** Opens the run in the ledger (status running). Safe to re-call on resume. */
export async function startAgentRun(runId: string, agentId: string, agentVersion: string): Promise<void> {
  try {
    await db
      .insert(agentRunsTable)
      .values({ runId, agentId, agentVersion, status: "running" })
      .onConflictDoNothing();
  } catch (err) {
    logger.warn({ err: String(err), runId }, "Run-ledger open failed (non-fatal)");
  }
}

/** Persists a step checkpoint onto the run row (crash-resume state). */
export async function checkpointAgentRun(runId: string, checkpoint: LeadCheckpoint): Promise<void> {
  await db.update(agentRunsTable).set({ checkpoint }).where(eq(agentRunsTable.runId, runId));
}

/** Loads a prior run's checkpoint for resume; null when absent. */
export async function loadCheckpoint(runId: string): Promise<LeadCheckpoint | null> {
  try {
    const rows = await db
      .select({ checkpoint: agentRunsTable.checkpoint })
      .from(agentRunsTable)
      .where(eq(agentRunsTable.runId, runId))
      .limit(1);
    const cp = rows[0]?.checkpoint as LeadCheckpoint | null | undefined;
    return cp && typeof cp === "object" && "shapeHash" in cp ? cp : null;
  } catch (err) {
    logger.warn({ err: String(err), runId }, "Checkpoint load failed; starting fresh");
    return null;
  }
}

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
    // Secondary verifications persist too — accuracy ranking needs them.
    ...result.secondaryCatalysts.map((r) => ({
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
        endedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: agentRunsTable.runId,
        // startAgentRun opens the row first, so this update path is the norm:
        // land provenance (reproducibility invariant) and clear the mid-run
        // resume checkpoint — a completed run must never offer stale state.
        set: {
          status: "completed",
          endedAt: new Date(),
          configHash: packet.provenance.configHash,
          gitSha: packet.provenance.gitSha,
          agentVersion: packet.provenance.leadAgentVersion,
          checkpoint: null,
        },
      });

    return true;
  } catch (err) {
    logger.warn({ err: String(err), packetId: packet.packetId }, "Research persistence failed (response still served)");
    return false;
  }
}
