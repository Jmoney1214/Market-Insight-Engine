// Per-agent unit tests for the deterministic specialist agents (spec §21 items
// 1-8, 19, 20). These assert each agent's honest degradation, that the
// "unavailable" agents never invent data, that position language stays
// non-directive, that the bull/bear cases cite only provided evidence, and that
// the risk critic blocks / downgrades on the documented conditions. Every read
// is additionally checked against the schema validator and the
// forbidden-language scanner.

import { describe, it, expect } from "vitest";
import {
  buildCopilotEvent,
  getFixture,
  listFixtures,
  type CopilotEvent,
} from "@workspace/copilot-core";
import type { AgentRead } from "../types";
import {
  technicalAgent,
  patternAgent,
  regimeAgent,
  orderFlowAgent,
  catalystAgent,
  positionAgent,
  memoryAgent,
  bullCaseAgent,
  riskCriticAgent,
  bearCaseAgent,
  runAgents,
  readsToArray,
} from "./index";
import { validateAgentRead, scanForbiddenDeep } from "../index";

function eventFor(symbol: string): CopilotEvent {
  const f = getFixture(symbol);
  if (!f) throw new Error(`missing fixture ${symbol}`);
  return buildCopilotEvent({
    symbol: f.symbol,
    mode: f.mode,
    dataSource: f.dataSource,
    bars: f.bars,
    quote: f.quote,
    nowMs: f.nowMs,
  });
}

function allGatesPass(base: CopilotEvent): CopilotEvent["gates"] {
  const gates = { ...base.gates };
  (Object.keys(gates) as (keyof CopilotEvent["gates"])[]).forEach((k) => {
    gates[k] = { status: "PASS", reason: "ok (test override)" };
  });
  return gates;
}

// A fully clean, flat, long-structured event: every gate PASS, healthy feed,
// 2:1 reward/risk, adequate credibility. The risk critic should find nothing to
// downgrade. Built from the healthy AAPL fixture with explicit overrides so the
// baseline is deterministic regardless of future fixture tuning.
function passBaseline(): CopilotEvent {
  const base = eventFor("AAPL");
  return {
    ...base,
    l5Blocked: false,
    hardBlocks: [],
    gates: allGatesPass(base),
    feedQuality: { ...base.feedQuality, isStale: false, verdict: "OK" },
    riskReward: { ...base.riskReward, direction: "LONG", ratio: 2 },
    triggerStack: { ...base.triggerStack, credibility: 0.8 },
    position: { ...base.position, status: "FLAT", side: null },
  };
}

const ALL_FIXTURES = listFixtures();

describe("honest degradation (items 1, 9)", () => {
  it("technical is DEGRADED when price/VWAP are unavailable", () => {
    const r = technicalAgent(eventFor("NODATA"));
    expect(r.status).toBe("DEGRADED");
    expect(r.confidence).toBe(0);
    expect(r.bias).toBe("UNKNOWN");
  });

  it("technical is OK with usable price/VWAP", () => {
    const base = eventFor("AAPL");
    const ev: CopilotEvent = {
      ...base,
      snapshot: { ...base.snapshot, price: 100, vwap: 99 },
    };
    expect(technicalAgent(ev).status).toBe("OK");
  });

  it("pattern is DEGRADED when no triggers are detected", () => {
    const r = patternAgent(eventFor("NODATA"));
    expect(r.status).toBe("DEGRADED");
    expect(r.confidence).toBe(0);
  });

  it("pattern is OK when a trigger stack is present", () => {
    const base = eventFor("AAPL");
    const ev: CopilotEvent = {
      ...base,
      triggerStack: { ...base.triggerStack, detectedTriggers: ["ORB_LONG"] },
    };
    expect(patternAgent(ev).status).toBe("OK");
  });

  it("regime reads the deterministic classification; DEGRADED only without one", () => {
    // Session fixtures carry enough bars for the core to classify, so the
    // agent reports the state (OK) and its headline names exactly that state.
    for (const sym of ["AAPL", "MSFT"]) {
      const ev = eventFor(sym);
      const r = regimeAgent(ev);
      expect(ev.regime.state).not.toBeNull();
      expect(r.status).toBe("OK");
      expect(r.headline.toLowerCase()).toContain(
        ev.regime.state!.replace(/_/g, " ").toLowerCase(),
      );
      expect(r.confidence).toBeLessThanOrEqual(0.7);
    }
    // No bars → no classification → honestly DEGRADED, no label invented.
    const nodata = eventFor("NODATA");
    expect(nodata.regime.state).toBeNull();
    const r = regimeAgent(nodata);
    expect(r.status).toBe("DEGRADED");
    expect(r.headline).not.toMatch(/trend|chop|range day|spike|power/i);
  });
});

