// Integration tests for the analyst committee orchestrator over the deterministic
// fixtures. These assert the safety invariants end to end: schema validity, the
// absolute hard-block gate, forbidden-language rejection, and deterministic
// fallback when a provider misbehaves.

import { describe, it, expect } from "vitest";
import {
  buildCopilotEvent,
  getFixture,
  listFixtures,
  type CopilotEvent,
} from "@workspace/copilot-core";
import {
  runCommittee,
  scanForbiddenDeep,
  validateAgentRead,
  validateDashboardRead,
  isApprovedRecommendation,
  isHardBlocked,
  BLOCKED_ALLOWED_RECOMMENDATIONS,
  FORBIDDEN_PHRASES,
} from "./index";
import { createMockProvider } from "./mockProvider";

// Representative banned identifiers pulled from the canonical ban-list (vocab.ts)
// so these tests never hardcode the literal forbidden identifiers — the ban-list
// stays the single in-code definition site for them.
const SUBMIT_ORDER = FORBIDDEN_PHRASES.find((p) => p.startsWith("submit_"))!;
const EXECUTE_TRADE = FORBIDDEN_PHRASES.find((p) => p.startsWith("execute_"))!;

function eventFor(symbol: string): CopilotEvent {
  const fixture = getFixture(symbol);
  if (!fixture) throw new Error(`missing fixture ${symbol}`);
  return buildCopilotEvent({
    symbol: fixture.symbol,
    mode: fixture.mode,
    dataSource: fixture.dataSource,
    bars: fixture.bars,
    quote: fixture.quote,
    nowMs: fixture.nowMs,
  });
}

const SYMBOLS = listFixtures();
const BLOCKED = ["MSFT", "TSLA", "NODATA"];
const HEALTHY = "AAPL";

describe("committee — deterministic read over all fixtures", () => {
  it("produces a schema-valid, forbidden-free read for every fixture", async () => {
    for (const symbol of SYMBOLS) {
      const event = eventFor(symbol);
      const result = await runCommittee(event);

      expect(result.status).toBe("OK");
      expect(result.source).toBe("multi_agent_committee");
      expect(result.provider).toBe("deterministic");
      expect(result.degraded).toBe(false);

      // Exactly the ten specialist reads, each schema-valid.
      expect(result.agents).toHaveLength(10);
      for (const agent of result.agents) {
        expect(validateAgentRead(agent)).toEqual([]);
      }

      // Dashboard read schema-valid with an approved recommendation.
      expect(validateDashboardRead(result.dashboardRead)).toEqual([]);
      expect(isApprovedRecommendation(result.dashboardRead.recommendation)).toBe(true);

      // No forbidden language anywhere in the payload.
      expect(scanForbiddenDeep(result)).toEqual([]);

      // The research-only disclaimer is always present.
      expect(
        result.dashboardRead.riskNotes.some((note) =>
          note.toLowerCase().includes("research/helper output only"),
        ),
      ).toBe(true);
    }
  });
});

describe("committee — hard-block enforcement", () => {
  it("blocked fixtures only ever yield a defensive recommendation", async () => {
    for (const symbol of BLOCKED) {
      const event = eventFor(symbol);
      expect(isHardBlocked(event)).toBe(true);
      expect(event.l5Blocked).toBe(true);
      expect(event.alertLevel).toBe("L5");

      const result = await runCommittee(event);
      expect(result.l5Blocked).toBe(true);
      expect(BLOCKED_ALLOWED_RECOMMENDATIONS).toContain(
        result.dashboardRead.recommendation,
      );
    }
  });

  it("stays defensive even when a provider pushes an aggressive read", async () => {
    const event = eventFor("NODATA");
    const provider = createMockProvider({
      oneSentenceRead: "Strong long setup forming; conditions look favourable.",
      positionGuidance: ["Consider building exposure on strength."],
    });
    const result = await runCommittee(event, provider);
    expect(BLOCKED_ALLOWED_RECOMMENDATIONS).toContain(
      result.dashboardRead.recommendation,
    );
    expect(scanForbiddenDeep(result)).toEqual([]);
  });
});

