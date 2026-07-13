import { describe, it, expect } from "vitest";
import { canonicalize, canonicalSha256, finalize, verifyFinalized } from "./canonical";

describe("canonicalize", () => {
  it("sorts keys at every depth and preserves array order", () => {
    const a = canonicalize({ b: 1, a: { d: [3, 1, 2], c: "x" } });
    const b = canonicalize({ a: { c: "x", d: [3, 1, 2] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":"x","d":[3,1,2]},"b":1}');
  });

  it("drops undefined properties and rejects non-finite numbers", () => {
    expect(canonicalize({ a: 1, gone: undefined })).toBe('{"a":1}');
    expect(() => canonicalize({ a: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalize({ a: Number.NaN })).toThrow();
  });
});

describe("finalize-then-validate hashing", () => {
  it("hash preimage omits the object's own hash field", () => {
    const draft = { contract: "X", value: 42 };
    const done = finalize(draft);
    expect(done.canonicalSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Recomputing over the finalized object (which now carries the hash) must
    // yield the same digest because the field is omitted from the preimage.
    expect(canonicalSha256(done)).toBe(done.canonicalSha256);
    expect(verifyFinalized(done)).toBe(true);
  });

  it("detects tampering", () => {
    const done = finalize({ contract: "X", value: 42 });
    expect(verifyFinalized({ ...done, value: 43 })).toBe(false);
  });

  it("is stable across key insertion order", () => {
    const h1 = finalize({ a: 1, b: 2 }).canonicalSha256;
    const h2 = finalize({ b: 2, a: 1 }).canonicalSha256;
    expect(h1).toBe(h2);
  });
});
