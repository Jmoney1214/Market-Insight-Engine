import app from "./app";
import { logger } from "./lib/logger";
import { startScanScheduler } from "./lib/scan";

const rawPort = process.env["PORT"];

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
