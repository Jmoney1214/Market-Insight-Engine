import { afterEach, describe, expect, it, vi } from "vitest";

function memoryStorage(initial: Record<string, string>): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

async function hydrateTerminalStore(persisted: object) {
  vi.resetModules();
  const localStorage = memoryStorage({
    "terminal-settings": JSON.stringify(persisted),
  });
  vi.stubGlobal("window", { localStorage });
  return (await import("./use-terminal-store")).useTerminalStore.getState();
}

describe("terminal settings persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("migrates a legacy fixture source to the live SIP source", async () => {
    const state = await hydrateTerminalStore({
      state: { symbol: "MSFT", source: "fixture" },
      version: 0,
    });

    expect(state.symbol).toBe("MSFT");
    expect(state.source).toBe("alpaca_live");
  });

  it("preserves a current persisted live source", async () => {
    const state = await hydrateTerminalStore({
      state: { symbol: "NVDA", source: "alpaca_live" },
      version: 1,
    });

    expect(state.symbol).toBe("NVDA");
    expect(state.source).toBe("alpaca_live");
  });
});
