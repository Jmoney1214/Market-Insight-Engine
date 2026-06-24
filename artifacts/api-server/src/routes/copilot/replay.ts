import { Router, type IRouter } from "express";
import {
  ExplainReplayEventQueryParams,
  ExplainReplayEventResponse,
  GetReplayEventQueryParams,
  GetReplayEventResponse,
  GetReplaySessionQueryParams,
  GetReplaySessionResponse,
} from "@workspace/api-zod";
import {
  buildCopilotEvent,
  buildReplayInput,
  getReplaySession,
} from "@workspace/copilot-core";
import { runCommittee } from "@workspace/copilot-committee";
import { coreEventToApiEvent } from "../../lib/copilotEvent.js";
import { committeeResultToApiRead } from "../../lib/committeeRead.js";
import { getCommitteeProvider } from "../../lib/committeeProvider.js";

const router: IRouter = Router();

const SYMBOL_RE = /^[A-Z.\-]{1,6}$/;

function normalizeSymbol(symbol: string): string | null {
  const upper = symbol.toUpperCase().trim();
  return upper && SYMBOL_RE.test(upper) ? upper : null;
}

// Replay is a read-only research/practice surface: it replays fixture bars
// through the SAME deterministic pipeline used for live reads. It never
// executes, simulates, routes, or paper-trades anything.

router.get("/replay/session", (req, res) => {
  const parsed = GetReplaySessionQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: symbol is required" });
    return;
  }
  const symbol = normalizeSymbol(parsed.data.symbol);
  if (!symbol) {
    res.status(400).json({ error: "Invalid symbol" });
    return;
  }
  const session = getReplaySession(symbol, parsed.data.date ?? undefined);
  if (!session) {
    res
      .status(404)
      .json({ error: `No replayable session for "${symbol}".` });
    return;
  }
  res.json(GetReplaySessionResponse.parse(session));
});

router.get("/replay/event", (req, res) => {
  const parsed = GetReplayEventQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request: symbol, date and step are required" });
    return;
  }
  const symbol = normalizeSymbol(parsed.data.symbol);
  if (!symbol) {
    res.status(400).json({ error: "Invalid symbol" });
    return;
  }
  const { date, step } = parsed.data;
  const input = buildReplayInput(symbol, date, step);
  if (!input) {
    res.status(404).json({
      error: `No replay step ${step} for "${symbol}" on ${date}.`,
    });
    return;
  }
  const core = buildCopilotEvent(input);
  res.json(GetReplayEventResponse.parse(coreEventToApiEvent(core)));
});

router.get("/replay/explain", async (req, res) => {
  const parsed = ExplainReplayEventQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request: symbol, date and step are required" });
    return;
  }
  const symbol = normalizeSymbol(parsed.data.symbol);
  if (!symbol) {
    res.status(400).json({ error: "Invalid symbol" });
    return;
  }
  const { date, step } = parsed.data;
  const input = buildReplayInput(symbol, date, step);
  if (!input) {
    res.status(404).json({
      error: `No replay step ${step} for "${symbol}" on ${date}.`,
    });
    return;
  }

  // null when the OpenAI integration is not configured -> deterministic read.
  const provider = getCommitteeProvider();
  const core = buildCopilotEvent(input);
  const result = await runCommittee(core, provider);
  res.json(ExplainReplayEventResponse.parse(committeeResultToApiRead(result)));
});

export default router;
