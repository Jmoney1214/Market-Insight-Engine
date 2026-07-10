import { describe, it, expect } from "vitest";
import { eventIdOf } from "./journal.js";

describe("eventIdOf (journal idempotency key)", () => {
  it("extracts a non-empty string eventId from the snapshot", () => {
    expect(eventIdOf({ eventId: "evt-9" })).toBe("evt-9");
    expect(eventIdOf({ eventId: "evt-9", other: 1 })).toBe("evt-9");
  });

  it("returns null when absent, empty, non-string, or not an object (=> not deduped)", () => {
    expect(eventIdOf(null)).toBe(null);
    expect(eventIdOf(undefined)).toBe(null);
    expect(eventIdOf({})).toBe(null);
    expect(eventIdOf({ eventId: "" })).toBe(null);
    expect(eventIdOf({ eventId: 123 })).toBe(null);
    expect(eventIdOf("evt-9")).toBe(null);
  });
});
