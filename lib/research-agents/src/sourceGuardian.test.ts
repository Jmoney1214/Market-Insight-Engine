import { describe, it, expect } from "vitest";
import { claimFixture, sourceDocFixture } from "@workspace/research-contracts";
import {
  admittedClaims,
  auditClaim,
  independentSourceCount,
  numericConsistent,
  type EntailmentProvider,
} from "./sourceGuardian";

const NOW = "2026-07-13T09:15:00-04:00";

const doc = sourceDocFixture(); // src_01, PRIMARY_REGULATOR, RGTI
const claim = claimFixture(); // CORE claim, evidence → src_01

const passage = "The Company announced a government contract award of $50,000,000.";

const entailsAll: EntailmentProvider = {
  name: "fake-entailer",
  judge: async ({ passages }) => ({
    perPassage: passages.map((p) => ({ sourceDocumentId: p.sourceDocumentId, verdict: "ENTAILS" })),
  }),
};

const base = () => ({
  auditId: "audit_t",
  claim,
  documents: new Map([[doc.sourceDocumentId, doc]]),
  passages: new Map([[doc.sourceDocumentId, passage]]),
  now: NOW,
});

describe("auditClaim — fail closed", () => {
  it("SUPPORTED + admitted only when entailment passes on trusted sources", async () => {
    const { audit, admitted } = await auditClaim({ ...base(), entailment: entailsAll });
    expect(audit.validationStatus).toBe("SUPPORTED");
    expect(admitted).toBe(true);
    expect(audit.entityStatus).toBe("MATCHED");
    expect(audit.temporalStatus).toBe("CURRENT");
  });

  it("no entailment provider → UNKNOWN and NOT admitted (fail closed)", async () => {
    const { audit, admitted } = await auditClaim({ ...base() });
    expect(audit.validationStatus).toBe("UNKNOWN");
    expect(admitted).toBe(false);
    expect(audit.auditReasonCodes).toContain("ENTAILMENT_UNAVAILABLE");
  });

  it("provider crash → UNKNOWN and NOT admitted (fail closed)", async () => {
    const crash: EntailmentProvider = { name: "boom", judge: async () => { throw new Error("x"); } };
    const { admitted, audit } = await auditClaim({ ...base(), entailment: crash });
    expect(admitted).toBe(false);
    expect(audit.auditReasonCodes).toContain("ENTAILMENT_PROVIDER_FAILED");
  });

  it("contradiction → UNSUPPORTED, not admitted", async () => {
    const contradicts: EntailmentProvider = {
      name: "no",
      judge: async ({ passages }) => ({
        perPassage: passages.map((p) => ({ sourceDocumentId: p.sourceDocumentId, verdict: "CONTRADICTS" })),
      }),
    };
    const { audit, admitted } = await auditClaim({ ...base(), entailment: contradicts });
    expect(audit.validationStatus).toBe("UNSUPPORTED");
    expect(admitted).toBe(false);
  });

  it("corrections supersede: corrected evidence is excluded and cannot support", async () => {
    const { audit, admitted } = await auditClaim({
      ...base(),
      corrections: new Map([[doc.sourceDocumentId, "src_99"]]),
      entailment: entailsAll,
    });
    expect(admitted).toBe(false);
    expect(audit.excludedSources).toEqual([
      { sourceDocumentId: doc.sourceDocumentId, reasonCode: "SUPERSEDED_BY_CORRECTION" },
    ]);
    expect(audit.validationStatus).toBe("UNKNOWN");
  });

  it("entity mismatch overrides a passing entailment", async () => {
    const wrongDoc = { ...doc, symbols: ["TSLA"] };
    const { audit, admitted } = await auditClaim({
      ...base(),
      documents: new Map([[doc.sourceDocumentId, wrongDoc]]),
      entailment: entailsAll,
    });
    expect(audit.entityStatus).toBe("MISMATCHED");
    expect(audit.validationStatus).toBe("UNSUPPORTED");
    expect(admitted).toBe(false);
  });

  it("numeric inconsistency downgrades SUPPORTED to CONFLICTED", async () => {
    const numericClaim = { ...claim, structuredValue: 60_000_000, unit: "USD" };
    const { audit, admitted } = await auditClaim({
      ...base(),
      claim: numericClaim,
      entailment: entailsAll,
    });
    expect(audit.numericStatus).toBe("INCONSISTENT");
    expect(audit.validationStatus).toBe("CONFLICTED");
    expect(admitted).toBe(false);
  });
});

describe("syndication lineage", () => {
  it("ten copies of one wire story count as ONE independent source", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `src_${i}`);
    const syndication = new Map(ids.map((id) => [id, "cluster_A"]));
    expect(independentSourceCount(ids, syndication)).toBe(1);
    expect(independentSourceCount(ids, undefined)).toBe(10);
  });
});

describe("numericConsistent", () => {
  it("matches values with thousands separators", () => {
    expect(numericConsistent(50_000_000, [passage])).toBe(true);
    expect(numericConsistent(51_000_000, [passage])).toBe(false);
  });
});

describe("admittedClaims gate", () => {
  it("filters to claims whose audits admit them", async () => {
    const good = await auditClaim({ ...base(), entailment: entailsAll });
    const bad = await auditClaim({ ...base(), auditId: "audit_t2", claim: { ...claim, claimId: "claim_02" } });
    const claims = [claim, { ...claim, claimId: "claim_02" }];
    expect(admittedClaims(claims, [good, bad]).map((c) => c.claimId)).toEqual(["claim_01"]);
  });
});
