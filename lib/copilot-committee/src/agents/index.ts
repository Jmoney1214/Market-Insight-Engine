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

/** Runs every deterministic specialist agent in dependency order. */
export function runAgents(event: CopilotEvent, extras?: CommitteeExtras): CommitteeReads {
  const technical = technicalAgent(event);
  const pattern = patternAgent(event);
  const regime = regimeAgent(event);
  const orderFlow = orderFlowAgent(event);
  const catalyst = catalystAgent(event);
  const position = positionAgent(event);
  const memory = memoryAgent(event);
  const sentiment = sentimentAgent(event, extras?.sentiment);

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
