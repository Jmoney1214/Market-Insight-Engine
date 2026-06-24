import { create } from "zustand";

// Client-side transport clock for REPLAY mode. The store holds ONLY ephemeral
// transport state (step, play/pause, speed). The actual deterministic events are
// fetched per step from the stateless replay API. This is a research/practice
// tool — it never executes, simulates, routes, or paper-trades anything.

export type DeskMode = "RESEARCH" | "REPLAY";

/** Playback speeds in bars per second. */
export const REPLAY_SPEEDS = [1, 5, 10, 30] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export interface ReplayState {
  mode: DeskMode;
  /** ISO date of the loaded session, or null when none is loaded. */
  date: string | null;
  /** Every ISO date the current symbol can be replayed for (date picker). */
  availableDates: string[];
  /** 0-based current step (0 .. totalSteps-1). */
  step: number;
  /** Total replayable steps; 0 means no replayable session loaded. */
  totalSteps: number;
  playing: boolean;
  speed: ReplaySpeed;

  enterReplay: () => void;
  exitReplay: () => void;
  loadSession: (session: {
    date: string;
    totalSteps: number;
    availableDates?: string[];
  }) => void;
  /** User picks a different historical date; restarts the session at step 0. */
  setDate: (date: string) => void;
  clearSession: () => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  stop: () => void;
  stepForward: () => void;
  stepBack: () => void;
  setStep: (n: number) => void;
  setSpeed: (speed: ReplaySpeed) => void;
}

export const replayInitialState = {
  mode: "RESEARCH" as DeskMode,
  date: null as string | null,
  availableDates: [] as string[],
  step: 0,
  totalSteps: 0,
  playing: false,
  speed: 5 as ReplaySpeed,
};

export const useReplayStore = create<ReplayState>()((set) => ({
  ...replayInitialState,

  enterReplay: () => set({ mode: "REPLAY" }),

  exitReplay: () => set({ mode: "RESEARCH", playing: false }),

  loadSession: ({ date, totalSteps, availableDates }) =>
    set((s) => ({
      date,
      totalSteps,
      availableDates: availableDates ?? s.availableDates,
      step: 0,
      playing: false,
    })),

  setDate: (date) => set({ date, step: 0, playing: false }),

  clearSession: () =>
    set({
      date: null,
      availableDates: [],
      totalSteps: 0,
      step: 0,
      playing: false,
    }),

  play: () =>
    set((s) => {
      if (s.totalSteps === 0) return s;
      // Restart from the beginning if parked at the end.
      if (s.step >= s.totalSteps - 1) return { step: 0, playing: true };
      return { playing: true };
    }),

  pause: () => set({ playing: false }),

  togglePlay: () =>
    set((s) => {
      if (s.totalSteps === 0) return s;
      if (s.playing) return { playing: false };
      if (s.step >= s.totalSteps - 1) return { step: 0, playing: true };
      return { playing: true };
    }),

  stop: () => set({ playing: false, step: 0 }),

  stepForward: () =>
    set((s) => {
      if (s.totalSteps === 0) return s;
      const last = s.totalSteps - 1;
      if (s.step >= last) return { playing: false };
      const next = s.step + 1;
      // Auto-pause once the clock reaches the final bar.
      return { step: next, playing: next < last ? s.playing : false };
    }),

  stepBack: () =>
    set((s) => ({ step: Math.max(0, s.step - 1), playing: false })),

  setStep: (n) =>
    set((s) => {
      if (s.totalSteps === 0) return { step: 0, playing: false };
      const clamped = Math.min(Math.max(0, Math.trunc(n)), s.totalSteps - 1);
      return { step: clamped, playing: false };
    }),

  setSpeed: (speed) => set({ speed }),
}));
