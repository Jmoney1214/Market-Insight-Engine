import {
  ControlPlaneAuthRepository,
  createControlPlanePools,
} from "@workspace/db/control-plane";
import type { AuthRuntime } from "./types.js";
import { unavailableHistoricalCasePort } from "./historicalCasePort.js";
import { createDecisionAttestor } from "./decisionAttestation.js";

function allowedOrigins(env: NodeJS.ProcessEnv): readonly string[] {
  const origins = (env["MIE_ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error("MIE_ALLOWED_ORIGINS must contain at least one Desk origin");
  }
  return origins;
}

export function createProductionAuthRuntime(
  env: NodeJS.ProcessEnv,
): AuthRuntime {
  const pools = createControlPlanePools(env);
  const repository = new ControlPlaneAuthRepository(pools);
  return {
    repository,
    allowedOrigins: allowedOrigins(env),
    historicalCasePort: unavailableHistoricalCasePort,
    governance: {
      repository,
      attestor: createDecisionAttestor({
        keyId: env["MIE_DECISION_ATTESTATION_KEY_ID"] ?? "",
        key: env["MIE_DECISION_ATTESTATION_KEY"] ?? "",
      }),
    },
  };
}
