import type { PrincipalContext, ProtectedRoutePolicy } from "./types.js";

export function authorizeOperation(
  policy: ProtectedRoutePolicy,
  principal: PrincipalContext,
): boolean {
  return (
    policy.allowedKinds.includes(principal.principal.kind) &&
    policy.requiredScopes.every((scope) =>
      principal.effectiveScopes.includes(scope),
    )
  );
}

const toolScopeById: Readonly<Record<string, string>> = {
  alpaca_sip: "tool:market-data",
  fmp: "tool:fmp",
  primary_source: "tool:primary-source",
};

export function authorizeToolInvocation(
  agent: PrincipalContext,
  toolId: string,
  _resource: unknown,
): boolean {
  const scope = toolScopeById[toolId];
  return Boolean(
    scope &&
      agent.principal.kind === "agent" &&
      agent.principal.servicePrincipalId &&
      agent.principal.manifestId &&
      agent.principal.manifestVersion &&
      agent.effectiveScopes.includes(scope),
  );
}
