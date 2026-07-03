// Unit tests for the pure provider-selection and model-tiering logic. These
// never make a live AI call — they only assert the env-gated routing decisions.

import { describe, it, expect } from "vitest";
import {
  selectProviderId,
  selectModelTier,
  PROVIDER_PREFERENCE,
  type LlmProviderId,
} from "./index";

const NONE: Record<LlmProviderId, boolean> = {
  openai: false,
  gemini: false,
  anthropic: false,
};

describe("selectProviderId — auto selection (no explicit request)", () => {
  it("returns null when nothing is configured (deterministic default)", () => {
    expect(selectProviderId({ configured: { ...NONE } })).toBeNull();
  });

  it("prefers OpenAI when multiple providers are configured", () => {
    expect(
      selectProviderId({
        configured: { openai: true, gemini: true, anthropic: true },
      }),
    ).toBe("openai");
  });

  it("falls through the preference order to the first configured provider", () => {
    expect(
      selectProviderId({ configured: { ...NONE, gemini: true, anthropic: true } }),
    ).toBe("gemini");
    expect(
      selectProviderId({ configured: { ...NONE, anthropic: true } }),
    ).toBe("anthropic");
  });

  it("matches the documented preference order", () => {
    expect(PROVIDER_PREFERENCE).toEqual(["openai", "gemini", "anthropic"]);
  });
});

describe("selectProviderId — explicit request", () => {
  it("honors an explicit request when that provider is configured", () => {
    expect(
      selectProviderId({
        requested: "anthropic",
        configured: { openai: true, gemini: false, anthropic: true },
      }),
    ).toBe("anthropic");
  });

  it("is case/whitespace insensitive", () => {
    expect(
      selectProviderId({
        requested: "  Gemini ",
        configured: { ...NONE, gemini: true },
      }),
    ).toBe("gemini");
  });

  it("fails closed to null when the requested provider is NOT configured", () => {
    // Explicit intent is never silently redirected to a different provider.
    expect(
      selectProviderId({
        requested: "gemini",
        configured: { openai: true, gemini: false, anthropic: false },
      }),
    ).toBeNull();
  });

  it("returns null for an unknown provider name", () => {
    expect(
      selectProviderId({
        requested: "llama",
        configured: { openai: true, gemini: true, anthropic: true },
      }),
    ).toBeNull();
  });
});

describe("selectModelTier — quick for routine, deep for escalations", () => {
  it("uses the quick model for routine, low-severity events", () => {
    expect(selectModelTier({ alertLevel: null, l5Blocked: false })).toBe("quick");
    expect(selectModelTier({ alertLevel: "L1", l5Blocked: false })).toBe("quick");
    expect(selectModelTier({ alertLevel: "L3", l5Blocked: false })).toBe("quick");
  });

  it("escalates to the deep model for high alert levels", () => {
    expect(selectModelTier({ alertLevel: "L4", l5Blocked: false })).toBe("deep");
    expect(selectModelTier({ alertLevel: "L5", l5Blocked: false })).toBe("deep");
  });

  it("escalates to the deep model whenever the event is hard-blocked", () => {
    expect(selectModelTier({ alertLevel: "L1", l5Blocked: true })).toBe("deep");
  });
});
