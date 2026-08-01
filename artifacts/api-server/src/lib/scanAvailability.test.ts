import { beforeEach, describe, expect, it, vi } from "vitest";

describe("premarket scan provider availability", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("FMP_API_KEY", "test-fmp-key");
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");
  });

  it("allows the scan when FMP is configured without Alpaca", async () => {
    const { scanAvailable } = await import("./scan.js");

    expect(scanAvailable()).toBe(true);
  }, 15_000);
});
