import { describe, expect, it } from "vitest";
import {
  closeControlPlanePools,
  createControlPlanePools,
} from "@workspace/db/control-plane";

const urls = {
  MIE_API_DATABASE_URL: "postgres://api:api@localhost:5432/mie",
  MIE_WORKER_DATABASE_URL: "postgres://worker:worker@localhost:5432/mie",
  MIE_EVAL_DATABASE_URL: "postgres://eval:eval@localhost:5432/mie",
  MIE_REVIEWER_DATABASE_URL: "postgres://reviewer:reviewer@localhost:5432/mie",
};

describe("named control-plane pools", () => {
  it("installs versioned credential and session peppers on every connection", async () => {
    const pools = createControlPlanePools({
      ...urls,
      MIE_CREDENTIAL_PEPPER_V1: "credential_pepper_material_for_test_v1",
      MIE_SESSION_PEPPER_V1: "session_pepper_material_for_test_v1_00",
    });
    try {
      for (const pool of Object.values(pools)) {
        const options = (
          pool as unknown as { options: { options: string } }
        ).options.options;
        expect(options).toContain("mie.credential_pepper_v1=");
        expect(options).toContain("mie.session_pepper_v1=");
      }
    } finally {
      await closeControlPlanePools(pools);
    }
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
