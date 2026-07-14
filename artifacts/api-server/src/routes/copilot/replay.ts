import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  ExplainReplayEventQueryParams,
  ExplainReplayEventResponse,
  GetReplayEventQueryParams,
  GetReplayEventResponse,
  GetReplaySessionQueryParams,
  GetReplaySessionResponse,
} from "@workspace/api-zod";
import { runCommittee } from "@workspace/copilot-committee";
import { buildCopilotEvent } from "@workspace/copilot-core/runtime";
import { coreEventToApiEvent } from "../../lib/copilotEvent.js";
import { committeeResultToApiRead } from "../../lib/committeeRead.js";
import { getCommitteeProvider } from "../../lib/committeeProvider.js";
import {
  BrainUnavailableError,
  isExactHistoricalCase,
  type HistoricalCase,
  type HistoricalCaseRequest,
} from "../../auth/historicalCasePort.js";
import type { AuthRuntime } from "../../auth/types.js";

const router: IRouter = Router();
const SYMBOL_RE = /^[A-Z0-9.\-=^]{1,12}$/;

function normalizeSymbol(symbol: string): string | null {
  const upper = symbol.toUpperCase().trim();
  return upper && SYMBOL_RE.test(upper) ? upper : null;
}

class HistoricalRouteError extends Error {
  constructor(
    readonly status: 404 | 503,
    readonly code: "CANONICAL_CASE_NOT_FOUND" | "BRAIN_INTEGRITY_FAILURE",
    message: string,
  ) {
    super(message);
    this.name = "HistoricalRouteError";
  }
}

async function resolveExactReplayCase(
  req: Request,
  request: HistoricalCaseRequest,
): Promise<HistoricalCase> {
  const runtime = req.app.locals["authRuntime"] as AuthRuntime;
  const historicalCase = await runtime.historicalCasePort.resolveReplayCase(
    request,
    req.auth!,
  );
  if (!historicalCase) {
    throw new HistoricalRouteError(
      404,
      "CANONICAL_CASE_NOT_FOUND",
      "Canonical historical case was not found",
    );
  }
  if (!isExactHistoricalCase(historicalCase, request, "REPLAY")) {
    throw new HistoricalRouteError(
      503,
      "BRAIN_INTEGRITY_FAILURE",
      "Canonical historical case failed integrity checks",
    );
  }
  return historicalCase;
}

function sendHistoricalError(
  req: Request,
  res: Response,
  error: unknown,
): void {
  if (error instanceof BrainUnavailableError) {
    res.status(503).json({ error: error.message, code: "BRAIN_UNAVAILABLE" });
    return;
  }
  if (error instanceof HistoricalRouteError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  req.log.error({ err: error }, "Historical replay request failed");
  res.status(500).json({
    error: "Historical replay request failed",
    code: "INTERNAL_ERROR",
  });
}

// Replay reads only through the injected canonical-brain port. This module does
// not import bundled fixtures and has no repository-file fallback.
router.get("/replay/session", async (req, res) => {
  const parsed = GetReplaySessionQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "symbol, caseRevisionId and evidenceHash are required",
      code: "INVALID_REQUEST",
    });
    return;
  }
  const symbol = normalizeSymbol(parsed.data.symbol);
  if (!symbol) {
    res.status(400).json({ error: "Invalid symbol", code: "INVALID_REQUEST" });
    return;
  }
  try {
    const historicalCase = await resolveExactReplayCase(req, {
      symbol,
      caseRevisionId: parsed.data.caseRevisionId,
      evidenceHash: parsed.data.evidenceHash,
      ...(parsed.data.date ? { date: parsed.data.date } : {}),
    });
    res.json(GetReplaySessionResponse.parse({
      ...historicalCase.session,
      caseRevisionId: historicalCase.caseRevisionId,
      evidenceHash: historicalCase.evidenceHash,
    }));
  } catch (error) {
    sendHistoricalError(req, res, error);
  }
});

router.get("/replay/event", async (req, res) => {
  const parsed = GetReplayEventQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "symbol, date, step, caseRevisionId and evidenceHash are required",
      code: "INVALID_REQUEST",
    });
    return;
  }
  const symbol = normalizeSymbol(parsed.data.symbol);
  if (!symbol) {
    res.status(400).json({ error: "Invalid symbol", code: "INVALID_REQUEST" });
    return;
  }
  try {
    const historicalCase = await resolveExactReplayCase(req, {
      symbol,
      date: parsed.data.date,
      step: parsed.data.step,
      caseRevisionId: parsed.data.caseRevisionId,
      evidenceHash: parsed.data.evidenceHash,
    });
    const core = buildCopilotEvent(historicalCase.input);
    res.json(
      GetReplayEventResponse.parse(
        coreEventToApiEvent(core, {
          provenanceMode: "HISTORICAL_FIXTURE",
          caseRevisionId: historicalCase.caseRevisionId,
          evidenceHash: historicalCase.evidenceHash,
        }),
      ),
    );
  } catch (error) {
    sendHistoricalError(req, res, error);
  }
});

router.get("/replay/explain", async (req, res) => {
  const parsed = ExplainReplayEventQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "symbol, date, step, caseRevisionId and evidenceHash are required",
      code: "INVALID_REQUEST",
    });
    return;
  }
  const symbol = normalizeSymbol(parsed.data.symbol);
  if (!symbol) {
    res.status(400).json({ error: "Invalid symbol", code: "INVALID_REQUEST" });
    return;
  }
  try {
    const historicalCase = await resolveExactReplayCase(req, {
      symbol,
      date: parsed.data.date,
      step: parsed.data.step,
      caseRevisionId: parsed.data.caseRevisionId,
      evidenceHash: parsed.data.evidenceHash,
    });
    const core = buildCopilotEvent(historicalCase.input);
    const result = await runCommittee(core, getCommitteeProvider());
    res.json(
      ExplainReplayEventResponse.parse(
        committeeResultToApiRead(result, {
          provenanceMode: "HISTORICAL_FIXTURE",
          caseRevisionId: historicalCase.caseRevisionId,
          evidenceHash: historicalCase.evidenceHash,
        }),
      ),
    );
  } catch (error) {
    sendHistoricalError(req, res, error);
  }
});

export default router;
