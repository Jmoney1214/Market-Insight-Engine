import type { Request } from "express";
import type {
  PrincipalKind,
  ProtectedRoutePolicy,
  PublicRoutePolicy,
  RoutePolicy,
} from "./types.js";

const humanService = ["human", "service"] as const satisfies readonly PrincipalKind[];
const humanOnly = ["human"] as const satisfies readonly PrincipalKind[];

function publicPolicy(
  operationId: string,
  method: string,
  path: string,
): PublicRoutePolicy {
  return { operationId, method, path, auth: "public", idempotency: "none" };
}

function protectedPolicy(
  operationId: string,
  method: string,
  path: string,
  allowedKinds: readonly PrincipalKind[],
  requiredScopes: readonly string[],
  options: Partial<
    Pick<ProtectedRoutePolicy, "authModes" | "idempotency" | "stepUp">
  > = {},
): ProtectedRoutePolicy {
  return {
    operationId,
    method,
    path,
    auth: "protected",
    authModes: options.authModes ?? ["bearer", "cookie"],
    allowedKinds,
    requiredScopes,
    idempotency: options.idempotency ?? "none",
    ...(options.stepUp === undefined ? {} : { stepUp: options.stepUp }),
  };
}

export const routePolicyRegistry = {
  healthCheck: publicPolicy("healthCheck", "GET", "/healthz"),
  copilotHealthCheck: publicPolicy("copilotHealthCheck", "GET", "/copilot/healthz"),
  createSession: protectedPolicy("createSession", "POST", "/auth/session", humanOnly, [], {
    authModes: ["bearer"],
  }),
  deleteSession: protectedPolicy("deleteSession", "DELETE", "/auth/session", humanOnly, [], {
    authModes: ["cookie"],
  }),
  getCurrentPrincipal: protectedPolicy(
    "getCurrentPrincipal",
    "GET",
    "/auth/whoami",
    ["human", "service", "agent"],
    [],
  ),
  issuePrincipal: protectedPolicy(
    "issuePrincipal",
    "POST",
    "/governance/principals",
    humanOnly,
    ["governance:credentials"],
    { authModes: ["cookie"], idempotency: "required", stepUp: true },
  ),
  revokePrincipal: protectedPolicy(
    "revokePrincipal",
    "POST",
    "/governance/principals/:principalId/revoke",
    humanOnly,
    ["governance:credentials"],
    { authModes: ["cookie"], idempotency: "required", stepUp: true },
  ),
  issueCredential: protectedPolicy(
    "issueCredential",
    "POST",
    "/governance/credentials",
    humanOnly,
    ["governance:credentials"],
    { authModes: ["cookie"], idempotency: "required", stepUp: true },
  ),
  revokeCredential: protectedPolicy(
    "revokeCredential",
    "POST",
    "/governance/credentials/:credentialId/revoke",
    humanOnly,
    ["governance:credentials"],
    { authModes: ["cookie"], idempotency: "required", stepUp: true },
  ),
  getPremarketScan: protectedPolicy(
    "getPremarketScan",
    "GET",
    "/scan/premarket",
    humanService,
    ["scan:refresh"],
    { idempotency: "required" },
  ),
  getScanScorecard: protectedPolicy(
    "getScanScorecard",
    "GET",
    "/scan/scorecard",
    humanService,
    ["desk:read"],
  ),
  getUniverseSnapshot: protectedPolicy(
    "getUniverseSnapshot",
    "GET",
    "/scan/universe-snapshot",
    humanService,
    ["desk:read"],
  ),
  analyzeTicker: protectedPolicy("analyzeTicker", "POST", "/analyze", humanOnly, ["report:write"], {
    idempotency: "required",
  }),
  listReports: protectedPolicy("listReports", "GET", "/reports", humanService, ["desk:read"]),
  getReport: protectedPolicy("getReport", "GET", "/reports/:id", humanService, ["desk:read"]),
  deleteReport: protectedPolicy(
    "deleteReport",
    "DELETE",
    "/reports/:id",
    humanOnly,
    ["report:write"],
    { idempotency: "required" },
  ),
  getWatchlist: protectedPolicy("getWatchlist", "GET", "/watchlist", humanService, ["desk:read"]),
  addToWatchlist: protectedPolicy(
    "addToWatchlist",
    "POST",
    "/watchlist",
    humanOnly,
    ["watchlist:write"],
    { idempotency: "required" },
  ),
  removeFromWatchlist: protectedPolicy(
    "removeFromWatchlist",
    "DELETE",
    "/watchlist/:ticker",
    humanOnly,
    ["watchlist:write"],
    { idempotency: "required" },
  ),
  getCopilotEvent: protectedPolicy(
    "getCopilotEvent",
    "GET",
    "/copilot/event",
    humanService,
    ["event:generate"],
    { idempotency: "required" },
  ),
  explainCopilotEvent: protectedPolicy(
    "explainCopilotEvent",
    "GET",
    "/copilot/explain",
    humanService,
    ["event:generate", "committee:run"],
    { idempotency: "required" },
  ),
  listJournalEntries: protectedPolicy(
    "listJournalEntries",
    "GET",
    "/copilot/journal",
    humanService,
    ["desk:read"],
  ),
  createJournalEntry: protectedPolicy(
    "createJournalEntry",
    "POST",
    "/copilot/journal",
    humanOnly,
    ["journal:write"],
    { idempotency: "required" },
  ),
  deleteJournalEntry: protectedPolicy(
    "deleteJournalEntry",
    "DELETE",
    "/copilot/journal/:id",
    humanOnly,
    ["journal:write"],
    { idempotency: "required" },
  ),
  listStrategies: protectedPolicy(
    "listStrategies",
    "GET",
    "/copilot/strategies",
    humanService,
    ["desk:read"],
  ),
  listValidationStates: protectedPolicy(
    "listValidationStates",
    "GET",
    "/copilot/validation",
    humanService,
    ["desk:read"],
  ),
  getScoreboard: protectedPolicy(
    "getScoreboard",
    "GET",
    "/copilot/scoreboard",
    humanService,
    ["desk:read"],
  ),
  listHistoryEvents: protectedPolicy(
    "listHistoryEvents",
    "GET",
    "/copilot/history",
    humanService,
    ["desk:read"],
  ),
  getReplaySession: protectedPolicy(
    "getReplaySession",
    "GET",
    "/copilot/replay/session",
    humanService,
    ["replay:read"],
  ),
  getReplayEvent: protectedPolicy(
    "getReplayEvent",
    "GET",
    "/copilot/replay/event",
    humanService,
    ["replay:read"],
  ),
  explainReplayEvent: protectedPolicy(
    "explainReplayEvent",
    "GET",
    "/copilot/replay/explain",
    humanService,
    ["replay:read", "committee:run"],
    { idempotency: "required" },
  ),
} as const satisfies Record<string, RoutePolicy>;

export type OperationId = keyof typeof routePolicyRegistry;
const policies: readonly RoutePolicy[] = Object.values(routePolicyRegistry);

function pathMatches(template: string, actual: string): boolean {
  const expectedParts = template.split("/").filter(Boolean);
  const actualParts = actual.split("/").filter(Boolean);
  return (
    expectedParts.length === actualParts.length &&
    expectedParts.every(
      (part, index) => part.startsWith(":") || part === actualParts[index],
    )
  );
}

export function resolveRoutePolicy(req: Request): RoutePolicy | null {
  const path = req.path.startsWith("/api/") ? req.path.slice(4) : req.path;
  return (
    policies.find(
      (policy) =>
        policy.method === req.method.toUpperCase() && pathMatches(policy.path, path),
    ) ?? null
  );
}

export function allRoutePolicies(): readonly RoutePolicy[] {
  return policies;
}
