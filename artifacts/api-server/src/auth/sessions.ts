import { randomBytes } from "node:crypto";
import type { CookieOptions, Response } from "express";
import { CSRF_COOKIE, SESSION_COOKIE } from "./csrf.js";

const strictSecureCookie: CookieOptions = {
  secure: true,
  sameSite: "strict",
};

const sessionCookie: CookieOptions = { ...strictSecureCookie, path: "/api" };
// The Desk is mounted outside /api and must be able to read the double-submit
// CSRF value from document.cookie. The opaque session remains scoped to /api.
const csrfCookie: CookieOptions = { ...strictSecureCookie, path: "/" };

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function setBrowserSessionCookies(
  res: Response,
  sessionToken: string,
  csrfToken: string,
): void {
  res.cookie(SESSION_COOKIE, sessionToken, {
    ...sessionCookie,
    httpOnly: true,
  });
  res.cookie(CSRF_COOKIE, csrfToken, {
    ...csrfCookie,
    httpOnly: false,
  });
}

export function clearBrowserSessionCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookie, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...csrfCookie, httpOnly: false });
}
