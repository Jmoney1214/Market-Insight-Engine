import { Router, type Request, type Response } from "express";
import type { VerifiedControlPlaneContext } from "@workspace/db/control-plane";
import {
  clearBrowserSessionCookies,
  newOpaqueToken,
  setBrowserSessionCookies,
} from "../auth/sessions.js";
import type { AuthRuntime } from "../auth/types.js";

const router = Router();

function runtime(req: Request): AuthRuntime {
  return req.app.locals["authRuntime"] as AuthRuntime;
}

function requireAuth(req: Request, res: Response) {
  if (!req.auth) {
    res.status(500).json({ error: "Authentication context missing", code: "AUTH_CONTEXT_MISSING" });
    return null;
  }
  return req.auth;
}

router.post("/auth/session", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (auth.authMode !== "bearer" || auth.principal.kind !== "human") {
    res.status(403).json({ error: "A permanent human bearer is required", code: "AUTH_FORBIDDEN" });
    return;
  }

  const sessionToken = newOpaqueToken();
  const csrfToken = newOpaqueToken();
  const sessionId = await runtime(req).repository.createBrowserSession({
    principalId: auth.principal.principalId,
    credentialId: auth.credentialId,
    rawSessionToken: sessionToken,
    rawCsrfToken: csrfToken,
    requestId: auth.requestId,
  });
  setBrowserSessionCookies(res, sessionToken, csrfToken);
  res.status(201).json({
    sessionId,
    principal: auth.principal,
    effectiveScopes: auth.effectiveScopes,
  });
});

router.delete("/auth/session", async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (auth.authMode !== "cookie" || !auth.sessionId) {
    res.status(401).json({ error: "Browser session required", code: "AUTH_REQUIRED" });
    return;
  }
  const context: VerifiedControlPlaneContext = {
    requestId: auth.requestId,
    principalId: auth.principal.principalId,
    credentialId: auth.credentialId,
  };
  await runtime(req).repository.revokeBrowserSession(
    context,
    auth.sessionId,
    "browser session logout",
  );
  clearBrowserSessionCookies(res);
  res.status(204).send();
});

router.get("/auth/whoami", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  res.json({
    principal: auth.principal,
    credentialId: auth.credentialId,
    effectiveScopes: auth.effectiveScopes,
    authMode: auth.authMode,
    ...(auth.sessionId ? { sessionId: auth.sessionId } : {}),
  });
});

export default router;
