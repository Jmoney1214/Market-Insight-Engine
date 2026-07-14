import { describe, expect, it, vi } from "vitest";
import {
  closeControlPlanePools,
  createControlPlanePools,
  type ControlPlanePools,
  withControlPlaneTransaction,
} from "@workspace/db/control-plane";

const urls = {
  MIE_API_DATABASE_URL: "postgres://api:api@localhost:5432/mie",
  MIE_WORKER_DATABASE_URL: "postgres://worker:worker@localhost:5432/mie",
  MIE_EVAL_DATABASE_URL: "postgres://eval:eval@localhost:5432/mie",
  MIE_REVIEWER_DATABASE_URL: "postgres://reviewer:reviewer@localhost:5432/mie",
};

describe("named control-plane pools", () => {
  it("retains versioned peppers for transaction-local binding", async () => {
    const pools = createControlPlanePools({
      ...urls,
      MIE_CREDENTIAL_PEPPER_V1: "credential_pepper_material_for_test_v1",
      MIE_SESSION_PEPPER_V1: "session_pepper_material_for_test_v1_00",
    });
    try {
      expect(pools.secrets).toEqual({
        credentialPepper: "credential_pepper_material_for_test_v1",
        sessionPepper: "session_pepper_material_for_test_v1_00",
      });
    } finally {
      await closeControlPlanePools(pools);
    }
  });

  it("sets both peppers locally before verified request context", async () => {
    const query = vi.fn(async (_sql: string, _values?: readonly unknown[]) => ({
      rows: [],
    }));
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
      end: vi.fn(async () => undefined),
    };
    const pools = {
      api: pool,
      worker: pool,
      evaluator: pool,
      reviewer: pool,
      secrets: {
        credentialPepper: "credential_pepper_material_for_test_v1",
        sessionPepper: "session_pepper_material_for_test_v1_00",
      },
    } as unknown as ControlPlanePools;

    await withControlPlaneTransaction(
      pools,
      "api",
      { requestId: "request-1" },
      async (client) => client.query("select 1"),
    );

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "begin",
      expect.stringContaining("mie.credential_pepper_v1"),
      expect.stringContaining("mie.request_id"),
      "select 1",
      "commit",
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual([
      "credential_pepper_material_for_test_v1",
      "session_pepper_material_for_test_v1_00",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("refuses to create pools without every URL and both strong peppers", () => {
    expect(() => createControlPlanePools({ ...urls })).toThrow(
      "MIE_CREDENTIAL_PEPPER_V1",
    );
    expect(() =>
      createControlPlanePools({
        ...urls,
        MIE_CREDENTIAL_PEPPER_V1: "short",
        MIE_SESSION_PEPPER_V1: "session_pepper_material_for_test_v1_00",
      }),
    ).toThrow("at least 32 URL-safe characters");
  });
});
