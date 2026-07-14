import { describe, it, expect } from "vitest";
import { parseAgentTokens, resolvePrincipal } from "./agentAuth.js";

describe("parseAgentTokens", () => {
  it("parses name:token pairs", () => {
    const m = parseAgentTokens("desk-claude:tok_abc,codex:tok_def");
    expect(m.get("tok_abc")).toBe("desk-claude");
    expect(m.get("tok_def")).toBe("codex");
    expect(m.size).toBe(2);
  });

  it("tolerates whitespace, empty input, and malformed pairs", () => {
    expect(parseAgentTokens(undefined).size).toBe(0);
    expect(parseAgentTokens("").size).toBe(0);
    const m = parseAgentTokens(" a : t1 , broken, :nope , b:t2 ");
    expect(m.get("t1")).toBe("a");
    expect(m.get("t2")).toBe("b");
    expect(m.size).toBe(2);
  });

  it("supports tokens containing colons (splits on first only)", () => {
    const m = parseAgentTokens("bot:tok:with:colons");
    expect(m.get("tok:with:colons")).toBe("bot");
  });
});

describe("resolvePrincipal", () => {
  const tokens = parseAgentTokens("desk-claude:tok_abc");

  it("resolves a known bearer token to its name", () => {
    expect(resolvePrincipal("Bearer tok_abc", tokens)).toBe("desk-claude");
  });

  it("treats missing, malformed, and unknown tokens as anonymous", () => {
    expect(resolvePrincipal(undefined, tokens)).toBe("anonymous");
    expect(resolvePrincipal("Basic xyz", tokens)).toBe("anonymous");
    expect(resolvePrincipal("Bearer wrong", tokens)).toBe("anonymous");
  });
});
