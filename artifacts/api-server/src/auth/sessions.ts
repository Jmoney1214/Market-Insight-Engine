import { randomBytes } from "node:crypto";
import type { CookieOptions, Response } from "express";
import { CSRF_COOKIE, SESSION_COOKIE } from "./csrf.js";

const browserCookie: CookieOptions = {
  secure: true,
  sameSite: "strict",
  path: "/api",
};

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function setBrowserSessionCookies(
  res: Response,
  sessionToken: string,
  csrfToken: string,
): void {
  res.cookie(SESSION_COOKIE, sessionToken, {
    ...browserCookie,
    httpOnly: true,
  });
  res.cookie(CSRF_COOKIE, csrfToken, {
    ...browserCookie,
    httpOnly: false,
  });
}

export function clearBrowserSessionCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...browserCookie, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...browserCookie, httpOnly: false });
}
