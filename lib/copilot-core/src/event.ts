// Canonical event assembly. Pure and mode/source-agnostic: everything needed is
// passed in via BuildEventInput. Any hard block forces alertLevel "L5".

import { MIN_CREDIBILITY } from "./constants";
import { computeFeatures } from "./features";
import { computeFeedQuality } from "./feedQuality";
import { evaluateGates } from "./gates";
import { evaluatePosition } from "./position";
import { computeRiskReward } from "./riskReward";
import { sanitizeDeep } from "./sanitize";
import {
  buildTriggerStack,
  detectTriggers,
  inferDirection,
} from "./triggers";
import type {
  AlertLevel,
  BuildEventInput,
  CopilotEvent,
  FeedQuality,
  GateVerdicts,
  MarketQuality,
  TriggerStack,
  ValidationSnapshot,
} from "./types";

const DEFAULT_VALIDATION: ValidationSnapshot = {
  status: "insufficient_sample",
  sampleCount: 0,
  expectancyR: null,
};

function summarizeMarketQuality(
  feedQuality: FeedQuality,
  gates: GateVerdicts,
): MarketQuality {
  return {
    spreadOk:
      feedQuality.spreadBps === null ? null : gates.spread.status !== "BLOCK",
    quoteFresh:
      feedQuality.quoteAgeSeconds === null ? null : !feedQuality.isStale,
    liquidityOk: gates.marketQuality.status !== "BLOCK",
    notes: feedQuality.notes,
  };
}

function computeAlertLevel(
  hardBlocksCount: number,
  triggerStack: TriggerStack,
  validation: ValidationSnapshot,
): AlertLevel {
  if (hardBlocksCount > 0) return "L5";
  const cred = triggerStack.credibility;
  const primary = triggerStack.category === "primary_edge";
  if (primary && cred >= 0.7 && validation.status === "paper_validated") {
    return "L4";
  }
  if (primary && cred >= 0.5) return "L3";
  if (cred >= MIN_CREDIBILITY) return "L2";
  return "L1";
}

export function buildCopilotEvent(input: BuildEventInput): CopilotEvent {
  const nowMs = input.nowMs ?? Date.now();
  const validation = input.validation ?? DEFAULT_VALIDATION;
  const bars = input.bars ?? [];
  const quote = input.quote ?? null;

  const features = computeFeatures(bars, quote);
  const triggers = detectTriggers(bars, features, {
    priorClose: input.priorClose ?? null,
    earningsTime: input.earningsTime ?? null,
    benchmarkReturnPct: input.benchmarkReturnPct ?? null,
  });
  const triggerStack = buildTriggerStack(triggers);
  const direction = inferDirection(triggers);

  const feedQuality = computeFeedQuality({
    source: input.dataSource,
    bars,
    quote,
    mode: input.mode,
    nowMs,
  });

  const { gates, hardBlocks } = evaluateGates({
    mode: input.mode,
    price: features.price,
    barCount: bars.length,
    feedQuality,
    triggerStack,
    validation,
  });

  const riskReward = computeRiskReward(features, direction);
  const position = evaluatePosition(input.position, features, riskReward);
  const marketQuality = summarizeMarketQuality(feedQuality, gates);
  const alertLevel = computeAlertLevel(
    hardBlocks.length,
    triggerStack,
    validation,
  );
  const l5Blocked = hardBlocks.length > 0;

  const lastBar = bars.length > 0 ? bars[bars.length - 1] : null;
  const eventMs = lastBar ? lastBar.t * 1000 : nowMs;
  const timestamp = new Date(eventMs).toISOString();
  const eventId = `${input.symbol}:${input.mode}:${eventMs}`;

  const warnings: string[] = [];
  for (const [name, verdict] of Object.entries(gates)) {
    if (verdict.status === "WARN" || verdict.status === "BLOCK") {
      warnings.push(`${name}: ${verdict.reason}`);
    }
  }

  const event: CopilotEvent = {
    eventId,
    symbol: input.symbol,
    timestamp,
    mode: input.mode,
    dataSource: input.dataSource,
    alertLevel,
    l5Blocked,
    snapshot: features,
    marketQuality,
    triggers,
    triggerStack,
    gates,
    hardBlocks,
    riskReward,
    position,
    feedQuality,
    warnings,
    bars,
  };

  return sanitizeDeep(event);
}
