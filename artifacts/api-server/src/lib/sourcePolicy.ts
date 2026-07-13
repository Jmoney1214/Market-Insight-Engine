export type SourcePolicyInput = {
  mode: "LIVE" | "REPLAY" | "RESEARCH";
  source: "fixture" | "yahoo_delayed" | "alpaca_live" | undefined;
  canReplay: boolean;
  caseRevisionId?: string;
  evidenceHash?: string;
};

export type SourcePolicyDecision =
  | { ok: true; source: "alpaca_live"; provenanceMode: "LIVE_SIP" }
  | {
      ok: true;
      source: "fixture";
      provenanceMode: "HISTORICAL_FIXTURE";
      caseRevisionId: string;
      evidenceHash: string;
    }
  | {
      ok: false;
      status: 400 | 403;
      code: "LIVE_SOURCE_REQUIRED" | "REPLAY_SCOPE_REQUIRED" | "CANONICAL_CASE_REQUIRED";
    };

export function resolveSourcePolicy(input: SourcePolicyInput): SourcePolicyDecision {
  const source = input.source ?? (input.mode === "LIVE" ? "alpaca_live" : "fixture");
  if (input.mode === "LIVE") {
    return source === "alpaca_live"
      ? { ok: true, source, provenanceMode: "LIVE_SIP" }
      : { ok: false, status: 400, code: "LIVE_SOURCE_REQUIRED" };
  }
  if (source !== "fixture") return { ok: false, status: 400, code: "LIVE_SOURCE_REQUIRED" };
  if (!input.canReplay) return { ok: false, status: 403, code: "REPLAY_SCOPE_REQUIRED" };
  if (!input.caseRevisionId || !input.evidenceHash) {
    return { ok: false, status: 400, code: "CANONICAL_CASE_REQUIRED" };
  }
  return {
    ok: true,
    source,
    provenanceMode: "HISTORICAL_FIXTURE",
    caseRevisionId: input.caseRevisionId,
    evidenceHash: input.evidenceHash,
  };
}

export function hasTrustedEventProvenance(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const event = snapshot as Record<string, unknown>;
  if (event.mode === "LIVE") {
    return event.dataSource === "alpaca_live" && event.provenanceMode === "LIVE_SIP";
  }
  return (
    (event.mode === "REPLAY" || event.mode === "RESEARCH") &&
    event.dataSource === "fixture" &&
    event.provenanceMode === "HISTORICAL_FIXTURE" &&
    typeof event.caseRevisionId === "string" &&
    event.caseRevisionId.trim().length > 0 &&
    typeof event.evidenceHash === "string" &&
    event.evidenceHash.trim().length > 0
  );
}
