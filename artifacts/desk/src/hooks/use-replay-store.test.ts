import { beforeEach, describe, expect, it } from "vitest";
import {
  replayInitialState,
  useReplayStore,
  type ReplaySpeed,
} from "./use-replay-store";

const get = () => useReplayStore.getState();
// Merge (not replace) so the action functions on the store are preserved.
const reset = () => useReplayStore.setState(replayInitialState);

describe("replay transport store", () => {
  beforeEach(() => {
    reset();
  });

  it("starts in RESEARCH with no session loaded", () => {
    expect(get().mode).toBe("RESEARCH");
    expect(get().totalSteps).toBe(0);
    expect(get().step).toBe(0);
    expect(get().playing).toBe(false);
  });

  it("enters and exits replay mode", () => {
    get().enterReplay();
    expect(get().mode).toBe("REPLAY");
    get().exitReplay();
    expect(get().mode).toBe("RESEARCH");
    expect(get().playing).toBe(false);
  });

  it("loads a session at step 0, paused", () => {
    get().loadSession({ date: "2024-06-03", totalSteps: 80 });
    expect(get().date).toBe("2024-06-03");
    expect(get().totalSteps).toBe(80);
    expect(get().step).toBe(0);
    expect(get().playing).toBe(false);
  });

  it("steps forward and back within bounds", () => {
    get().loadSession({ date: "2024-06-03", totalSteps: 80 });
    get().stepForward();
    get().stepForward();
    expect(get().step).toBe(2);
    get().stepBack();
    expect(get().step).toBe(1);
    get().stepBack();
    get().stepBack();
    expect(get().step).toBe(0);
  });

  it("clamps stepForward at the last step and auto-pauses there", () => {
    get().loadSession({ date: "2024-06-03", totalSteps: 3 });
    get().play();
    expect(get().playing).toBe(true);
    get().stepForward(); // -> 1
    expect(get().step).toBe(1);
    expect(get().playing).toBe(true);
    get().stepForward(); // -> 2 (last) -> auto-pause
    expect(get().step).toBe(2);
    expect(get().playing).toBe(false);
    get().stepForward(); // stays clamped
    expect(get().step).toBe(2);
  });

  it("setStep clamps and trims to an in-range integer, pausing", () => {
    get().loadSession({ date: "2024-06-03", totalSteps: 10 });
    get().setStep(99);
    expect(get().step).toBe(9);
    get().setStep(-5);
    expect(get().step).toBe(0);
    get().setStep(3.9);
    expect(get().step).toBe(3);
    expect(get().playing).toBe(false);
  });

  it("play from the end restarts at step 0", () => {
    get().loadSession({ date: "2024-06-03", totalSteps: 5 });
    get().setStep(4);
    get().play();
    expect(get().step).toBe(0);
    expect(get().playing).toBe(true);
  });

  it("stop resets to step 0 and pauses", () => {
    get().loadSession({ date: "2024-06-03", totalSteps: 5 });
    get().setStep(3);
    get().play();
    get().stop();
    expect(get().step).toBe(0);
    expect(get().playing).toBe(false);
  });

  it("is inert with no replayable session (e.g. NODATA)", () => {
    get().clearSession();
    get().play();
    expect(get().playing).toBe(false);
    get().stepForward();
    expect(get().step).toBe(0);
  });

  it("sets playback speed", () => {
    for (const s of [1, 5, 10, 30] as ReplaySpeed[]) {
      get().setSpeed(s);
      expect(get().speed).toBe(s);
    }
  });

  it("togglePlay flips playback and respects no-session", () => {
    get().clearSession();
    get().togglePlay();
    expect(get().playing).toBe(false);
    get().loadSession({ date: "2024-06-03", totalSteps: 5 });
    get().togglePlay();
    expect(get().playing).toBe(true);
    get().togglePlay();
    expect(get().playing).toBe(false);
  });
});
