import { Router, type IRouter } from "express";
import {
  ExplainCopilotEventQueryParams,
  ExplainCopilotEventResponse,
} from "@workspace/api-zod";
import { buildCopilotEvent } from "@workspace/copilot-core";
import { runCommittee } from "@workspace/copilot-committee";
import { committeeResultToApiRead } from "../../lib/committeeRead.js";
import { getCommitteeProvider } from "../../lib/committeeProvider.js";
import {
  CopilotDataError,
  INTRADAY_SOURCE,
  fetchIntradayInput,
  loadFixtureInput,
} from "../../lib/copilotData.js";

const router: IRouter = Router();

router.get("/explain", async (req, res) => {
  const parsed = ExplainCopilotEventQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: symbol is required" });
    return;
  }

  const { symbol, source, mode } = parsed.data;
  const symbolUpper = symbol.toUpperCase().trim();
  if (!symbolUpper || !/^[A-Z.\-]{1,6}$/.test(symbolUpper)) {
    res.status(400).json({ error: "Invalid symbol" });
    return;
  }

  // null when the OpenAI integration is not configured -> deterministic read.
  const provider = getCommitteeProvider();

  if (source === "fixture") {
    const input = loadFixtureInput(symbolUpper);
    if (!input) {
      res.status(404).json({ error: `No fixture found for "${symbolUpper}".` });
      return;
    }
    const core = buildCopilotEvent(mode ? { ...input, mode } : input);
    const result = await runCommittee(core, provider);
    res.json(ExplainCopilotEventResponse.parse(committeeResultToApiRead(result)));
    return;
  }

  // Delayed live source (labeled yahoo_delayed).
  try {
    const input = await fetchIntradayInput(symbolUpper, mode ?? "LIVE");
    const core = buildCopilotEvent(input);
    const result = await runCommittee(core, provider);
    res.json(ExplainCopilotEventResponse.parse(committeeResultToApiRead(result)));
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
        mode: mode ?? "LIVE",
        dataSource: INTRADAY_SOURCE,
        bars: [],
        quote: null,
      });
      const result = await runCommittee(core, provider);
      res.json(ExplainCopilotEventResponse.parse(committeeResultToApiRead(result)));
      return;
    }
    req.log.error({ err }, "Unexpected error explaining copilot event");
    res.status(500).json({ error: "Could not explain copilot event." });
  }
});

export default router;
