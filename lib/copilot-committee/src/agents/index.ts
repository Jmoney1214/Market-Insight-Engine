import type { CopilotEvent } from "@workspace/copilot-core";
import type { AgentRead, CommitteeExtras, CommitteeReads } from "../types";
import { technicalAgent } from "./technical";
import { patternAgent } from "./pattern";
import { regimeAgent } from "./regime";
import { orderFlowAgent } from "./orderFlow";
import { catalystAgent } from "./catalyst";
import { positionAgent } from "./position";
import { memoryAgent } from "./memory";
import { sentimentAgent } from "./sentiment";
import { bullCaseAgent } from "./bullCase";
import { bearCaseAgent } from "./bearCase";
import { riskCriticAgent } from "./riskCritic";

export {
  technicalAgent,
  patternAgent,
  regimeAgent,
  orderFlowAgent,
  catalystAgent,
  positionAgent,
  memoryAgent,
  sentimentAgent,
  bullCaseAgent,
  bearCaseAgent,
  riskCriticAgent,
};

/** Deterministic read for a lens the planner did not select for this ticker. */
function notSelectedRead(agent: AgentRead["agent"]): AgentRead {
  return {
    agent,
    status: "UNAVAILABLE",
    bias: "UNKNOWN",
    confidence: 0,
    headline: "Not selected by the committee planner for this read.",
    supportingFactors: [],
    warnings: [],
    riskVerdict: null,
    maxRecommendation: null,
  };
}

/**
 * Runs the specialist agents in dependency order. With a validated planner
 * selection, only selected lenses execute (bull/bear/risk ALWAYS run); with
 * no selection, every lens runs — parallel mode, the default.
 */
export function runAgents(event: CopilotEvent, extras?: CommitteeExtras): CommitteeReads {
  const selection = extras?.lensSelection ?? null;
  const wants = (lens: string) => selection === null || selection.includes(lens);

  const technical = wants("technical") ? technicalAgent(event) : notSelectedRead("technical");
  const pattern = wants("pattern") ? patternAgent(event) : notSelectedRead("pattern");
  const regime = wants("regime") ? regimeAgent(event) : notSelectedRead("regime");
  const orderFlow = wants("order_flow") ? orderFlowAgent(event) : notSelectedRead("order_flow");
  const catalyst = wants("catalyst") ? catalystAgent(event) : notSelectedRead("catalyst");
  const position = wants("position") ? positionAgent(event) : notSelectedRead("position");
  const memory = wants("memory") ? memoryAgent(event) : notSelectedRead("memory");
  const sentiment = wants("sentiment")
    ? sentimentAgent(event, extras?.sentiment)
    : notSelectedRead("sentiment");

  const sub = [technical, pattern, regime, orderFlow, catalyst, position, memory, sentiment];
  const bullCase = bullCaseAgent(event, sub);
  const bearCase = bearCaseAgent(event, sub);
  const riskCritic = riskCriticAgent(event, [...sub, bullCase, bearCase]);

  return {
    technical,
    pattern,
    regime,
    orderFlow,
    catalyst,
    position,
    memory,
    sentiment,
    bullCase,
    bearCase,
    riskCritic,
  };
}

/** Flattens the keyed reads into the ordered array used in the API response. */
export function readsToArray(reads: CommitteeReads): AgentRead[] {
  return [
    reads.technical,
    reads.pattern,
    reads.regime,
    reads.orderFlow,
    reads.catalyst,
    reads.position,
    reads.memory,
    reads.sentiment,
    reads.bullCase,
    reads.bearCase,
    reads.riskCritic,
  ];
}
