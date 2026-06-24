import { Router, type IRouter } from "express";
import {
  GetCopilotEventQueryParams,
  GetCopilotEventResponse,
} from "@workspace/api-zod";
import { buildCopilotEvent } from "@workspace/copilot-core";
import { coreEventToApiEvent } from "../../lib/copilotEvent.js";
import {
  CopilotDataError,
  INTRADAY_SOURCE,
  fetchIntradayInput,
  loadFixtureInput,
} from "../../lib/copilotData.js";

const router: IRouter = Router();

router.get("/event", async (req, res) => {
  const parsed = GetCopilotEventQueryParams.safeParse(req.query);
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

  if (source === "fixture") {
    const input = loadFixtureInput(symbolUpper);
    if (!input) {
      res.status(404).json({ error: `No fixture found for "${symbolUpper}".` });
      return;
    }
    const core = buildCopilotEvent(mode ? { ...input, mode } : input);
    res.json(GetCopilotEventResponse.parse(coreEventToApiEvent(core)));
    return;
  }

  // Delayed live source (labeled yahoo_delayed).
  try {
    const input = await fetchIntradayInput(symbolUpper, mode ?? "LIVE");
    const core = buildCopilotEvent(input);
    res.json(GetCopilotEventResponse.parse(coreEventToApiEvent(core)));
  } catch (err) {
    if (err instanceof CopilotDataError) {
      // Surface a deterministic DATA_FAILURE L5 event so consumers always get a
      // canonical, safe event even when the upstream feed is unavailable.
      req.log.warn(
        { reason: err.message, symbol: symbolUpper },
        "Live copilot data fetch failed; emitting DATA_FAILURE event",
      );
      const core = buildCopilotEvent({
        symbol: symbolUpper,
        mode: mode ?? "LIVE",
        dataSource: INTRADAY_SOURCE,
        bars: [],
        quote: null,
      });
      res.json(GetCopilotEventResponse.parse(coreEventToApiEvent(core)));
      return;
    }
    req.log.error({ err }, "Unexpected error building copilot event");
    res.status(500).json({ error: "Could not build copilot event." });
  }
});

export default router;
