import { Router, type IRouter } from "express";
import {
  GetCopilotEventQueryParams,
  GetCopilotEventResponse,
} from "@workspace/api-zod";
import { buildCopilotEvent } from "@workspace/copilot-core/runtime";
import { buildEventWithValidation } from "../../lib/validationResolver.js";
import { coreEventToApiEvent } from "../../lib/copilotEvent.js";
import { recordHistory } from "../../lib/history.js";
import { CopilotDataError } from "../../lib/copilotData.js";
import {
  ALPACA_SOURCE,
  fetchAlpacaIntradayInput,
} from "../../lib/alpacaData.js";
import { resolveSourcePolicy } from "../../lib/sourcePolicy.js";
import {
  BrainUnavailableError,
  isExactHistoricalCase,
} from "../../auth/historicalCasePort.js";
import type { AuthRuntime } from "../../auth/types.js";

const router: IRouter = Router();

router.get("/event", async (req, res) => {
  const parsed = GetCopilotEventQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: symbol is required" });
    return;
  }

  const { symbol, mode } = parsed.data;
  const source = typeof req.query.source === "string" ? parsed.data.source : undefined;
  const requestedMode = mode ?? "LIVE";
  const caseRevisionId = typeof req.query.caseRevisionId === "string"
    ? req.query.caseRevisionId
    : undefined;
  const evidenceHash = typeof req.query.evidenceHash === "string"
    ? req.query.evidenceHash
    : undefined;
  const symbolUpper = symbol.toUpperCase().trim();
  // Permissive enough for real Yahoo symbols: BRK-B, BTC-USD, ^GSPC, ES=F, 7203.T
  if (!symbolUpper || !/^[A-Z0-9.\-=^]{1,12}$/.test(symbolUpper)) {
    res.status(400).json({ error: "Invalid symbol" });
    return;
  }

  const policy = resolveSourcePolicy({
    mode: requestedMode,
    source,
    canReplay: req.auth?.effectiveScopes.includes("replay:read") ?? false,
    ...(caseRevisionId ? { caseRevisionId } : {}),
    ...(evidenceHash ? { evidenceHash } : {}),
  });
  if (!policy.ok) {
    res.status(policy.status).json({ error: policy.code, code: policy.code });
    return;
  }

  try {
    const input = policy.source === "alpaca_live"
      ? await fetchAlpacaIntradayInput(symbolUpper, "LIVE")
      : await (async () => {
          const runtime = req.app.locals["authRuntime"] as AuthRuntime;
          const historicalRequest = {
            caseRevisionId: policy.caseRevisionId,
            evidenceHash: policy.evidenceHash,
            symbol: symbolUpper,
          } as const;
          const historicalCase = await runtime.historicalCasePort.resolveReplayCase(
            historicalRequest,
            req.auth!,
          );
          if (!historicalCase) {
            res.status(404).json({
              error: "Canonical historical case was not found",
              code: "CANONICAL_CASE_NOT_FOUND",
            });
            return null;
          }
          if (
            requestedMode === "LIVE" ||
            !isExactHistoricalCase(historicalCase, historicalRequest, requestedMode)
          ) {
            res.status(503).json({
              error: "Canonical historical case failed integrity checks",
              code: "BRAIN_INTEGRITY_FAILURE",
            });
            return null;
          }
          return historicalCase.input;
        })();
    if (!input) return;
    const core = policy.source === "fixture"
      ? buildCopilotEvent(input)
      : await buildEventWithValidation(input);
    const apiEvent = GetCopilotEventResponse.parse(coreEventToApiEvent(core, {
      provenanceMode: policy.provenanceMode,
      ...(policy.source === "fixture"
        ? {
            caseRevisionId: policy.caseRevisionId,
            evidenceHash: policy.evidenceHash,
          }
        : {}),
    }));
    await recordHistory(apiEvent, req.log);
    res.json(apiEvent);
  } catch (err) {
    if (err instanceof BrainUnavailableError) {
      res.status(503).json({
        error: err.message,
        code: "BRAIN_UNAVAILABLE",
      });
      return;
    }
    if (err instanceof CopilotDataError) {
      // Surface a deterministic DATA_FAILURE L5 event so consumers always get a
      // canonical, safe event even when the upstream feed is unavailable.
      req.log.warn(
        { reason: err.message, symbol: symbolUpper },
        "Live copilot data fetch failed; emitting DATA_FAILURE event",
      );
      const core = buildCopilotEvent({
        symbol: symbolUpper,
        mode: "LIVE",
        dataSource: ALPACA_SOURCE,
        bars: [],
        quote: null,
      });
      const apiEvent = GetCopilotEventResponse.parse(coreEventToApiEvent(core, {
        provenanceMode: policy.provenanceMode,
      }));
      await recordHistory(apiEvent, req.log);
      res.json(apiEvent);
      return;
    }
    req.log.error({ err }, "Unexpected error building copilot event");
    res.status(500).json({ error: "Could not build copilot event." });
  }
});

export default router;
