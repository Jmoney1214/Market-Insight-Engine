// JSON sanitization: replace NaN / Infinity / -Infinity with null so the
// emitted event is always valid, serializable JSON.

export function sanitizeNumber(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

export function sanitizeDeep<T>(value: T): T {
  if (typeof value === "number") {
    return (Number.isFinite(value) ? value : null) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeDeep(item);
    }
    return result as unknown as T;
  }
  return value;
}
