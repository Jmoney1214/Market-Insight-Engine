import { describe, it, expect } from "vitest";
import { CONTRACT_REGISTRY, CandidateSeed, CandidatePacket, SentimentReading } from "./contracts";
import * as fx from "./fixtures";

const FIXTURES: Record<string, () => unknown> = {
  CandidateSeed: fx.seedFixture,
  SourceDocument: fx.sourceDocFixture,
  Claim: fx.claimFixture,
  SourceAudit: fx.auditFixture,
  CatalystRecord: fx.catalystFixture,
  TextFactor: fx.factorFixture,
  SentimentReading: fx.sentimentFixture,
  MacroContext: fx.macroFixture,
  CapitalStructure: fx.capitalFixture,
  PacketDependencyManifest: fx.manifestFixture,
  CandidatePacket: fx.packetFixture,
};

describe("contract fixtures validate", () => {
  for (const [name, make] of Object.entries(FIXTURES)) {
    it(`${name} accepts its valid fixture`, () => {
      const schema = CONTRACT_REGISTRY[name as keyof typeof CONTRACT_REGISTRY];
      const res = schema.safeParse(make());
      if (!res.success) throw new Error(res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      expect(res.success).toBe(true);
    });
  }
});

describe("strictness", () => {
  it("rejects unknown properties on every contract", () => {
    for (const [name, make] of Object.entries(FIXTURES)) {
      const schema = CONTRACT_REGISTRY[name as keyof typeof CONTRACT_REGISTRY];
      const poisoned = { ...(make() as Record<string, unknown>), __extra: 1 };
      expect(schema.safeParse(poisoned).success, `${name} must reject unknown keys`).toBe(false);
    }
  });

  it("hashed contracts REQUIRE canonicalSha256 (finalize-then-validate)", () => {
    const { canonicalSha256: _h, ...draft } = fx.seedFixture();
    expect(CandidateSeed.safeParse(draft).success).toBe(false);
    const { canonicalSha256: _h2, ...pdraft } = fx.packetFixture();
    expect(CandidatePacket.safeParse(pdraft).success).toBe(false);
  });

  it("sentiment can never claim to be event proof", () => {
    const bad = { ...fx.sentimentFixture(), isEventProof: true };
    expect(SentimentReading.safeParse(bad).success).toBe(false);
  });

  it("rejects malformed symbols, hashes, and out-of-range scores", () => {
    expect(CandidateSeed.safeParse({ ...fx.seedFixture(), symbol: "bad symbol!" }).success).toBe(false);
    expect(CandidateSeed.safeParse({ ...fx.seedFixture(), canonicalSha256: "sha256:xyz" }).success).toBe(false);
    expect(SentimentReading.safeParse({ ...fx.sentimentFixture(), score: 2 }).success).toBe(false);
  });
});
