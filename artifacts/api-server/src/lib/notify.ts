/**
 * Outbound notifications — v1: Telegram.
 *
 * Day trading is a latency game between information and eyeballs: the morning
 * scan's picks are worthless sitting in a browser tab. This module pushes the
 * recorded board to Telegram the moment the scheduler records it (08:15–09:30
 * ET window), once per trading day.
 *
 * Config (both required, else notifications are a silent no-op):
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   TELEGRAM_CHAT_ID    — your chat id (message the bot once, then
 *                         GET /getUpdates to read the chat id)
 *
 * sendTelegram never throws — a notification failure must never break a scan.
 */
import { logger } from "./logger.js";
import type { ScanResult, ScanCandidate } from "./scan.js";

export function telegramConfigured(): boolean {
  return Boolean(process.env["TELEGRAM_BOT_TOKEN"] && process.env["TELEGRAM_CHAT_ID"]);
}

const line = (c: ScanCandidate) =>
  `• ${c.symbol}  score ${Math.round(c.score)}  gap ${c.gapPct > 0 ? "+" : ""}${c.gapPct}%` +
  (c.tradeClass ? `  [${c.tradeClass}]` : "") +
  (c.atrPct != null ? `  atr ${c.atrPct}%` : "");

/** Pure formatter — unit-tested, no I/O. */
export function formatScanAlert(result: ScanResult, scanDate: string): string {
  const parts: string[] = [`📊 Morning Scan recorded — ${scanDate}`];
  if (result.topIntraday.length > 0) {
    parts.push("", "Top intraday:");
    parts.push(...result.topIntraday.slice(0, 5).map(line));
  }
  if (result.likelyJump.length > 0) {
    parts.push("", "Likely jump:");
    parts.push(...result.likelyJump.slice(0, 3).map(line));
  }
  if (result.likelyFall.length > 0) {
    parts.push("", "Likely fall:");
    parts.push(...result.likelyFall.slice(0, 3).map(line));
  }
  if (parts.length === 1) parts.push("", "No candidates passed the gates today.");
  parts.push("", `universe ${result.universeSize} · generated ${result.generatedAt}`);
  return parts.join("\n");
}

/** Fire a Telegram message. Never throws; returns whether the API accepted it. */
export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Telegram send failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err: String(err) }, "Telegram send errored");
    return false;
  }
}

let lastNotifiedDate: string | null = null;

/**
 * Notify once per trading day when the scan board is recorded. The in-memory
 * guard resets on server restart, which at worst re-sends one message — the
 * DB record path itself stays idempotent and is never affected by this.
 */
export async function notifyScanRecorded(result: ScanResult, scanDate: string): Promise<boolean> {
  if (lastNotifiedDate === scanDate) return false;
  if (!telegramConfigured()) {
    logger.debug("Telegram not configured; scan notification skipped");
    return false;
  }
  lastNotifiedDate = scanDate;
  const ok = await sendTelegram(formatScanAlert(result, scanDate));
  if (ok) logger.info({ scanDate }, "Scan notification sent");
  else lastNotifiedDate = null; // failed send: allow retry on the next record pass
  return ok;
}

/** Test-only escape hatch. */
export function _resetNotifyGuard(): void {
  lastNotifiedDate = null;
}
