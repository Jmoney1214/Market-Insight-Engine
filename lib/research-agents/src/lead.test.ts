import { describe, it, expect } from "vitest";
import {
  catalystFixture,
  claimFixture,
  auditFixture,
  sentimentFixture,
  macroFixture,
  capitalFixture,
  seedFixture,
  verifyFinalized,
  CandidatePacket,
  PacketDependencyManifest,
} from "@workspace/research-contracts";
import { runLead, type SpecialistRegistry, type PlannerProvider } from "./lead";
import { resolveContest } from "./contest";

const NOW = "2026-07-13T09:15:00-04:00";
const EXP = "2026-07-13T16:00:00-04:00";

const happySpecialists = (): SpecialistRegistry => ({
  "catalyst.verify": async () => catalystFixture(),
  "catalyst.second_verify": async (primary) =>
    resolveContest({
      primary,
      secondary: { ...catalystFixture(), catalystId: "cat_02" },
      now: NOW,
      conflictIdPrefix: "cfl",
    }),
  "source.audit": async () => ({
    claims: [claimFixture()],
    audits: [{ audit: auditFixture(), admitted: true }],
  }),
  "sentiment.read": async () => sentimentFixture(),
  "macro.context": async () => macroFixture(),
  "capital.structure": async () => capitalFixture(),
});

const base = (over: Partial<Parameters<typeof runLead>[0]> = {}) => ({
  seed: seedFixture(),
  researchMode: "STANDARD" as const,
  specialists: happySpecialists(),
  runId: "run_t1",
  now: NOW,
  expiresAt: EXP,
  ...over,
});

describe("runLead", () => {
  it("STANDARD happy path → COMPLETE packet, valid hashes, sorted manifest", async () => {
    const result = await runLead(base());
    expect(result.packet.researchOutcome).toBe("COMPLETE");
    expect(result.packet.checks).toEqual({
      catalyst: "COMPLETED",
      sourceAudit: "COMPLETED",
      sentiment: "COMPLETED",
      macro: "NOT_REQUIRED",
      capitalStructure: "NOT_REQUIRED",
    });

    // Contracts validate and hashes verify (finalize-then-validate).
    expect(CandidatePacket.safeParse(result.packet).success).toBe(true);
    expect(PacketDependencyManifest.safeParse(result.dependencyManifest).success).toBe(true);
    expect(verifyFinalized(result.packet)).toBe(true);
    expect(verifyFinalized(result.dependencyManifest)).toBe(true);
    expect(result.packet.dependencyManifestRef.manifestSha256).toBe(
      result.dependencyManifest.canonicalSha256,
    );

    // Manifest entries sorted by (objectType, objectId, objectVersion).
    const keys = result.dependencyManifest.entries.map(
      (e) => `${e.objectType}|${e.objectId}|${e.objectVersion}`,
    );
    expect(keys).toEqual([...keys].sort());

    // The packet references only specialist-produced objects.
    expect(result.packet.catalystRecordIds).toEqual(["cat_01"]);
    expect(result.packet.sentimentReadingId).toBe("sent_01");
    expect(result.packet.sourceAuditIds).toEqual(["audit_01"]);
  });

  it("DEEP mode runs the contest and macro/capital checks", async () => {
    const result = await runLead(base({ researchMode: "DEEP" }));
    expect(result.packet.checks.macro).toBe("COMPLETED");
    expect(result.packet.checks.capitalStructure).toBe("COMPLETED");
    expect(result.packet.researchOutcome).toBe("COMPLETE");
  });

  it("catalyst failure → BLOCKED (core check), never a throw", async () => {
    const specialists = happySpecialists();
    specialists["catalyst.verify"] = async () => {
      throw new Error("verifier down");
    };
    const result = await runLead(base({ specialists }));
    expect(result.packet.checks.catalyst).toBe("FAILED");
    expect(result.packet.researchOutcome).toBe("BLOCKED");
  });

  it("sentiment abstention → PARTIAL (non-core check unknown)", async () => {
    const specialists = happySpecialists();
    specialists["sentiment.read"] = async () => null;
    const result = await runLead(base({ specialists }));
    expect(result.packet.checks.sentiment).toBe("UNKNOWN");
    expect(result.packet.researchOutcome).toBe("PARTIAL");
    expect(result.packet.sentimentReadingId).toBeNull();
  });

  it("invalid planner proposal is rejected; the validated default plan executes", async () => {
    const planner: PlannerProvider = {
      name: "rogue",
      propose: async () => ({
        planId: "p",
        candidateId: "cand_01",
        researchMode: "STANDARD",
        steps: [{ stepId: "x", tool: "broker.execute", dependsOn: [] }],
      }),
    };
    const result = await runLead(base({ planner }));
    expect(result.planIssues.some((i) => i.includes("default plan used"))).toBe(true);
    expect(result.packet.researchOutcome).toBe("COMPLETE"); // default plan ran fine
  });

  it("planner crash falls back to the default plan", async () => {
    const planner: PlannerProvider = {
      name: "boom",
      propose: async () => {
        throw new Error("x");
      },
    };
    const result = await runLead(base({ planner }));
    expect(result.planIssues).toContain("planner unavailable; default plan used");
    expect(result.packet.researchOutcome).toBe("COMPLETE");
  });

  it("contest disagreement lands Conflict ids on packet and CONFLICTED record", async () => {
    const specialists = happySpecialists();
    specialists["catalyst.second_verify"] = async (primary) =>
      resolveContest({
        primary,
        secondary: {
          ...catalystFixture(),
          catalystId: "cat_02",
          materiality: "NOT_MATERIAL" as const,
        },
        now: NOW,
        conflictIdPrefix: "cfl_d",
      });
    const result = await runLead(base({ researchMode: "DEEP", specialists }));
    expect(result.conflicts).toHaveLength(1);
    expect(result.packet.conflictIds).toEqual(["cfl_d_1"]);
    expect(result.catalystRecords[0]!.verificationStatus).toBe("CONFLICTED");
  });

  it("only admitted claims enter the packet dependency set", async () => {
    const specialists = happySpecialists();
    specialists["source.audit"] = async () => ({
      claims: [claimFixture(), { ...claimFixture(), claimId: "claim_02" }],
      audits: [
        { audit: auditFixture(), admitted: true },
        { audit: { ...auditFixture(), auditId: "audit_02", claimId: "claim_02", validationStatus: "UNKNOWN" as const }, admitted: false },
      ],
    });
    const result = await runLead(base({ specialists }));
    expect(result.claims.map((c) => c.claimId)).toEqual(["claim_01"]);
    const claimEntries = result.dependencyManifest.entries.filter((e) => e.objectType === "Claim");
    expect(claimEntries.map((e) => e.objectId)).toEqual(["claim_01"]);
  });
});

