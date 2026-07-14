import { Router, type IRouter } from "express";
import {
  ExplainCopilotEventQueryParams,
  ExplainCopilotEventResponse,
} from "@workspace/api-zod";
import { buildCopilotEvent } from "@workspace/copilot-core/runtime";
import { buildEventWithValidation } from "../../lib/validationResolver.js";
import { runCommittee } from "@workspace/copilot-committee";
import { committeeResultToApiRead } from "../../lib/committeeRead.js";
import { getCommitteeProvider } from "../../lib/committeeProvider.js";
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

router.get("/explain", async (req, res) => {
  const parsed = ExplainCopilotEventQueryParams.safeParse(req.query);
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

  // null when the OpenAI integration is not configured -> deterministic read.
  const provider = getCommitteeProvider();
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
    const result = await runCommittee(core, provider);
    res.json(ExplainCopilotEventResponse.parse(committeeResultToApiRead(result, {
      provenanceMode: policy.provenanceMode,
      ...(policy.source === "fixture"
        ? {
            caseRevisionId: policy.caseRevisionId,
            evidenceHash: policy.evidenceHash,
          }
        : {}),
    })));
  } catch (err) {
    if (err instanceof BrainUnavailableError) {
      res.status(503).json({
        error: err.message,
        code: "BRAIN_UNAVAILABLE",
      });
      return;
    }
    if (err instanceof CopilotDataError) {
      // Explain a deterministic DATA_FAILURE event so consumers always get a
      // canonical, safe committee read even when the upstream feed is down.
      req.log.warn(
        { reason: err.message, symbol: symbolUpper },
        "Live copilot data fetch failed; explaining DATA_FAILURE event",
      );
      const core = buildCopilotEvent({
        symbol: symbolUpper,
        mode: "LIVE",
        dataSource: ALPACA_SOURCE,
        bars: [],
        quote: null,
      });
      const result = await runCommittee(core, provider);
      res.json(ExplainCopilotEventResponse.parse(committeeResultToApiRead(result, {
        provenanceMode: policy.provenanceMode,
      })));
      return;
    }
    req.log.error({ err }, "Unexpected error explaining copilot event");
    res.status(500).json({ error: "Could not explain copilot event." });
  }
});

export default router;
