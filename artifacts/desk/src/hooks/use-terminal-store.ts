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
      source: "fixture",
      setSymbol: (s) => set({ symbol: s }),
      setSource: (s) => set({ source: s }),
    }),
    {
      name: "terminal-settings",
    }
  )
);
