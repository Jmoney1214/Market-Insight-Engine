import type { Request } from "express";
import { sha256Canonical } from "@workspace/research-contracts";

export const IDEMPOTENCY_HEADER = "idempotency-key";

export function canonicalRequestHash(req: Request, operationId: string): string {
  return sha256Canonical({
    operationId,
    method: req.method.toUpperCase(),
    path: req.path,
    query: req.query,
    body: req.body ?? null,
  });
}

export function readIdempotencyKey(req: Request): string | null {
  const value = req.get(IDEMPOTENCY_HEADER)?.trim();
  if (!value || value.length > 255) return null;
  return value;
}
