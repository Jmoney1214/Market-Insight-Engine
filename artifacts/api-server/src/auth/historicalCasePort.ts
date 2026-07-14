import type { BuildEventInput } from "@workspace/copilot-core/runtime";
import type { PrincipalContext } from "./types.js";

export type HistoricalSession = Readonly<{
  symbol: string;
  date: string;
  availableDates: readonly string[];
  dataSource: string;
  totalSteps: number;
  barSeconds: number;
  startTime: number;
  endTime: number;
}>;

export type HistoricalCase = Readonly<{
  caseRevisionId: string;
  evidenceHash: string;
  session: HistoricalSession;
  input: BuildEventInput;
}>;

export type HistoricalCaseRequest = Readonly<{
  caseRevisionId: string;
  evidenceHash: string;
  symbol: string;
  date?: string;
  step?: number;
}>;

export interface HistoricalCasePort {
  resolveReplayCase(
    request: HistoricalCaseRequest,
    principal: PrincipalContext,
  ): Promise<HistoricalCase | null>;
}

export function isExactHistoricalCase(
  historicalCase: HistoricalCase,
  request: HistoricalCaseRequest,
  expectedMode: "REPLAY" | "RESEARCH",
): boolean {
  const requestedSymbol = request.symbol.toUpperCase();
  const session = historicalCase.session;
  const input = historicalCase.input;
  return (
    historicalCase.caseRevisionId === request.caseRevisionId &&
    historicalCase.evidenceHash === request.evidenceHash &&
    session.symbol.toUpperCase() === requestedSymbol &&
    input.symbol.toUpperCase() === requestedSymbol &&
    input.mode === expectedMode &&
    session.dataSource === "fixture" &&
    input.dataSource === "fixture" &&
    Number.isInteger(session.totalSteps) &&
    session.totalSteps > 0 &&
    session.startTime <= session.endTime &&
    session.availableDates.includes(session.date) &&
    (request.date === undefined || session.date === request.date) &&
    (request.step === undefined ||
      (Number.isInteger(request.step) &&
        request.step >= 0 &&
        request.step < session.totalSteps &&
        input.bars.length === request.step + 1))
  );
}

export class BrainUnavailableError extends Error {
  constructor() {
    super("Canonical historical brain is unavailable");
    this.name = "BrainUnavailableError";
  }
}

export const unavailableHistoricalCasePort: HistoricalCasePort = {
  async resolveReplayCase() {
    throw new BrainUnavailableError();
  },
};
