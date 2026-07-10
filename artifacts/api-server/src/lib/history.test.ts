import { describe, it, expect } from "vitest";
import { eventToHistoryRow } from "./history.js";
import type { CopilotEvent as ApiCopilotEvent } from "@workspace/api-zod";

describe("eventToHistoryRow", () => {
  it("maps the timeline columns and preserves the full event as the snapshot", () => {
    const event = {
      eventId: "evt-123",
      symbol: "NVDA",
      mode: "LIVE",
      alertLevel: "L3",
      timestamp: "2026-07-10T14:00:00Z",
      warnings: [],
    } as unknown as ApiCopilotEvent;

    const row = eventToHistoryRow(event);
    expect(row.eventId).toBe("evt-123");
    expect(row.symbol).toBe("NVDA");
    expect(row.mode).toBe("LIVE");
    expect(row.alertLevel).toBe("L3");
    // The whole event is retained so GET /history can rehydrate the timeline entry.
    expect(row.eventSnapshot).toBe(event);
  });
});
