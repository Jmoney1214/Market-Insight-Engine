import type { Subject } from "./types.js";

// The registered promotable hypotheses (mirror strategyLab). Extend as the
// registry grows; unknown names fall through to session/system routing.
const STRATEGIES = [
  "JUMPDAY_RIDER", "LARGECAP_SCALPER", "POST_EARNINGS_DRIFT", "RELATIVE_STRENGTH_MOMENTUM",
  "GAP_CONTINUATION", "GAP_FADE", "OPENING_RANGE_BREAKOUT", "OPENING_RANGE_FAILURE",
  "VOLATILITY_COMPRESSION_BREAKOUT",
];

export function parseIntent(question: string): Subject {
  const upper = question.toUpperCase();
  for (const s of STRATEGIES) {
    if (upper.includes(s)) return { kind: "strategy", id: s };
  }
  const date = question.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (date) return { kind: "session", date: date[1] };
  return { kind: "system", sinceHours: 24 };
}
