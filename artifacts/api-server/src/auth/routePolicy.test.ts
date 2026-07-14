import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  allRoutePolicies,
  resolveRoutePolicy,
  routePolicyRegistry,
} from "./routePolicy.js";
import router from "../routes/index.js";

type ExpressLayer = {
  route?: { methods?: Record<string, boolean> };
  handle?: { stack?: ExpressLayer[] };
  slash?: boolean;
  matchers?: Array<(
    path: string,
  ) => false | { path: string; params: Record<string, string> }>;
};

function registeredInExpress(
  layers: readonly ExpressLayer[],
  method: string,
  path: string,
): boolean {
  for (const layer of layers) {
    const matches = layer.matchers ?? [];
    if (layer.route) {
      if (
        layer.route.methods?.[method.toLowerCase()] &&
        matches.some((matcher) => matcher(path) !== false)
      ) {
        return true;
      }
      continue;
    }
    if (!layer.handle?.stack) continue;
    if (
      layer.slash &&
      registeredInExpress(layer.handle.stack, method, path)
    ) {
      return true;
    }
    for (const matcher of matches) {
      const match = matcher(path);
      if (!match) continue;
      const remainder = path.slice(match.path.length) || "/";
      if (registeredInExpress(layer.handle.stack, method, remainder)) {
        return true;
      }
    }
  }
  return false;
}

function openApiOperations(): Array<{
  operationId: string;
  method: string;
  path: string;
}> {
  const source = readFileSync(
    new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url),
    "utf8",
  );
  const operations: Array<{ operationId: string; method: string; path: string }> = [];
  let path = "";
  let method = "";
  for (const line of source.split("\n")) {
    const pathMatch = /^  (\/[^:]+):$/.exec(line);
    if (pathMatch) {
      path = pathMatch[1] ?? "";
      method = "";
      continue;
    }
    const methodMatch = /^    (get|post|put|patch|delete):$/.exec(line);
    if (methodMatch) {
      method = (methodMatch[1] ?? "").toUpperCase();
      continue;
    }
    const operationMatch = /^      operationId: ([A-Za-z0-9_-]+)$/.exec(line);
    if (operationMatch && path && method) {
      operations.push({
        operationId: operationMatch[1] ?? "",
        method,
        path: path.replaceAll(/\{([^}]+)\}/g, ":$1"),
      });
    }
  }
  return operations;
}

describe("routePolicyRegistry", () => {
  it("classifies every OpenAPI operation exactly once", () => {
    const expected = allRoutePolicies()
      .map(({ operationId, method, path }) => ({ operationId, method, path }))
      .sort((left, right) => left.operationId.localeCompare(right.operationId));
    const actual = openApiOperations().sort((left, right) =>
      left.operationId.localeCompare(right.operationId),
    );

    expect(actual).toEqual(expected);
    expect(new Set(actual.map(({ operationId }) => operationId)).size).toBe(
      actual.length,
    );
  });

  it("matches every policy to an actual Express route registration", () => {
    const layers = (router as unknown as { stack: ExpressLayer[] }).stack;
    for (const policy of allRoutePolicies()) {
      const concretePath = policy.path.replaceAll(/:[^/]+/g, "sample");
      expect(
        registeredInExpress(layers, policy.method, concretePath),
        `${policy.method} ${policy.path} is not registered in Express`,
      ).toBe(true);
    }
  });

  it("has only two public operations", () => {
    expect(
      allRoutePolicies()
        .filter((policy) => policy.auth === "public")
        .map((policy) => policy.operationId)
        .sort(),
    ).toEqual(["copilotHealthCheck", "healthCheck"]);
  });

  it("resolves every registry method/path and fails closed on unknown routes", () => {
    for (const policy of allRoutePolicies()) {
      const concretePath = policy.path.replaceAll(/:[^/]+/g, "sample");
      const resolved = resolveRoutePolicy({
        method: policy.method,
        path: concretePath,
      } as never);
      expect(resolved?.operationId).toBe(policy.operationId);
    }
    expect(
      resolveRoutePolicy({ method: "GET", path: "/unclassified" } as never),
    ).toBeNull();
  });

  it("requires idempotency for every existing mutation and quota-writing read", () => {
    expect(routePolicyRegistry.analyzeTicker.idempotency).toBe("required");
    expect(routePolicyRegistry.getPremarketScan.idempotency).toBe("required");
    expect(routePolicyRegistry.getCopilotEvent.idempotency).toBe("required");
    expect(routePolicyRegistry.explainCopilotEvent.idempotency).toBe("required");
    expect(routePolicyRegistry.addToWatchlist.idempotency).toBe("required");
    expect(routePolicyRegistry.createJournalEntry.idempotency).toBe("required");
  });
});
