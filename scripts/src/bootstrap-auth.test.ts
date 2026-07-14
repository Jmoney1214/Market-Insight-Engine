import { describe, expect, it, vi } from "vitest";
import {
  BOOTSTRAP_HUMAN_SCOPES,
  bootstrapHumanWithPool,
  parseBootstrapArgs,
  runBootstrapAuth,
  type BootstrapAuthDependencies,
} from "./bootstrap-auth.js";

const RAW_SECRET =
  "mie_bootstraptest1.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd";

function dependencies(
  overrides: Partial<BootstrapAuthDependencies> = {},
): BootstrapAuthDependencies {
  return {
    hasActiveHuman: vi.fn(async () => false),
    bootstrapHuman: vi.fn(async () => ({
      principalId: "10000000-0000-4000-8000-000000000001",
      credentialId: "10000000-0000-4000-8000-000000000002",
    })),
    newPermanentCredential: vi.fn(() => RAW_SECRET),
    newRequestId: vi.fn(() => "bootstrap-request-1"),
    writeLine: vi.fn(),
    ...overrides,
  };
}

describe("one-time human bootstrap", () => {
  it("sets the credential pepper transaction-locally before the atomic bootstrap", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            payload: {
              principal_id: "10000000-0000-4000-8000-000000000001",
              credential_id: "10000000-0000-4000-8000-000000000002",
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
    };

    const result = await bootstrapHumanWithPool(
      pool as never,
      {
        subject: "operator@example.com",
        displayName: "Desk Operator",
        scopes: BOOTSTRAP_HUMAN_SCOPES,
        rawSecret: RAW_SECRET,
        pepperVersion: "v1",
        requestId: "bootstrap-request-1",
      },
      "credential_pepper_material_for_test_v1",
    );

    expect(result).toEqual({
      principalId: "10000000-0000-4000-8000-000000000001",
      credentialId: "10000000-0000-4000-8000-000000000002",
    });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "begin",
      "select set_config($1, $2, true)",
      expect.stringContaining("governance.bootstrap_human_principal"),
      "commit",
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual([
      "mie.credential_pepper_v1",
      "credential_pepper_material_for_test_v1",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("atomically bootstraps the human and prints plaintext exactly once", async () => {
    const deps = dependencies();

    const result = await runBootstrapAuth(deps, {
      subject: "operator@example.com",
    });

    expect(deps.bootstrapHuman).toHaveBeenCalledWith({
      subject: "operator@example.com",
      displayName: "Desk Operator",
      scopes: BOOTSTRAP_HUMAN_SCOPES,
      rawSecret: RAW_SECRET,
      pepperVersion: "v1",
      requestId: "bootstrap-request-1",
    });
    expect(deps.writeLine).toHaveBeenCalledOnce();
    const output = vi.mocked(deps.writeLine).mock.calls[0]?.[0] ?? "";
    expect(output.split(RAW_SECRET)).toHaveLength(2);
    expect(output).toContain('"permanentCredential"');
    expect(JSON.stringify(result)).not.toContain(RAW_SECRET);
  });

  it("refuses a second bootstrap before generating or printing a secret", async () => {
    const deps = dependencies({ hasActiveHuman: vi.fn(async () => true) });

    await expect(
      runBootstrapAuth(deps, { subject: "operator@example.com" }),
    ).rejects.toThrow("already exists");
    expect(deps.newPermanentCredential).not.toHaveBeenCalled();
    expect(deps.bootstrapHuman).not.toHaveBeenCalled();
    expect(deps.writeLine).not.toHaveBeenCalled();
  });

  it("prints nothing when the atomic database bootstrap fails", async () => {
    const deps = dependencies({
      bootstrapHuman: vi.fn(async () => {
        throw new Error("human_bootstrap_exists");
      }),
    });

    await expect(
      runBootstrapAuth(deps, { subject: "operator@example.com" }),
    ).rejects.toThrow("already exists");
    expect(deps.writeLine).not.toHaveBeenCalled();
  });

  it("accepts only a subject argument and never accepts secrets in argv", () => {
    expect(parseBootstrapArgs(["--subject", "operator@example.com"])).toEqual({
      subject: "operator@example.com",
    });
    expect(() =>
      parseBootstrapArgs([
        "--subject",
        "operator@example.com",
        "--secret",
        RAW_SECRET,
      ]),
    ).toThrow("Unknown bootstrap argument");
  });
});
