import { db, historyLogTable } from "@workspace/db";
import type { CopilotEvent as ApiCopilotEvent } from "@workspace/api-zod";

/**
 * Persistence for the copilot timeline. GET /copilot/history reads history_log, but until now
 * NOTHING wrote to it — the timeline (a memory-loop read-back surface) was permanently empty.
 * recordHistory() is called for every event the /event route produces.
 */

type MinimalLogger = { warn: (obj: unknown, msg?: string) => void };

/** Pure map from a produced API event to a history_log insert row (unit-testable, no DB). */
export function eventToHistoryRow(event: ApiCopilotEvent) {
  return {
    eventId: event.eventId,
    symbol: event.symbol,
    mode: event.mode,
    alertLevel: event.alertLevel,
    eventSnapshot: event as unknown as Record<string, unknown>,
  };
}

/**
 * Best-effort insert of a produced event into history_log. A DB failure must NEVER break the
 * event response, so this swallows errors (logged) — the event is already served to the client.
 */
export async function recordHistory(event: ApiCopilotEvent, log?: MinimalLogger): Promise<void> {
  try {
    await db.insert(historyLogTable).values(eventToHistoryRow(event));
  } catch (err) {
    log?.warn({ err, eventId: event.eventId }, "history_log write failed (non-fatal)");
  }
}
