/**
 * Canonical JSON (RFC 8785 JCS profile) + SHA-256 hashing.
 *
 * Rules (research-layer buildout §5):
 * - Object keys sorted lexicographically at every depth; array order preserved.
 * - Numbers must be finite (non-finite throws — contracts never carry NaN/Inf).
 * - An object's own hash field is omitted from its hash preimage, so hashing
 *   and strict validation never conflict (finalize-then-validate).
 */
import { createHash } from "node:crypto";

export const HASH_FIELD = "canonicalSha256";

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalize: non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
        .join(",")}}`;
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value}`);
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Hash of the canonicalized object with its own hash field omitted. */
export function canonicalSha256(obj: Record<string, unknown>, omit: string = HASH_FIELD): string {
  const { [omit]: _dropped, ...preimage } = obj;
  return `sha256:${sha256Hex(canonicalize(preimage))}`;
}

/** Attach the canonical hash to a draft, producing the finalized instance. */
export function finalize<T extends Record<string, unknown>>(draft: T): T & { canonicalSha256: string } {
  return { ...draft, canonicalSha256: canonicalSha256(draft) };
}

/** Recompute and compare a finalized object's hash. */
export function verifyFinalized(obj: Record<string, unknown>): boolean {
  const stated = obj[HASH_FIELD];
  return typeof stated === "string" && stated === canonicalSha256(obj);
}
