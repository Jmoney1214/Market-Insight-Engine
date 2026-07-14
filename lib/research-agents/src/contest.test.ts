import { describe, it, expect } from "vitest";
import { catalystFixture } from "@workspace/research-contracts";
import { resolveContest } from "./contest";

const NOW = "2026-07-13T09:15:00-04:00";

describe("resolveContest", () => {
  it("full agreement passes the primary record through untouched", () => {
    const primary = catalystFixture();
    const secondary = { ...catalystFixture(), catalystId: "cat_02" };
    const result = resolveContest({ primary, secondary, now: NOW, conflictIdPrefix: "cfl_t1" });
    expect(result.agreed).toBe(true);
    expect(result.record).toBe(primary);
    expect(result.conflicts).toEqual([]);
  });

  it("disagreement emits Conflict records and marks CONFLICTED — never averaged", () => {
    const primary = catalystFixture();
    const secondary = {
      ...catalystFixture(),
      catalystId: "cat_02",
      verificationStatus: "PARTIALLY_CONFIRMED" as const,
      materiality: "NOT_MATERIAL" as const,
    };
    const result = resolveContest({ primary, secondary, now: NOW, conflictIdPrefix: "cfl_t2" });
    expect(result.agreed).toBe(false);
    expect(result.record.verificationStatus).toBe("CONFLICTED");
    expect(result.disagreeingFields).toEqual(["verificationStatus", "materiality"]);
    expect(result.conflicts).toHaveLength(2);
    for (const conflict of result.conflicts) {
      expect(conflict.resolutionStatus).toBe("UNRESOLVED");
      expect(conflict.preferredValue).toBeNull(); // no silent reconciliation
      expect(conflict.values).toHaveLength(2);
    }
    expect(result.record.conflictIds).toEqual(["cfl_t2_1", "cfl_t2_2"]);
  });

  it("null vs value timestamps count as disagreement", () => {
    const primary = catalystFixture();
    const secondary = { ...catalystFixture(), catalystId: "cat_02", eventTime: null };
    const result = resolveContest({ primary, secondary, now: NOW, conflictIdPrefix: "cfl_t3" });
    expect(result.disagreeingFields).toEqual(["eventTime"]);
  });

  it("refuses to contest two different symbols", () => {
    const primary = catalystFixture();
    const secondary = { ...catalystFixture(), symbol: "TSLA" };
    expect(() => resolveContest({ primary, secondary, now: NOW, conflictIdPrefix: "x" })).toThrow();
  });
});
