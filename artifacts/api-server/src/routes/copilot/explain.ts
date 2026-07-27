import { Router, type IRouter } from "express";
import {
  ExplainCopilotEventQueryParams,
  ExplainCopilotEventResponse,
} from "@workspace/api-zod";
import { buildCopilotEvent } from "@workspace/copilot-core";
import { buildEventWithValidation } from "../../lib/validationResolver.js";
import { runCommittee } from "@workspace/copilot-committee";
import { committeeResultToApiRead } from "../../lib/committeeRead.js";
import { getCommitteeProvider } from "../../lib/committeeProvider.js";
import {
  CopilotDataError,
  INTRADAY_SOURCE,
  fetchIntradayInput,
  loadFixtureInput,
} from "../../lib/copilotData.js";
import {
  ALPACA_SOURCE,
  fetchAlpacaIntradayInput,
} from "../../lib/alpacaData.js";
import { getSentimentLensInput } from "../../lib/sentimentContext.js";
import { decisionMemoryEnabled, getDecisionMemory } from "../../lib/memoryStore.js";
import { planLenses } from "../../lib/committeePlanner.js";

const router: IRouter = Router();

router.get("/explain", async (req, res) => {
  const parsed = ExplainCopilotEventQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: symbol is required" });
    return;
  }

  const { symbol, source, mode } = parsed.data;
  const symbolUpper = symbol.toUpperCase().trim();
  // Permissive enough for real Yahoo symbols: BRK-B, BTC-USD, ^GSPC, ES=F, 7203.T
  if (!symbolUpper || !/^[A-Z0-9.\-=^]{1,12}$/.test(symbolUpper)) {
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
    const core = await buildEventWithValidation(mode ? { ...input, mode } : input);
    const result = await runCommittee(core, provider);
    res.json(ExplainCopilotEventResponse.parse(committeeResultToApiRead(result)));
    return;
  }

  // Data-plane contract: paid feeds only (Alpaca SIP). Yahoo delayed bars are
  // disabled unless explicitly re-enabled for offline experiments.
  if (source === "yahoo_delayed" && process.env["ALLOW_DELAYED_YAHOO"] !== "true") {
    res.status(400).json({
      error: "yahoo_delayed is disabled by the data-plane contract — use source=alpaca_live",
    });
    return;
  }
  const liveSource = source === "alpaca_live" ? ALPACA_SOURCE : INTRADAY_SOURCE;

  // Grounded news-only sentiment + decision memory for the committee — LIVE
  // reads ONLY, enforced here: a REPLAY/RESEARCH read of historical bars must
  // never receive present-day context (look-ahead contamination). Fetched in
  // parallel; both are independent of the market-data fetch below.
  // Wave 0 containment: the committee only receives decision memory when
  // explicitly re-enabled — until Wave 1's trusted-only retrieval, unvetted
  // verdicts must not inform a live read. The /memory diagnostic is unaffected.
  const isLiveRead = (mode ?? "LIVE") === "LIVE";
  const [sentiment, decisionMemory] = isLiveRead
    ? await Promise.all([
        getSentimentLensInput(symbolUpper).catch(() => null),
        decisionMemoryEnabled()
          ? getDecisionMemory(symbolUpper).catch(() => [] as string[])
          : Promise.resolve([] as string[]),
      ])
    : [null, [] as string[]];

  try {
    const input =
      source === "alpaca_live"
        ? await fetchAlpacaIntradayInput(symbolUpper, mode ?? "LIVE")
        : await fetchIntradayInput(symbolUpper, mode ?? "LIVE");
    const core = await buildEventWithValidation(input);
    // Opt-in planner (COMMITTEE_PLANNER=on): null → all lenses (the default).
    const lensSelection = await planLenses(core);
    const result = await runCommittee(core, provider, { sentiment, lensSelection, decisionMemory });
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
        dataSource: liveSource,
        bars: [],
        quote: null,
      });
      const result = await runCommittee(core, provider, { sentiment, decisionMemory });
      res.json(ExplainCopilotEventResponse.parse(committeeResultToApiRead(result)));
      return;
    }
    req.log.error({ err }, "Unexpected error explaining copilot event");
    res.status(500).json({ error: "Could not explain copilot event." });
  }
});

export default router;
