import { createHash, createHmac } from "node:crypto";
import { types as utilTypes } from "node:util";

function fail(reason: string): never {
  throw new TypeError(`Canonical JSON requires JSON data: ${reason}`);
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail("unpaired high surrogate");
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail("unpaired low surrogate");
    }
  }
}

function assertDataProperty(
  value: object,
  key: PropertyKey,
): PropertyDescriptor & { value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    descriptor.enumerable !== true
  ) {
    fail("object members must be enumerable data properties");
  }
  return descriptor as PropertyDescriptor & { value: unknown };
}

function serializeArray(value: unknown[], ancestors: Set<object>): string {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length")) {
    fail("arrays cannot contain holes, symbols, or extra properties");
  }

  const entries: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (!Object.hasOwn(value, key)) {
      fail("sparse arrays are not JSON data");
    }
    const descriptor = assertDataProperty(value, key);
    entries.push(serialize(descriptor.value, ancestors));
  }
  return `[${entries.join(",")}]`;
}

function serializeObject(
  value: Record<string, unknown>,
  ancestors: Set<object>,
): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("only plain objects are supported");
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    fail("symbol-keyed properties are not JSON data");
  }

  const properties = (ownKeys as string[])
    .map((key) => {
      assertWellFormedUnicode(key);
      return [key, assertDataProperty(value, key).value] as const;
    })
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(
      ([key, child]) => `${JSON.stringify(key)}:${serialize(child, ancestors)}`,
    );

  return `{${properties.join(",")}}`;
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (
    ((typeof value === "object" && value !== null) ||
      typeof value === "function") &&
    utilTypes.isProxy(value)
  ) {
    fail("proxies are not JSON data");
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    assertWellFormedUnicode(value);
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("numbers must be finite");
    }
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    fail(`${typeof value} is not a JSON value`);
  }

  if (ancestors.has(value)) {
    fail("cyclic structures are not JSON data");
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return serializeArray(value, ancestors);
    }

    return serializeObject(value as Record<string, unknown>, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, new Set<object>());
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

export function hmacCanonical(value: unknown, key: string): string {
  return createHmac("sha256", key)
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}
