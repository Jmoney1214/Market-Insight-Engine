import { describe, it, expect, beforeEach, vi } from "vitest";
import { formatScanAlert, notifyScanRecorded, telegramConfigured, _resetNotifyGuard } from "./notify.js";
import type { ScanResult, ScanCandidate } from "./scan.js";

const candidate = (over: Partial<ScanCandidate>): ScanCandidate => ({
  symbol: "TEST",
  companyName: null,
  price: 10,
  gapPct: 3.2,
  avgVolume: 1_000_000,
  atrPct: 5.1,
  rsi: 60,
  avgDailyRangePct: 4,
  multiTradeDays: 3,
  score: 72,
  tradeClass: null,
  classNote: null,
  reasons: [],
  ...over,
});

const result = (over: Partial<ScanResult>): ScanResult => ({
  generatedAt: "2026-07-13T12:20:00.000Z",
  universeSize: 480,
  priceCeiling: 150,
  note: "",
  topIntraday: [],
  likelyJump: [],
  likelyFall: [],
  ...over,
});

describe("formatScanAlert", () => {
  it("lists candidates with symbol, score and gap", () => {
    const msg = formatScanAlert(
      result({ topIntraday: [candidate({ symbol: "RGTI", score: 51, gapPct: 8.4 })] }),
      "2026-07-13",
    );
    expect(msg).toContain("Morning Scan recorded — 2026-07-13");
    expect(msg).toContain("RGTI");
    expect(msg).toContain("score 51");
    expect(msg).toContain("gap +8.4%");
    expect(msg).toContain("universe 480");
  });

  it("says so when nothing passed the gates", () => {
    const msg = formatScanAlert(result({}), "2026-07-13");
    expect(msg).toContain("No candidates passed the gates today.");
  });
});

describe("notifyScanRecorded", () => {
  beforeEach(() => {
    _resetNotifyGuard();
    vi.unstubAllEnvs();
  });

  it("is a silent no-op without Telegram config", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    expect(telegramConfigured()).toBe(false);
    await expect(notifyScanRecorded(result({}), "2026-07-13")).resolves.toBe(false);
  });

  it("sends at most once per scan date", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "c");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    try {
      expect(await notifyScanRecorded(result({}), "2026-07-13")).toBe(true);
      expect(await notifyScanRecorded(result({}), "2026-07-13")).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("allows a retry when the send fails", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_CHAT_ID", "c");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    try {
      expect(await notifyScanRecorded(result({}), "2026-07-13")).toBe(false);
      expect(await notifyScanRecorded(result({}), "2026-07-13")).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
