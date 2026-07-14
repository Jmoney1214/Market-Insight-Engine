import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { createAuthenticationMiddleware } from "./auth/middleware.js";
import { createProductionAuthRuntime } from "./auth/runtime.js";
import type { AuthRuntime } from "./auth/types.js";

export function createApp(authRuntime: AuthRuntime): Express {
  const app: Express = express();
  app.locals["authRuntime"] = authRuntime;

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
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        callback(null, !origin || authRuntime.allowedOrigins.includes(origin));
      },
    }),
  );
  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", createAuthenticationMiddleware(authRuntime));
  app.use("/api", router);

  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    req.log?.error({ err: error }, "Unhandled API error");
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  });

  return app;
}

const app = createApp(createProductionAuthRuntime(process.env));

export default app;
