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

const db = getReadClient();
const complete = anthropicCompleter(new Anthropic());
const out = await diagnose({ db, complete }, question);
console.log("\n" + out.answer + "\n");
if (out.citations.length) console.log("cited:", out.citations.join(", "));
