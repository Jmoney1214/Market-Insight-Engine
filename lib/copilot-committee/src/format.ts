// Small pure formatting helpers. Kept deliberately conservative so generated
// strings never contain execution-implying or false-certainty language.

export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

export function fmtSigned(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

/** De-duplicates and drops empty/non-string entries while preserving order. */
export function uniq(items: string[]): string[] {
  return Array.from(
    new Set(items.filter((s) => typeof s === "string" && s.length > 0)),
  );
}
