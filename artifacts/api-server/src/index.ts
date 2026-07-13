import "./loadEnv"; // MUST be first: lib/db throws at import time without DATABASE_URL
import app from "./app";
import { logger } from "./lib/logger";
import { startScanScheduler } from "./lib/scan";

// Local dev runs on 8080 by default (the runbook's port); production still
// requires an explicit PORT so a misconfigured deploy fails loudly.
const rawPort =
  process.env["PORT"] ?? (process.env["NODE_ENV"] === "development" ? "8080" : undefined);

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Proactive hunter: pre-warm the morning scan on weekdays so the dashboard
  // opens already loaded with the day's research.
  startScanScheduler();
});
