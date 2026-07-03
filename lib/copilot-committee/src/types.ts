// Structured output types for the analyst committee. These mirror the OpenAPI
// schema field names so the API boundary can validate them with generated Zod.

import type { AlertLevel } from "@workspace/copilot-core";
import type { Recommendation, Bias, AgentStatus, RiskVerdict } from "./vocab";

export type AgentName =
  | "technical"
  | "pattern"
  | "regime"
  | "order_flow"
  | "catalyst"
  | "position"
  | "memory"
  | "bull_case"
  | "bear_case"
  | "risk_critic";

/** A single specialist agent's read. */
export interface AgentRead {
  agent: AgentName;
  status: AgentStatus;
  bias: Bias;
  /** Clamped to [0,1]. */
  confidence: number;
  headline: string;
  supportingFactors: string[];
  warnings: string[];
  /** Populated only by the risk critic; null for every other agent. */
  riskVerdict: RiskVerdict | null;
  /** Risk critic's recommendation ceiling; null for every other agent. */
  maxRecommendation: Recommendation | null;
}

/** The single synthesized dashboard-safe read. */
export interface DashboardRead {
  oneSentenceRead: string;
  recommendation: Recommendation;
  confidence: number;
  whatSupports: string[];
  whatArguesAgainst: string[];
  whatConfirms: string[];
  whatInvalidates: string[];
  positionGuidance: string[];
  riskNotes: string[];
}

/** All ten specialist reads, keyed for the synthesizer. */
export interface CommitteeReads {
  technical: AgentRead;
  pattern: AgentRead;
  regime: AgentRead;
  orderFlow: AgentRead;
  catalyst: AgentRead;
  position: AgentRead;
  memory: AgentRead;
  bullCase: AgentRead;
  bearCase: AgentRead;
  riskCritic: AgentRead;
}

export type CommitteeStatus = "OK" | "FALLBACK" | "ERROR";
export type CommitteeSource = "multi_agent_committee" | "deterministic_fallback";

/** The full committee response returned to the API boundary. */
export interface CommitteeResult {
  status: CommitteeStatus;
  source: CommitteeSource;
  eventId: string;
  symbol: string;
  alertLevel: AlertLevel | null;
  l5Blocked: boolean;
  /** Provider name used, or "deterministic" when no AI is involved. */
  provider: string;
  /** True when AI enrichment was attempted but rejected / failed. */
  degraded: boolean;
  agents: AgentRead[];
  dashboardRead: DashboardRead;
  warnings: string[];
}

/** Read-only context handed to an LLM provider for prose enrichment only. */
export interface ProviderContext {
  symbol: string;
  alertLevel: string | null;
  l5Blocked: boolean;
  recommendation: Recommendation;
  agents: AgentRead[];
  deterministicRead: DashboardRead;
}

/**
 * The ONLY fields an LLM provider may influence. Structured decision fields
 * (recommendation, confidence, biases, support arrays, agent verdicts) are
 * never accepted from a provider.
 */
export type ProviderProse = Partial<
  Pick<DashboardRead, "oneSentenceRead" | "positionGuidance" | "riskNotes">
>;

export interface CommitteeProvider {
  readonly name: string;
  enrich(context: ProviderContext): Promise<ProviderProse>;
}
