/**
 * Per-agent identity + append-only audit — v1.
 *
 * AGENT_TOKENS="desk-claude:tok_abc,codex:tok_def" maps bearer tokens to
 * principal names. Every /api request is attributed to a principal
 * ("anonymous" when no/unknown token — the browser UIs send none) and logged
 * to the append-only agent_audit table.
 *
 * Enforcement is OFF by default: REQUIRE_AGENT_TOKEN=true rejects anonymous
 * requests with 401 — do not enable it until the browser UIs carry a session
 * credential, or the Desk/FinDesk pages will lose API access. Scopes and
 * rate limits arrive with the full token system (buildout plan §9).
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger.js";

export function parseAgentTokens(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf(":");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const token = pair.slice(idx + 1).trim();
    if (name && token) map.set(token, name);
  }
  return map;
}

export function resolvePrincipal(
  authHeader: string | undefined,
  tokens: Map<string, string>,
): string {
  if (!authHeader?.startsWith("Bearer ")) return "anonymous";
  return tokens.get(authHeader.slice(7).trim()) ?? "anonymous";
}

const SKIP_AUDIT = new Set(["/api/healthz", "/api/copilot/healthz"]);

export function agentIdentity() {
  const tokens = parseAgentTokens(process.env["AGENT_TOKENS"]);
  const enforce = process.env["REQUIRE_AGENT_TOKEN"] === "true";

  return (req: Request, res: Response, next: NextFunction): void => {
    const principal = resolvePrincipal(req.headers.authorization, tokens);
    res.locals["principal"] = principal;

    const path = (req.originalUrl ?? req.url).split("?")[0] ?? "";
    if (enforce && principal === "anonymous" && !SKIP_AUDIT.has(path)) {
      res.status(401).json({ error: "Agent token required" });
      return;
    }

    if (!SKIP_AUDIT.has(path)) {
      const started = Date.now();
      res.on("finish", () => {
        // Fire-and-forget append; auditing must never slow or fail a request.
        void import("@workspace/db")
          .then(({ db, agentAuditTable }) =>
            db.insert(agentAuditTable).values({
              principal,
              method: req.method,
              path,
              status: res.statusCode,
              durationMs: Date.now() - started,
            }),
          )
          .catch((err) => logger.debug({ err: String(err) }, "audit write skipped"));
      });
    }
    next();
  };
}
