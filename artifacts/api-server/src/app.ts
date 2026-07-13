import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { agentIdentity } from "./lib/agentAuth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// 5mb: a Kronos backfill batch (90 forecasts x full quantile paths) is ~1mb;
// the express default of 100kb bounced it with a 413.
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Per-agent identity + append-only audit (enforcement off by default — see agentAuth.ts).
app.use(agentIdentity());

app.use("/api", router);

export default app;
