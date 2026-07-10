import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { getReadClient } from "../lib/brain/supabaseClient.js";
import { anthropicCompleter } from "../lib/brain/synthesize.js";
import { diagnose } from "../lib/brain/diagnose.js";

const router: IRouter = Router();

// POST /brain/ask — read-only diagnostic. Body: { question: string }.
// Shares the exact engine the CLI uses. Never writes; on failure it surfaces the
// error rather than fabricating an answer.
router.post("/ask", async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }
  try {
    const out = await diagnose(
      { db: getReadClient(), complete: anthropicCompleter(new Anthropic()) },
      question,
    );
    res.json({ answer: out.answer, citations: out.citations });
  } catch (err) {
    req.log?.warn?.({ err: String(err) }, "brain/ask failed");
    res.status(502).json({ error: "diagnosis failed", detail: String(err) });
  }
});

export default router;
