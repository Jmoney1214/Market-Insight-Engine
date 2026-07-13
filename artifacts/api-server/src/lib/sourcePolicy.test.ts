import { describe, expect, it } from "vitest";
import {
  hasTrustedEventProvenance,
  resolveSourcePolicy,
} from "./sourcePolicy.js";

describe("resolveSourcePolicy", () => {
  it("defaults omitted live source to Alpaca SIP", () => {
    expect(resolveSourcePolicy({ mode: "LIVE", source: undefined, canReplay: false })).toEqual({
      ok: true,
      source: "alpaca_live",
      provenanceMode: "LIVE_SIP",
    });
  });

  it("rejects fixture data in LIVE mode", () => {
    expect(resolveSourcePolicy({ mode: "LIVE", source: "fixture", canReplay: true })).toMatchObject({
      ok: false,
      code: "LIVE_SOURCE_REQUIRED",
    });
  });

  it("permits historical fixtures only with replay scope", () => {
    expect(resolveSourcePolicy({
      mode: "REPLAY",
      source: "fixture",
      canReplay: true,
      caseRevisionId: "case-revision-1",
      evidenceHash: "sha256:historical-evidence",
    })).toMatchObject({
      ok: true,
      provenanceMode: "HISTORICAL_FIXTURE",
      caseRevisionId: "case-revision-1",
    });
  });

  it("rejects an unversioned repository fixture as historical truth", () => {
    expect(resolveSourcePolicy({ mode: "RESEARCH", source: "fixture", canReplay: true })).toMatchObject({
      ok: false,
      code: "CANONICAL_CASE_REQUIRED",
    });
  });

  it.each([false, true])("covers every LIVE source with canReplay=%s", (canReplay) => {
    expect(resolveSourcePolicy({ mode: "LIVE", source: undefined, canReplay })).toEqual({
      ok: true,
      source: "alpaca_live",
      provenanceMode: "LIVE_SIP",
    });
    expect(resolveSourcePolicy({ mode: "LIVE", source: "alpaca_live", canReplay })).toEqual({
      ok: true,
      source: "alpaca_live",
      provenanceMode: "LIVE_SIP",
    });
    for (const source of ["fixture", "yahoo_delayed"] as const) {
      expect(resolveSourcePolicy({ mode: "LIVE", source, canReplay })).toEqual({
        ok: false,
        status: 400,
        code: "LIVE_SOURCE_REQUIRED",
      });
    }
  });

  it.each(["REPLAY", "RESEARCH"] as const)(
    "covers every historical source and scope combination in %s mode",
    (mode) => {
      for (const source of [undefined, "fixture"] as const) {
        expect(resolveSourcePolicy({ mode, source, canReplay: false })).toEqual({
          ok: false,
          status: 403,
          code: "REPLAY_SCOPE_REQUIRED",
        });
        expect(resolveSourcePolicy({
          mode,
          source,
          canReplay: true,
          caseRevisionId: "case-revision-1",
          evidenceHash: "sha256:historical-evidence",
        })).toEqual({
          ok: true,
          source: "fixture",
          provenanceMode: "HISTORICAL_FIXTURE",
          caseRevisionId: "case-revision-1",
          evidenceHash: "sha256:historical-evidence",
        });
      }
      for (const source of ["alpaca_live", "yahoo_delayed"] as const) {
        for (const canReplay of [false, true]) {
          expect(resolveSourcePolicy({ mode, source, canReplay })).toEqual({
            ok: false,
            status: 400,
            code: "LIVE_SOURCE_REQUIRED",
          });
        }
      }
    },
  );

  it.each(["REPLAY", "RESEARCH"] as const)(
    "requires both canonical case fields in %s mode",
    (mode) => {
      expect(resolveSourcePolicy({
        mode,
        source: "fixture",
        canReplay: true,
        caseRevisionId: "case-revision-1",
      })).toEqual({ ok: false, status: 400, code: "CANONICAL_CASE_REQUIRED" });
      expect(resolveSourcePolicy({
        mode,
        source: "fixture",
        canReplay: true,
        evidenceHash: "sha256:historical-evidence",
      })).toEqual({ ok: false, status: 400, code: "CANONICAL_CASE_REQUIRED" });
    },
  );
});

describe("hasTrustedEventProvenance", () => {
  it("accepts only Alpaca-backed LIVE snapshots", () => {
    expect(hasTrustedEventProvenance({
      mode: "LIVE",
      dataSource: "alpaca_live",
      provenanceMode: "LIVE_SIP",
    })).toBe(true);
    expect(hasTrustedEventProvenance({
      mode: "LIVE",
      dataSource: "fixture",
      provenanceMode: "LIVE_SIP",
    })).toBe(false);
  });

  it("requires canonical case and evidence fields for historical snapshots", () => {
    expect(hasTrustedEventProvenance({
      mode: "REPLAY",
      dataSource: "fixture",
      provenanceMode: "HISTORICAL_FIXTURE",
      caseRevisionId: "case-revision-1",
      evidenceHash: "sha256:evidence",
    })).toBe(true);
    expect(hasTrustedEventProvenance({
      mode: "RESEARCH",
      dataSource: "fixture",
      provenanceMode: "HISTORICAL_FIXTURE",
    })).toBe(false);
  });

  it("rejects unmarked legacy snapshots", () => {
    expect(hasTrustedEventProvenance({ mode: "LIVE", dataSource: "fixture" })).toBe(false);
    expect(hasTrustedEventProvenance(null)).toBe(false);
  });
});
