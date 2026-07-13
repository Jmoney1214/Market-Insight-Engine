import { afterEach, describe, expect, it, vi } from "vitest";

describe("live provider configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps the Alpaca market-data feed on SIP even if a stale env override requests IEX", async () => {
    vi.stubEnv("ALPACA_FEED", "iex");
    vi.resetModules();

    const { alpacaFeed } = await import("./config.js");

    expect(alpacaFeed).toBe("sip");
  });
});