describe("unavailable agents never invent data (items 2, 3, 4, 20)", () => {
  const ev = eventFor("AAPL");

  it("order flow is UNAVAILABLE without a trade tape (never inferred from price)", () => {
    // Fixtures supply no trades, so the event carries no order-flow summary.
    const r = orderFlowAgent(ev);
    expect(ev.orderFlow).toBeNull();
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.confidence).toBe(0);
    expect(r.bias).toBe("UNKNOWN");
    expect(r.supportingFactors).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("order flow reads real trades when supplied (tick-rule signed volume)", () => {
    const f = getFixture("AAPL")!;
    const withTape = buildCopilotEvent({
      symbol: f.symbol,
      mode: f.mode,
      dataSource: f.dataSource,
      bars: f.bars,
      quote: f.quote,
      nowMs: f.nowMs,
      trades: [
        { t: 1, p: 100.0, s: 100 },
        { t: 2, p: 100.02, s: 300 }, // uptick: buyer-initiated
        { t: 3, p: 100.05, s: 300 }, // uptick: buyer-initiated
        { t: 4, p: 100.05, s: 200 }, // zero-tick inherits buy
      ],
    });
    const r = orderFlowAgent(withTape);
    expect(withTape.orderFlow?.pressure).toBe("BUYING");
    expect(r.status).toBe("OK");
    expect(r.bias).toBe("BULLISH");
    expect(r.confidence).toBeLessThanOrEqual(0.6);
    expect(r.warnings.join(" ")).toMatch(/no level-2 depth/i);
  });

  it("catalyst is UNAVAILABLE without supplied news (never invented)", () => {
    // Fixtures supply no news, so the event carries no catalyst summary.
    const r = catalystAgent(ev);
    expect(ev.catalyst).toBeNull();
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.confidence).toBe(0);
    expect(r.supportingFactors).toEqual([]);
  });

  it("catalyst reads real supplied headlines — freshness only, bias stays NEUTRAL", () => {
    const f = getFixture("AAPL")!;
    const nowS = Math.floor((f.nowMs ?? Date.now()) / 1000);
    const withNews = buildCopilotEvent({
      symbol: f.symbol,
      mode: f.mode,
      dataSource: f.dataSource,
      bars: f.bars,
      quote: f.quote,
      nowMs: f.nowMs,
      news: [
        { headline: "Company reports record quarter", source: "Wire", publishedAt: nowS - 2 * 3600 },
        { headline: "Analyst raises price target", source: "Desk", publishedAt: nowS - 40 * 3600 },
      ],
    });
    const r = catalystAgent(withNews);
    expect(withNews.catalyst?.fresh24h).toBe(1);
    expect(r.status).toBe("OK");
    expect(r.bias).toBe("NEUTRAL"); // no sentiment inference from text, ever
    expect(r.confidence).toBeLessThanOrEqual(0.5);
    expect(r.supportingFactors.join(" ")).toContain("record quarter");
    expect(r.warnings.join(" ")).toMatch(/not inferred/i);
  });

  it("memory is UNAVAILABLE with no invented edge", () => {
    const r = memoryAgent(ev);
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.confidence).toBe(0);
    expect(r.supportingFactors).toEqual([]);
  });
});

