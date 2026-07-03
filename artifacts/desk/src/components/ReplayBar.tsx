import {
  REPLAY_SPEEDS,
  useReplayStore,
  type ReplaySpeed,
} from "@/hooks/use-replay-store";

interface ReplayBarProps {
  /** ISO date of the loaded replay session (null when none is replayable). */
  sessionDate: string | null;
  /** Epoch seconds of the bar at the current step, if known. */
  currentBarTime: number | null;
  isLoading: boolean;
  /** True when the active symbol has no replayable session (e.g. NODATA). */
  unavailable: boolean;
}

function fmtClock(epochSeconds: number | null): string {
  if (epochSeconds === null) return "--:--:--";
  const d = new Date(epochSeconds * 1000);
  return isNaN(d.getTime()) ? "--:--:--" : d.toLocaleTimeString();
}

export function ReplayBar({
  sessionDate,
  currentBarTime,
  isLoading,
  unavailable,
}: ReplayBarProps) {
  const {
    step,
    totalSteps,
    playing,
    speed,
    togglePlay,
    stepForward,
    stepBack,
    stop,
    setStep,
    setSpeed,
  } = useReplayStore();

  const hasSession = totalSteps > 0;
  const atStart = step <= 0;
  const atEnd = step >= totalSteps - 1;
  const disabled = unavailable || !hasSession;

  const btn =
    "border border-border rounded px-2 py-0.5 font-mono text-[11px] leading-none transition-colors hover:bg-muted/40 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed";

  return (
    <div className="flex items-center gap-3 w-full">
      <span className="uppercase tracking-wider text-primary font-medium shrink-0">
        Replay
      </span>

      {unavailable ? (
        <span className="text-warning/80">
          No replayable session for this symbol
        </span>
      ) : (
        <>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              className={btn}
              onClick={stepBack}
              disabled={disabled || atStart}
              title="Step back one bar"
              aria-label="Step back"
            >
              ⏮
            </button>
            <button
              type="button"
              className={`${btn} ${playing ? "bg-primary/20 text-primary" : ""}`}
              onClick={togglePlay}
              disabled={disabled}
              title={playing ? "Pause" : "Play"}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "⏸" : "⏵"}
            </button>
            <button
              type="button"
              className={btn}
              onClick={stepForward}
              disabled={disabled || atEnd}
              title="Step forward one bar"
              aria-label="Step forward"
            >
              ⏭
            </button>
            <button
              type="button"
              className={btn}
              onClick={stop}
              disabled={disabled || (atStart && !playing)}
              title="Stop and rewind to open"
              aria-label="Stop"
            >
              ⏹
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(0, totalSteps - 1)}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            disabled={disabled}
            className="flex-1 min-w-0 accent-primary h-1 cursor-pointer disabled:cursor-not-allowed"
            aria-label="Replay position"
          />

          <span className="tabular-nums text-muted-foreground shrink-0">
            {hasSession ? step + 1 : 0}/{totalSteps}
          </span>

          <span
            className="tabular-nums text-foreground shrink-0"
            title="Replay clock (session time)"
          >
            {isLoading ? "····" : fmtClock(currentBarTime)}
          </span>

          {sessionDate && (
            <span className="text-muted-foreground/70 shrink-0 hidden lg:inline">
              {sessionDate}
            </span>
          )}

          <div className="flex items-center gap-0.5 shrink-0">
            {REPLAY_SPEEDS.map((s: ReplaySpeed) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                disabled={disabled}
                className={`border border-border rounded px-1.5 py-0.5 leading-none transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  speed === s
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-muted/40"
                }`}
                title={`${s} bars / second`}
              >
                {s}x
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
