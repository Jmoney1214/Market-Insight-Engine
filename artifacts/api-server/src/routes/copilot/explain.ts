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
  const symbolUpper = symbol.toUpperCase().trim();
  // Permissive enough for real Yahoo symbols: BRK-B, BTC-USD, ^GSPC, ES=F, 7203.T
  if (!symbolUpper || !/^[A-Z0-9.\-=^]{1,12}$/.test(symbolUpper)) {
    res.status(400).json({ error: "Invalid symbol" });
    return;
  }

  if (requestedMode !== "LIVE" || source === "fixture") {
    res.status(503).json({
      error: "Historical brain access is unavailable until verified replay authorization is installed.",
      code: "BRAIN_AUTH_NOT_READY",
    });
    return;
  }

  const policy = resolveSourcePolicy({
    mode: "LIVE",
    source,
    canReplay: false,
  });
  if (!policy.ok) {
    res.status(policy.status).json({ error: policy.code, code: policy.code });
    return;
  }

  // null when the OpenAI integration is not configured -> deterministic read.
  const provider = getCommitteeProvider();
  try {
    const input = await fetchAlpacaIntradayInput(symbolUpper, "LIVE");
    const core = await buildEventWithValidation(input);
    const result = await runCommittee(core, provider);
    res.json(ExplainCopilotEventResponse.parse(committeeResultToApiRead(result, {
      provenanceMode: policy.provenanceMode,
    })));
  } catch (err) {
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
