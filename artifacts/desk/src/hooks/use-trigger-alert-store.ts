import { create } from "zustand";
import type { TriggerAlert } from "@/lib/trigger-alerts";

// Ephemeral UI state for the live trigger banner. Holds the queue of pending
// banner alerts and which trigger (if any) is currently focused in the live
// board. This is purely presentational — it never drives any order/position.

const MAX_ALERTS = 4;

interface TriggerAlertState {
  /** Pending banner alerts, most-recent last. Capped at MAX_ALERTS. */
  alerts: TriggerAlert[];
  /** Name of the trigger the user clicked through to, or null. */
  focusedTrigger: string | null;

  /** Enqueue freshly fired alerts, de-duplicated by trigger name. */
  pushAlerts: (alerts: TriggerAlert[]) => void;
  /** Remove a single alert from the queue (e.g. after it is clicked). */
  dismissAlert: (name: string) => void;
  /** Drop every pending alert (e.g. on a stream change). */
  clearAlerts: () => void;
  /** Focus (or clear) a trigger so the live board expands its detail. */
  focusTrigger: (name: string | null) => void;
}

export const useTriggerAlertStore = create<TriggerAlertState>()((set) => ({
  alerts: [],
  focusedTrigger: null,

  pushAlerts: (incoming) =>
    set((s) => {
      if (incoming.length === 0) return s;
      const seen = new Set(s.alerts.map((a) => a.name));
      const merged = [...s.alerts];
      for (const a of incoming) {
        if (seen.has(a.name)) {
          // Replace any stale copy with the latest detail/level.
          const idx = merged.findIndex((m) => m.name === a.name);
          if (idx >= 0) merged[idx] = a;
        } else {
          seen.add(a.name);
          merged.push(a);
        }
      }
      return { alerts: merged.slice(-MAX_ALERTS) };
    }),

  dismissAlert: (name) =>
    set((s) => ({ alerts: s.alerts.filter((a) => a.name !== name) })),

  clearAlerts: () => set({ alerts: [] }),

  focusTrigger: (name) => set({ focusedTrigger: name }),
}));