describe("memory agent reports the measured edge when wired", () => {
  const base = eventFor("AAPL");

  it("paper_validated with positive expectancy → OK, measured, never dominates", () => {
    const ev: CopilotEvent = {
      ...base,
      validation: { status: "paper_validated", sampleCount: 40, expectancyR: 0.5 },
    };
    const r = memoryAgent(ev);
    expect(r.status).toBe("OK");
    expect(r.bias).toBe("NEUTRAL"); // memory measures edge quality, not direction
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(0.5); // capped — informs, never dominates
    expect(r.supportingFactors.join(" ")).toMatch(/40 samples/);
    expect(r.supportingFactors.join(" ")).toMatch(/0\.50R/);
  });

  it("no_edge → OK but cautions, must not raise conviction", () => {
    const ev: CopilotEvent = {
      ...base,
      validation: { status: "no_edge", sampleCount: 30, expectancyR: -0.2 },
    };
    const r = memoryAgent(ev);
    expect(r.status).toBe("OK");
    expect(r.bias).toBe("NEUTRAL");
    expect(r.warnings.join(" ")).toMatch(/non-positive|not raise conviction/i);
  });

  it("insufficient_sample stays UNAVAILABLE (honest, no data yet)", () => {
    const ev: CopilotEvent = {
      ...base,
      validation: { status: "insufficient_sample", sampleCount: 0, expectancyR: null },
    };
    expect(memoryAgent(ev).status).toBe("UNAVAILABLE");
  });

  it("unproven stays UNAVAILABLE even with non-countable samples present", () => {
    // status "unproven" ⟺ zero countable samples, though sampleCount may be > 0.
    const ev: CopilotEvent = {
      ...base,
      validation: { status: "unproven", sampleCount: 5, expectancyR: null },
    };
    expect(memoryAgent(ev).status).toBe("UNAVAILABLE");
  });
});

describe("position agent uses position-safe language (item 19)", () => {
  it("flat → review-only and neutral", () => {
    const r = positionAgent(passBaseline());
    expect(r.status).toBe("OK");
    expect(r.bias).toBe("NEUTRAL");
    expect(validateAgentRead(r)).toEqual([]);
    expect(scanForbiddenDeep(r)).toEqual([]);
  });

  it("in-position → describes the thesis without execution directives", () => {
    const base = eventFor("AAPL");
    const ev: CopilotEvent = {
      ...base,
      position: {
        ...base.position,
        status: "IN_POSITION",
        side: "LONG",
        thesisStatus: "WEAKENING",
        unrealizedR: -0.5,
      },
    };
    const r = positionAgent(ev);
    expect(r.status).toBe("OK");
    expect(validateAgentRead(r)).toEqual([]);
    expect(scanForbiddenDeep(r)).toEqual([]);
    const text = [r.headline, ...r.supportingFactors, ...r.warnings]
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/\b(buy|sell)\b/);
    expect(text).not.toMatch(/\benter the\b|\bexit the\b/);
  });
});

