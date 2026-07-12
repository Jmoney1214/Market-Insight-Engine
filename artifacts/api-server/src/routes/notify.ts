import { Router, type IRouter } from "express";
import { sendTelegram, telegramConfigured } from "../lib/notify.js";

const router: IRouter = Router();

/**
 * Manual test ping — verifies the Telegram wiring end to end without waiting
 * for the next scan window. Sends to the configured chat only.
 */
router.post("/notify/test", async (_req, res) => {
  if (!telegramConfigured()) {
    res.status(503).json({
      sent: false,
      configured: false,
      error: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set",
    });
    return;
  }
  const sent = await sendTelegram("✅ Market-Insight desk: notification channel is live.");
  res.status(sent ? 200 : 502).json({ sent, configured: true });
});

export default router;
