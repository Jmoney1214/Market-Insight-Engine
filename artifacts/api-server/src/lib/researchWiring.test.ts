import { describe, it, expect } from "vitest";
import { selectBackbones } from "./researchProviders.js";
import { blocksFromNewsRows, readingToLensInput } from "./sentimentContext.js";
import { reinforcementDelta } from "./memoryStore.js";
import { claimFromCatalyst } from "./researchRunner.js";
import { catalystFixture, sentimentFixture } from "@workspace/research-contracts";

describe("selectBackbones (contest independence)", () => {
  it("two providers configured → secondary is a DIFFERENT backbone", () => {
    const b = selectBackbones(["openai", "anthropic"]);
    expect(b.primary).toEqual({ id: "openai", tier: "deep" });
    expect(b.secondary).toEqual({ id: "anthropic", tier: "deep" });
  });

  it("one provider configured → secondary is the same provider's other tier", () => {
    const b = selectBackbones(["gemini"]);
    expect(b.primary).toEqual({ id: "gemini", tier: "deep" });
    expect(b.secondary).toEqual({ id: "gemini", tier: "quick" });
  });

  it("nothing configured → both null (fully deterministic mode)", () => {
    expect(selectBackbones([])).toEqual({ primary: null, secondary: null });
  });

  it("an explicit request is honored only when configured", () => {
    expect(selectBackbones(["openai", "anthropic"], "anthropic").primary).toEqual({
      id: "anthropic",
      tier: "deep",
    });
    expect(selectBackbones(["openai"], "gemini").primary).toBeNull();
  });
});

describe("blocksFromNewsRows (news-only grounding)", () => {
  const rows = [
    { clusterKey: "k1", headline: "RGTI wins contract", symbols: ["RGTI"], firstSeen: new Date("2026-07-13T12:00:00Z") },
    { clusterKey: "k2", headline: "TSLA recalls cars", symbols: ["TSLA"], firstSeen: new Date("2026-07-13T11:00:00Z") },
  ];

  it("filters to the symbol and emits NEWS blocks only", () => {
    const blocks = blocksFromNewsRows(rows, "RGTI");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      blockId: "news:k1",
      kind: "NEWS",
      text: "RGTI wins contract",
      publishedAt: "2026-07-13T12:00:00.000Z",
    });
  });

  it("no mentions → no blocks (lens stays UNAVAILABLE, never fabricated)", () => {
    expect(blocksFromNewsRows(rows, "AMD")).toEqual([]);
  });
});

describe("readingToLensInput", () => {
  it("maps the contract reading onto the committee lens shape", () => {
    const lens = readingToLensInput(sentimentFixture());
    expect(lens.band).toBe("BULLISH");
    expect(lens.isEventProof).toBe(false);
    expect(lens.sources.length).toBeGreaterThan(0);
  });
});

describe("claimFromCatalyst", () => {
  it("derives one CORE claim citing every catalyst source", () => {
    const claim = claimFromCatalyst(catalystFixture(), "2026-07-13T13:00:00Z")!;
    expect(claim.criticality).toBe("CORE");
    expect(claim.text).toBe(catalystFixture().eventDescription);
    expect(claim.evidence.map((e) => e.sourceDocumentId)).toEqual(["src_01"]);
  });

  it("returns null when the catalyst has no sources — nothing to audit", () => {
    const bare = { ...catalystFixture(), primarySourceIds: [], secondarySourceIds: [] };
    expect(claimFromCatalyst(bare, "2026-07-13T13:00:00Z")).toBeNull();
  });
});

describe("reinforcementDelta (the dead-loop regression: event grades must count)", () => {
  it("outcome scores center on 0.5", () => {
    expect(reinforcementDelta({ score: 0.7, eventSignificant: null })).toBe(4);
    expect(reinforcementDelta({ score: 0.2, eventSignificant: null })).toBe(-6);
  });

  it("event-study verdicts reinforce when no outcome score exists", () => {
    expect(reinforcementDelta({ score: null, eventSignificant: true })).toBe(10);
    expect(reinforcementDelta({ score: null, eventSignificant: false })).toBe(-8);
  });

  it("no grade signal at all → null, never a guessed delta", () => {
    expect(reinforcementDelta({ score: null, eventSignificant: null })).toBeNull();
  });
});