describe("bull / bear cases cite only provided evidence (item 5)", () => {
  it("bull case introduces no facts beyond the provided subreads", () => {
    const base = passBaseline();
    // direction=null so the bull case adds no structural R:R line; its factors
    // must then be drawn purely from the provided bullish subread.
    const ev: CopilotEvent = {
      ...base,
      riskReward: { ...base.riskReward, direction: null, ratio: null },
    };
    const sub: AgentRead[] = [
      {
        agent: "technical",
        status: "OK",
        bias: "BULLISH",
        confidence: 0.5,
        headline: "test",
        supportingFactors: ["Price 100.00 is above VWAP 99.00."],
        warnings: [],
        riskVerdict: null,
        maxRecommendation: null,
      },
    ];
    const r = bullCaseAgent(ev, sub);
    const provided = new Set(sub.flatMap((s) => s.supportingFactors));
    for (const f of r.supportingFactors) {
      expect(
        provided.has(f) ||
          f === "No structured bullish factors are currently present.",
        `ungrounded bull factor: ${f}`,
      ).toBe(true);
    }
    expect(validateAgentRead(r)).toEqual([]);
    expect(scanForbiddenDeep(r)).toEqual([]);
  });

  it("bear case introduces no facts beyond subreads + gate/block evidence", () => {
    const ev = eventFor("MSFT"); // L5-blocked → real hard-block + gate reasons
    const sub = readsToArray(runAgents(ev)).filter(
      (r) => !["bull_case", "bear_case", "risk_critic"].includes(r.agent),
    );
    const r = bearCaseAgent(ev, sub);
    const provided = new Set<string>();
    for (const s of sub) {
      s.supportingFactors.forEach((x) => provided.add(x));
      s.warnings.forEach((x) => provided.add(x));
    }
    const generated = [
      /^Hard block\(s\):/,
      / gate (WARN|BLOCK):/,
      /^Low trigger credibility/,
      /^No structured avoid reasons/,
    ];
    for (const f of r.supportingFactors) {
      const grounded = provided.has(f) || generated.some((re) => re.test(f));
      expect(grounded, `ungrounded bear factor: ${f}`).toBe(true);
    }
    expect(validateAgentRead(r)).toEqual([]);
    expect(scanForbiddenDeep(r)).toEqual([]);
  });
});

describe("risk critic verdicts (items 6, 7, 8, 10)", () => {
  it("PASS when nothing disqualifies (flat, clean gates, healthy R:R)", () => {
    const r = riskCriticAgent(passBaseline(), []);
    expect(r.riskVerdict).toBe("PASS");
    expect(r.maxRecommendation).toBe("POSSIBLE_LONG_ZONE");
  });

  it("BLOCK on an L5 hard-blocked event", () => {
    const r = riskCriticAgent(eventFor("MSFT"), []);
    expect(r.riskVerdict).toBe("BLOCK");
    expect([
      "AVOID",
      "DO_NOT_ADD",
      "EXIT_WARNING",
      "THESIS_INVALIDATED",
    ]).toContain(r.maxRecommendation);
  });

  it("WARN on a weak validation gate (item 6)", () => {
    const base = passBaseline();
    const ev: CopilotEvent = {
      ...base,
      gates: {
        ...base.gates,
        validation: { status: "WARN", reason: "Edge unproven (test)" },
      },
    };
    expect(riskCriticAgent(ev, []).riskVerdict).toBe("WARN");
  });

  it("WARN on a bad spread gate (item 7)", () => {
    const base = passBaseline();
    const ev: CopilotEvent = {
      ...base,
      gates: {
        ...base.gates,
        spread: { status: "WARN", reason: "Spread elevated (test)" },
      },
    };
    expect(riskCriticAgent(ev, []).riskVerdict).toBe("WARN");
  });

  it("WARN on thin reward/risk (item 8)", () => {
    const base = passBaseline();
    const ev: CopilotEvent = {
      ...base,
      riskReward: { ...base.riskReward, ratio: 1.2 },
    };
    expect(riskCriticAgent(ev, []).riskVerdict).toBe("WARN");
  });

  it("WARN on low trigger credibility", () => {
    const base = passBaseline();
    const ev: CopilotEvent = {
      ...base,
      triggerStack: { ...base.triggerStack, credibility: 0.3 },
    };
    expect(riskCriticAgent(ev, []).riskVerdict).toBe("WARN");
  });
});

describe("every agent read is schema-valid and forbidden-free over all fixtures", () => {
  for (const symbol of ALL_FIXTURES) {
    it(`${symbol}`, () => {
      const reads = readsToArray(runAgents(eventFor(symbol)));
      expect(reads.length).toBe(10);
      for (const r of reads) {
        expect(validateAgentRead(r), `invalid read for ${r.agent}`).toEqual([]);
        expect(
          scanForbiddenDeep(r),
          `forbidden language in ${r.agent}`,
        ).toEqual([]);
      }
    });
  }
});
