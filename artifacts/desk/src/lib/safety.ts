// Client-side safety layer for the Trading Desk Copilot terminal.
//
// SAFETY: This is a research/helper terminal. It NEVER executes, routes, or
// simulates trades. Every AI-sourced string (committee dashboard read, agent
// headlines, supporting factors, warnings, notes) MUST pass through this layer
// before it is rendered. The server already scrubs forbidden language; this is
// the last-line, defense-in-depth client guard. The forbidden vocabulary and
// scanner are imported from the shared committee package so the ban list is
// never duplicated and can never drift out of sync.

import {
  scanForbidden,
  scanForbiddenDeep,
  hasForbiddenLanguage,
} from "@workspace/copilot-committee/guardrails";
import {
  FORBIDDEN_PHRASES,
  APPROVED_RECOMMENDATIONS,
  type Recommendation,
} from "@workspace/copilot-committee/vocab";

export {
  scanForbidden,
  scanForbiddenDeep,
  hasForbiddenLanguage,
  FORBIDDEN_PHRASES,
  APPROVED_RECOMMENDATIONS,
};
export type { Recommendation };

const REDACTION = "[redacted]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

/**
 * Replace every forbidden phrase occurrence (case-insensitive, literal) with a
 * redaction marker. Pure string transform; safe to call on any AI prose.
 */
export function redactForbidden(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const phrase of FORBIDDEN_PHRASES) {
    if (!phrase) continue;
    out = out.replace(new RegExp(escapeRegExp(phrase), "gi"), REDACTION);
  }
  return out;
}

/**
 * Returns a render-safe version of a single AI-sourced string. If the text
 * trips a forbidden phrase it is redacted; in development a warning is logged so
 * the regression is visible during QA. Nullish input returns the fallback.
 */
export function safeText(value: string | null | undefined, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value !== "string") return fallback;
  const hits = scanForbidden(value);
  if (hits.length === 0) return value;
  if (isDev()) {
    // eslint-disable-next-line no-console
    console.warn("[desk:safety] forbidden language redacted before render", { hits });
  }
  return redactForbidden(value);
}

/** Map an array of AI-sourced strings to render-safe strings. */
export function safeList(values: readonly string[] | null | undefined): string[] {
  if (!values) return [];
  return values.map((v) => safeText(v));
}
