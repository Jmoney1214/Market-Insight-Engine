// Deterministic, network-free REPLAY engine.
//
// Replay "plays back" a historical session by feeding progressively more of a
// fixture's bars through the SAME pure buildCopilotEvent pipeline used for live
// reads. It is a research/practice tool: it never executes, simulates, routes,
// or paper-trades anything. The transport clock (play / pause / step / speed /
// stop) lives in the client; this module only answers the pure question
// "what is the deterministic input at step N?".

import { round } from "./detectors";
import { getFixture } from "./fixtures";
import type { Bar, BuildEventInput, Quote } from "./types";

/** Data-source label for replayed events, distinct from live `fixture`. */
export const REPLAY_DATA_SOURCE = "fixture_replay";

export interface ReplaySession {
  symbol: string;
  /** ISO date (YYYY-MM-DD) of the replayable session. */
  date: string;
  /**
   * Every ISO date this symbol can be replayed for, so the UI can offer a date
   * picker. The current fixtures expose a single session day per symbol.
   */
  availableDates: string[];
  dataSource: string;
  /** Total replayable steps. Valid steps are 0-based: 0 .. totalSteps - 1. */
  totalSteps: number;
  /** Seconds between consecutive bars. */
  barSeconds: number;
  /** Epoch seconds of the first bar. */
  startTime: number;
  /** Epoch seconds of the last bar. */
  endTime: number;
}

function sessionDate(bars: Bar[]): string {
  return new Date(bars[0].t * 1000).toISOString().slice(0, 10);
}

function inferBarSeconds(bars: Bar[]): number {
  return bars.length >= 2 ? bars[1].t - bars[0].t : 300;
}

/**
 * Replay session metadata for a fixture symbol, or null when the symbol has no
 * replayable bars (e.g. NODATA) or the requested date does not match the single
 * session the fixture provides. Symbol matching is case-insensitive.
 */
export function getReplaySession(
  symbol: string,
  date?: string,
): ReplaySession | null {
  const fixture = getFixture(symbol);
  if (!fixture || fixture.bars.length === 0) return null;
  const bars = fixture.bars;
  const sessionDateStr = sessionDate(bars);
  if (date && date !== sessionDateStr) return null;
  return {
    symbol: fixture.symbol,
    date: sessionDateStr,
    availableDates: [sessionDateStr],
    dataSource: REPLAY_DATA_SOURCE,
    totalSteps: bars.length,
    barSeconds: inferBarSeconds(bars),
    startTime: bars[0].t,
    endTime: bars[bars.length - 1].t,
  };
}

/**
 * Synthesize a fresh, tight quote from the last revealed bar so that the
 * LIVE/REPLAY freshness and spread gates behave naturally as the replay clock
 * advances (each partial tick is "current" as of its own bar, never stale).
 */
function freshQuote(lastBar: Bar): Quote {
  return {
    bid: round(lastBar.c - 0.02, 2),
    ask: round(lastBar.c + 0.02, 2),
    last: lastBar.c,
    quoteTime: lastBar.t,
  };
}

/**
 * Build a deterministic {@link BuildEventInput} for a single replay step
 * (0-based). Reveals bars[0..step] and synthesizes a fresh quote as of that
 * bar, tagged `mode: "REPLAY"`. Returns null for non-replayable symbols/dates
 * or out-of-range / non-integer steps.
 */
export function buildReplayInput(
  symbol: string,
  date: string,
  step: number,
): BuildEventInput | null {
  const session = getReplaySession(symbol, date);
  if (!session) return null;
  if (!Number.isInteger(step) || step < 0 || step >= session.totalSteps) {
    return null;
  }
  const fixture = getFixture(symbol)!;
  const revealed = fixture.bars.slice(0, step + 1);
  const lastBar = revealed[revealed.length - 1];
  return {
    symbol: fixture.symbol,
    mode: "REPLAY",
    dataSource: REPLAY_DATA_SOURCE,
    bars: revealed,
    quote: freshQuote(lastBar),
    nowMs: lastBar.t * 1000,
  };
}
