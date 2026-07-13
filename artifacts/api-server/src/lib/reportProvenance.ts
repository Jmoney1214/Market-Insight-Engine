type PersistedReport = {
  id: number;
  source: string;
  generatedAt: Date;
  reportData: Record<string, unknown>;
};

export type PersistedReportDecision =
  | { ok: false; status: 410; code: "UNTRUSTED_LEGACY_REPORT" }
  | { ok: true; value: Record<string, unknown> };

export function serializePersistedReport(
  report: PersistedReport,
): PersistedReportDecision {
  if (report.source === "mock") {
    return { ok: false, status: 410, code: "UNTRUSTED_LEGACY_REPORT" };
  }
  return {
    ok: true,
    value: {
      ...report.reportData,
      source: report.source,
      id: report.id,
      generatedAt: report.generatedAt.toISOString(),
    },
  };
}

export function serializeReportSummary<
  T extends { source: string; generatedAt: Date },
>(report: T): (Omit<T, "generatedAt"> & { generatedAt: string }) | null {
  if (report.source === "mock") return null;
  return {
    ...report,
    generatedAt: report.generatedAt.toISOString(),
  };
}