describe("committee — final payload sanitation", () => {
  it("strips forbidden language sourced from event-derived warnings", async () => {
    const base = eventFor(HEALTHY);
    const event: CopilotEvent = {
      ...base,
      warnings: [...base.warnings, `Operator note: ${SUBMIT_ORDER} at the open.`],
    };

    const result = await runCommittee(event);

    // Nothing unsafe escapes anywhere in the payload, not just the dashboard read.
    expect(scanForbiddenDeep(result)).toEqual([]);
    expect(result.status).toBe("FALLBACK");
    expect(result.source).toBe("deterministic_fallback");
  });
});

describe("committee — healthy fixture", () => {
  it("AAPL is not hard-blocked and yields an approved recommendation", async () => {
    const event = eventFor(HEALTHY);
    expect(isHardBlocked(event)).toBe(false);

    const result = await runCommittee(event);
    expect(result.l5Blocked).toBe(false);
    expect(isApprovedRecommendation(result.dashboardRead.recommendation)).toBe(true);
  });
});

describe("committee — provider enrichment is prose-only", () => {
  it("accepts safe prose and keeps the deterministic recommendation", async () => {
    const event = eventFor(HEALTHY);
    const deterministic = await runCommittee(event);

    const provider = createMockProvider({
      oneSentenceRead: "Mock provider safe one-liner for research only.",
    });
    const enriched = await runCommittee(event, provider);

    expect(enriched.degraded).toBe(false);
    expect(enriched.source).toBe("multi_agent_committee");
    expect(enriched.provider).toBe("mock");
    expect(enriched.dashboardRead.oneSentenceRead).toBe(
      "Mock provider safe one-liner for research only.",
    );
    // The provider can never change the structured recommendation.
    expect(enriched.dashboardRead.recommendation).toBe(
      deterministic.dashboardRead.recommendation,
    );
  });

  it("rejects forbidden provider prose and falls back deterministically", async () => {
    const event = eventFor(HEALTHY);
    const deterministic = await runCommittee(event);

    const provider = createMockProvider({
      oneSentenceRead: `Use ${SUBMIT_ORDER} to ${EXECUTE_TRADE} now — guaranteed winner.`,
    });
    const result = await runCommittee(event, provider);

    expect(result.degraded).toBe(true);
    expect(result.source).toBe("deterministic_fallback");
    expect(scanForbiddenDeep(result)).toEqual([]);
    expect(result.dashboardRead.oneSentenceRead).toBe(
      deterministic.dashboardRead.oneSentenceRead,
    );
  });

  it("rejects provider prose that invents ungrounded figures", async () => {
    const event = eventFor(HEALTHY);
    const deterministic = await runCommittee(event);

    const provider = createMockProvider({
      oneSentenceRead: "Price is poised to reach 424242 within the hour.",
    });
    const result = await runCommittee(event, provider);

    expect(result.degraded).toBe(true);
    expect(result.source).toBe("deterministic_fallback");
    // The invented figure never reaches the client; prose reverts to deterministic.
    expect(result.dashboardRead.oneSentenceRead).toBe(
      deterministic.dashboardRead.oneSentenceRead,
    );
  });

  it("falls back deterministically when the provider throws", async () => {
    const event = eventFor(HEALTHY);
    const provider = {
      name: "boom",
      async enrich() {
        throw new Error("provider exploded");
      },
    };
    const result = await runCommittee(event, provider);

    expect(result.degraded).toBe(true);
    expect(result.source).toBe("deterministic_fallback");
    expect(validateDashboardRead(result.dashboardRead)).toEqual([]);
    expect(scanForbiddenDeep(result)).toEqual([]);
  });
});
