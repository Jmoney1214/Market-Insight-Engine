import type {
  AuthRuntime,
  GovernanceRuntime,
  PrincipalKind,
} from "./types.js";
import {
  unavailableHistoricalCasePort,
  type HistoricalCasePort,
} from "./historicalCasePort.js";

export const TEST_BEARER = "test-permanent-bearer";

export function createTestAuthRuntime(options: {
  kind?: PrincipalKind;
  scopes: readonly string[];
  allowedOrigins?: readonly string[];
  historicalCasePort?: HistoricalCasePort;
  governance?: GovernanceRuntime;
}): AuthRuntime {
  const kind = options.kind ?? "human";
  return {
    allowedOrigins: options.allowedOrigins ?? ["https://desk.test"],
    historicalCasePort:
      options.historicalCasePort ?? unavailableHistoricalCasePort,
    ...(options.governance ? { governance: options.governance } : {}),
    repository: {
      async verifyApiCredential(rawSecret) {
        if (rawSecret !== TEST_BEARER) return null;
        return {
          principalId: "90000000-0000-4000-8000-000000000001",
          credentialId: "90000000-0000-4000-8000-000000000002",
          principalKind: kind,
          subject: "explicit-test-principal",
          scopes: options.scopes,
          ...(kind === "agent"
            ? {
                servicePrincipalId: "90000000-0000-4000-8000-000000000003",
                manifestId: "test-agent",
                manifestVersion: "v1",
              }
            : {}),
        };
      },
      async verifyBrowserSession() {
        return null;
      },
      async recordRequestStart() {
        return "90000000-0000-4000-8000-000000000004";
      },
      async completeRequest() {},
      async claimIdempotency() {
        return {
          status: "CLAIMED",
          idempotencyRecordId: "90000000-0000-4000-8000-000000000005",
        };
      },
      async createBrowserSession() {
        return "90000000-0000-4000-8000-000000000006";
      },
      async revokeBrowserSession() {},
    },
  };
}
