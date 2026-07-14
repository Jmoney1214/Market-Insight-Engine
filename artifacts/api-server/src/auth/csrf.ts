import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { RequestAuthError } from "./types.js";

export const SESSION_COOKIE = "mie_session";
export const CSRF_COOKIE = "mie_csrf";
export const CSRF_HEADER = "x-csrf-token";

export function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireCookieCsrf(
  req: Request,
  allowedOrigins: readonly string[],
): string {
  const csrfCookie = req.cookies?.[CSRF_COOKIE];
  if (typeof csrfCookie !== "string" || csrfCookie.length < 32) {
    throw new RequestAuthError(401, "AUTH_REQUIRED", "Browser session is invalid");
  }

  if (!isUnsafeMethod(req.method)) return csrfCookie;

  const origin = req.get("origin");
  const header = req.get(CSRF_HEADER);
  if (
    !origin ||
    !allowedOrigins.includes(origin) ||
    !header ||
    !constantTimeStringEqual(csrfCookie, header)
  ) {
    throw new RequestAuthError(403, "AUTH_FORBIDDEN", "CSRF validation failed");
  }
  return csrfCookie;
}