describe("checkpoint resume (graph-shape-aware)", () => {
  it("emits a checkpoint after each completed step", async () => {
    const checkpoints: import("./lead").LeadCheckpoint[] = [];
    await runLead(base({ onCheckpoint: async (cp) => void checkpoints.push(cp) }));
    // STANDARD default plan: verify, audit, sentiment → 3 checkpoints.
    expect(checkpoints).toHaveLength(3);
    const last = checkpoints.at(-1)!;
    expect(Object.keys(last.completed).sort()).toEqual(["audit", "sentiment", "verify"]);
    expect(last.shapeHash).toMatch(/^sha256:/);
  });

  it("resume replays snapshots without re-invoking completed specialists", async () => {
    let checkpoint: import("./lead").LeadCheckpoint | null = null;
    await runLead(base({ onCheckpoint: async (cp) => void (checkpoint = cp) }));

    const calls: string[] = [];
    const specialists = happySpecialists();
    const wrap = <K extends keyof typeof specialists>(key: K) => {
      const original = specialists[key];
      specialists[key] = (async (...args: unknown[]) => {
        calls.push(key);
        return (original as (...a: unknown[]) => unknown)(...args);
      }) as (typeof specialists)[K];
    };
    (Object.keys(specialists) as Array<keyof typeof specialists>).forEach(wrap);

    const result = await runLead(base({ specialists, checkpoint }));
    expect(calls).toEqual([]); // everything replayed from snapshots
    expect(result.packet.researchOutcome).toBe("COMPLETE");
    expect(result.packet.checks.catalyst).toBe("COMPLETED");
  });

  it("a stale shape hash discards the checkpoint wholesale — no old/new mix", async () => {
    let checkpoint: import("./lead").LeadCheckpoint | null = null;
    await runLead(base({ onCheckpoint: async (cp) => void (checkpoint = cp) }));

    const calls: string[] = [];
    const specialists = happySpecialists();
    specialists["catalyst.verify"] = async () => {
      calls.push("catalyst.verify");
      return catalystFixture();
    };
    const result = await runLead(
      base({ specialists, checkpoint: { ...checkpoint!, shapeHash: "sha256:" + "0".repeat(64) } }),
    );
    expect(calls).toEqual(["catalyst.verify"]); // re-ran despite checkpoint
    expect(result.packet.researchOutcome).toBe("COMPLETE");
  });

  it("abstained (UNKNOWN) steps are not snapshotted — a resume retries them", async () => {
    const specialists = happySpecialists();
    specialists["sentiment.read"] = async () => null;
    let checkpoint: import("./lead").LeadCheckpoint | null = null;
    await runLead(base({ specialists, onCheckpoint: async (cp) => void (checkpoint = cp) }));
    expect(Object.keys(checkpoint!.completed)).not.toContain("sentiment");

    // On resume, sentiment runs again (now succeeding) while others replay.
    const resumed = await runLead(base({ checkpoint }));
    expect(resumed.packet.checks.sentiment).toBe("COMPLETED");
    expect(resumed.packet.researchOutcome).toBe("COMPLETE");
  });

  it("a crashing onCheckpoint never fails the run", async () => {
    const result = await runLead(
      base({ onCheckpoint: async () => { throw new Error("db down"); } }),
    );
    expect(result.packet.researchOutcome).toBe("COMPLETE");
  });
});
