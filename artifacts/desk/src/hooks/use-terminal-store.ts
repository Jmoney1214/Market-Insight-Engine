import { create } from "zustand";
import { persist } from "zustand/middleware";
import { GetCopilotEventSource } from "@workspace/api-client-react";

interface TerminalState {
  symbol: string;
  source: GetCopilotEventSource;
  setSymbol: (s: string) => void;
  setSource: (s: GetCopilotEventSource) => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      symbol: "AAPL",
      source: "alpaca_live",
      setSymbol: (s) => set({ symbol: s }),
      setSource: (s) => set({ source: s }),
    }),
    {
      name: "terminal-settings",
      version: 1,
      migrate: (persistedState) => ({
        ...(persistedState as Partial<TerminalState>),
        source: "alpaca_live" as const,
      }),
    }
  )
);
