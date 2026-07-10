import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { getReadClient } from "../lib/brain/supabaseClient.js";
import { anthropicCompleter } from "../lib/brain/synthesize.js";
import { diagnose } from "../lib/brain/diagnose.js";

// CLI convenience: load artifacts/api-server/.env with Node's built-in loader
// (the api-server has no dotenv dependency; the server itself inherits env from
// its runtime). Best-effort — already-exported vars win; a missing file is fine,
// the clients throw a clear error if a required var is still unset.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // no .env present — rely on the already-exported environment.
}

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('usage: brain "why did JUMPDAY_RIDER go no_edge?"');
  process.exit(2);
}

/** One clean line from any failure — Anthropic API error, missing env, or DB
 * read — instead of a raw stack. Still surfaces the real cause; never fakes. */
function reason(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { status?: number; error?: { error?: { message?: string } }; message?: string };
    const apiMsg = e.error?.error?.message;
    if (apiMsg) return e.status ? `${apiMsg} (HTTP ${e.status})` : apiMsg;
    if (typeof e.message === "string" && e.message) return e.message;
  }
  return String(err);
}

try {
  const db = getReadClient();
  const complete = anthropicCompleter(new Anthropic());
  const out = await diagnose({ db, complete }, question);
  console.log("\n" + out.answer + "\n");
  if (out.citations.length) console.log("cited:", out.citations.join(", "));
} catch (err) {
  console.error("brain: " + reason(err));
  process.exit(1);
}
