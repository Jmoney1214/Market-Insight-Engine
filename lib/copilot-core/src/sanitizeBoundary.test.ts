// Build-boundary half of spec §21 item 31: buildCopilotEvent must sanitize
// non-finite inputs so NaN / Infinity can never propagate into the event the API
// later serializes. (The API-response half is covered in the api-server tests.)

import { describe, it, expect } from "vitest";
import { buildCopilotEvent } from "./event";
import { getFixture } from "./fixtures";
import type { Bar } from "./types";

function assertAllFinite(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    expect(
      Number.isFinite(value),
      `non-finite number at ${path}: ${String(value)}`,
    ).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertAllFinite(v, `${path}.${k}`);
  }
}

describe("buildCopilotEvent sanitizes non-finite inputs (item 31)", () => {
  it("strips NaN / Infinity injected via bars and quote", () => {
    const f = getFixture("AAPL");
    if (!f) throw new Error("missing AAPL fixture");

    const poisonedBars: Bar[] = f.bars.map((b, i) =>
      i === f.bars.length - 1
        ? { ...b, c: Infinity, h: Number.NaN, v: -Infinity }
        : b,
    );

    const event = buildCopilotEvent({
      symbol: f.symbol,
      mode: f.mode,
      dataSource: f.dataSource,
      bars: poisonedBars,
      quote: { bid: Number.NaN, ask: Infinity, last: -Infinity, quoteTime: f.nowMs },
      nowMs: f.nowMs,
    });

    // Every numeric leaf in the built event is finite (non-finite values are
    // sanitized to null and skipped by the finite check).
    assertAllFinite(event);

    // And the serialized form carries no literal non-finite tokens.
    expect(JSON.stringify(event)).not.toMatch(/\bNaN\b|\bInfinity\b/);
  });
});
