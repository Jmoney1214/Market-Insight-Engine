import { useEffect, useRef, type MutableRefObject } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import {
  useGetCopilotEvent,
  useExplainCopilotEvent,
  useGetReplaySession,
  useGetReplayEvent,
  useExplainReplayEvent,
  useCopilotHealthCheck,
  getCopilotEvent,
  explainCopilotEvent,
  explainReplayEvent,
  createIdempotentExecution,
  type IdempotentExecution,
  getGetCopilotEventQueryKey,
  getExplainCopilotEventQueryKey,
  getGetReplaySessionQueryKey,
  getGetReplayEventQueryKey,
  getExplainReplayEventQueryKey,
  getCopilotHealthCheckQueryKey,
} from "@workspace/api-client-react";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useReplayStore } from "@/hooks/use-replay-store";
import { useTriggerAlerts } from "@/hooks/use-trigger-alerts";

import { LiveBoardPanel } from "@/components/LiveBoardPanel";
import { SymbolPicker } from "@/components/SymbolPicker";
import { TriggerBanner } from "@/components/TriggerBanner";
import { FinalReadPanel } from "@/components/FinalReadPanel";
import { AnalystCommitteePanel } from "@/components/AnalystCommitteePanel";
import { FeedQualityPanel } from "@/components/FeedQualityPanel";
import { PositionPanel } from "@/components/PositionPanel";
import { HistoryLogPanel } from "@/components/HistoryLogPanel";
import { ChartPanel } from "@/components/ChartPanel";
import { ReplayBar } from "@/components/ReplayBar";
import { MeasurementDrawer } from "@/components/MeasurementDrawer";
import { useAuth } from "@/auth/AuthProvider";

const MODES = ["LIVE", "REPLAY", "RESEARCH"] as const;

type ExecutionSlot = {
  scope: string;
  execution: IdempotentExecution;
};

function executionForScope(
  slot: MutableRefObject<ExecutionSlot | null>,
  scope: string,
): IdempotentExecution {
  if (!slot.current || slot.current.scope !== scope) {
    slot.current = { scope, execution: createIdempotentExecution() };
  }
  return slot.current.execution;
}

export default function Terminal() {
  const { state: authState, logout } = useAuth();
  const { symbol, setSymbol, setSource } = useTerminalStore();
  const {
    mode: deskMode,
    date,
    availableDates,
    step,
    totalSteps,
    playing,
    speed,
    setMode,
    loadSession,
    setDate,
    clearSession,
    stepForward,
  } = useReplayStore();

  const isReplay = deskMode === "REPLAY";
  const isHistorical = deskMode === "REPLAY" || deskMode === "RESEARCH";
  const eventExecutionSlot = useRef<ExecutionSlot | null>(null);
  const explainExecutionSlot = useRef<ExecutionSlot | null>(null);
  const replayExplainExecutionSlot = useRef<ExecutionSlot | null>(null);

  // Task 6 will populate these identifiers from the canonical brain case
  // selector. Until then an operator may open an exact case-bound link. Empty
  // identifiers deliberately disable historical requests instead of falling
  // back to a bundled fixture or guessing a revision.
  const locationParams = new URLSearchParams(window.location.search);
  const caseRevisionId = locationParams.get("caseRevisionId")?.trim() ?? "";
  const evidenceHash = locationParams.get("evidenceHash")?.trim() ?? "";
  const historicalCaseBound = caseRevisionId.length > 0 && evidenceHash.length > 0;

  // --- Replay session: load metadata for the active symbol when in REPLAY. ---
  const replaySessionParams = { symbol, caseRevisionId, evidenceHash };
  const { data: replaySession, error: replaySessionError } =
    useGetReplaySession(replaySessionParams, {
      query: {
        enabled: isReplay && !!symbol && historicalCaseBound,
        queryKey: getGetReplaySessionQueryKey(replaySessionParams),
        // Canonical case revisions are immutable, so metadata never changes. Pin it
        // as permanently fresh and skip focus refetches; otherwise a refetch
        // would hand back a new object identity and the effect below would
        // rewind an in-progress replay back to step 0.
        staleTime: Infinity,
        refetchOnWindowFocus: false,
      },
    });

  useEffect(() => {
    if (!isReplay) return;
    if (replaySession) {
      loadSession({
        date: replaySession.date,
        totalSteps: replaySession.totalSteps,
        availableDates: replaySession.availableDates,
      });
    } else if (replaySessionError) {
      clearSession();
    }
  }, [isReplay, replaySession, replaySessionError, loadSession, clearSession]);

  const replayReady = isReplay && totalSteps > 0 && !!date;

  // LIVE is always read-only Alpaca SIP. Historical modes are fail-closed at
  // the API until verified brain authorization and canonical cases ship.
  const deskParams = deskMode === "LIVE"
    ? { symbol, source: "alpaca_live" as const, mode: "LIVE" as const }
    : {
        symbol,
        source: "fixture" as const,
        mode: "RESEARCH" as const,
        caseRevisionId,
        evidenceHash,
      };
  const replayParams = {
    symbol,
    date: date ?? "",
    step,
    caseRevisionId,
    evidenceHash,
  };
  const deskExecutionScope = JSON.stringify(deskParams);
  const replayExecutionScope = JSON.stringify(replayParams);
  const eventExecution = executionForScope(
    eventExecutionSlot,
    deskExecutionScope,
  );
  const explainExecution = executionForScope(
    explainExecutionSlot,
    deskExecutionScope,
  );
  const replayExplainExecution = executionForScope(
    replayExplainExecutionSlot,
    replayExecutionScope,
  );

  const deskEvent = useGetCopilotEvent(deskParams, {
    query: {
      enabled: !isReplay && !!symbol && (!isHistorical || historicalCaseBound),
      queryKey: getGetCopilotEventQueryKey(deskParams),
      refetchInterval: deskMode === "LIVE" ? 10000 : false,
      queryFn: ({ signal }) =>
        eventExecution.run((idempotencyKey) =>
          getCopilotEvent(deskParams, {
            signal,
            headers: { "Idempotency-Key": idempotencyKey },
          }),
        ),
    },
  });
  const replayEvent = useGetReplayEvent(replayParams, {
    query: {
      enabled: replayReady,
      queryKey: getGetReplayEventQueryKey(replayParams),
      // Keep the prior bar's read on screen while the next step loads so the
      // deterministic panels update smoothly instead of blanking each step.
      placeholderData: keepPreviousData,
    },
  });

  const deskExplain = useExplainCopilotEvent(deskParams, {
    query: {
      enabled: !isReplay && !!symbol && (!isHistorical || historicalCaseBound),
      queryKey: getExplainCopilotEventQueryKey(deskParams),
      queryFn: ({ signal }) =>
        explainExecution.run((idempotencyKey) =>
          explainCopilotEvent(deskParams, {
            signal,
            headers: { "Idempotency-Key": idempotencyKey },
          }),
        ),
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  });
  const replayExplain = useExplainReplayEvent(replayParams, {
    query: {
      // The committee read is a real (~10s) AI call. Suspend it during active
      // playback so we don't spawn one abandoned request per bar; it resumes
      // for the settled step the moment playback pauses.
      enabled: replayReady && !playing,
      queryKey: getExplainReplayEventQueryKey(replayParams),
      queryFn: ({ signal }) =>
        replayExplainExecution.run((idempotencyKey) =>
          explainReplayEvent(replayParams, {
            signal,
            headers: { "Idempotency-Key": idempotencyKey },
          }),
        ),
      placeholderData: keepPreviousData,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  });

  const event = isReplay ? replayEvent.data : deskEvent.data;
  const eventLoading = isReplay ? replayEvent.isLoading : deskEvent.isLoading;
  const eventError = isReplay ? replayEvent.error : deskEvent.error;

  const explain = isReplay ? replayExplain.data : deskExplain.data;
  const explainLoading = isReplay
    ? replayExplain.isLoading
    : deskExplain.isLoading;
  const explainError = isReplay ? replayExplain.error : deskExplain.error;

  // --- Transport clock: advance one bar per tick while playing. ---
  const stepForwardRef = useRef(stepForward);
  stepForwardRef.current = stepForward;
  useEffect(() => {
    if (!isReplay || !playing || totalSteps === 0) return;
    const id = window.setInterval(
      () => stepForwardRef.current(),
      Math.max(50, 1000 / speed),
    );
    return () => window.clearInterval(id);
  }, [isReplay, playing, speed, totalSteps]);

  const { data: health } = useCopilotHealthCheck({
    query: { queryKey: getCopilotHealthCheckQueryKey(), refetchInterval: 30000 },
  });

  const currentMode = event?.mode ?? deskMode;
  const replayUnavailable = isReplay && (!historicalCaseBound || !!replaySessionError);

  // Live trigger banner. The stream key intentionally excludes the replay step
  // so stepping diffs against the prior bar; symbol/mode/date/source changes
  // reset the baseline.
  const streamKey = `${symbol}:${currentMode}:${isReplay ? date ?? "" : deskParams.source}`;
  useTriggerAlerts(event, streamKey);

  const headerDate = event?.timestamp ? new Date(event.timestamp) : null;
  const headerTime =
    headerDate && !isNaN(headerDate.getTime())
      ? headerDate.toLocaleTimeString()
      : "--:--:--";
  const currentBarTime = replaySession
    ? replaySession.startTime + step * replaySession.barSeconds
    : null;

  const aiStatus = explainLoading
    ? "THINKING"
    : explainError
    ? "OFFLINE"
    : explain?.degraded
    ? "DEGRADED"
    : explain?.provider
    ? explain.provider.toUpperCase()
    : "READY";

  const selectMode = (m: (typeof MODES)[number]) => {
    if (m === "REPLAY") {
      setMode("REPLAY");
    } else if (m === "RESEARCH") {
      setMode("RESEARCH");
    } else {
      setSource("alpaca_live");
      setMode("LIVE");
    }
  };

  return (
    <div className="h-screen w-full bg-background text-foreground flex flex-col overflow-hidden font-sans">
      <TriggerBanner />
      <header className="h-12 border-b border-border bg-card/50 flex items-center px-4 justify-between shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="font-mono font-bold text-sm tracking-tight whitespace-nowrap">
            TRADING DESK COPILOT
          </div>

          {/* All modes are research-only; LIVE never exposes broker execution. */}
          <div className="flex items-center rounded border border-border overflow-hidden font-mono text-[10px]">
            {MODES.map((m, i) => {
              const active = m === currentMode;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => selectMode(m)}
                  title={
                    m === "LIVE"
                      ? "LIVE read-only market research (Alpaca SIP)"
                      : `${m} historical brain mode`
                  }
                  className={`px-2 py-0.5 ${
                    i < MODES.length - 1 ? "border-r border-border" : ""
                  } ${
                    active
                      ? "bg-primary/20 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>

          <div className="hidden lg:block text-[10px] text-muted-foreground font-mono uppercase tracking-wider whitespace-nowrap">
            Research Only — Not Trading Advice
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {authState.status === "authenticated" ? (
            <div className="hidden xl:flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span title="Verified human principal">
                {authState.principal.principal.subject}
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded border border-border px-1.5 py-0.5 hover:text-foreground"
              >
                LOG OUT
              </button>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <SymbolPicker
              symbol={symbol}
              onChange={setSymbol}
            />

            {isReplay ? (
              <select
                className="bg-card border border-border rounded px-2 py-1 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
                value={date ?? ""}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Replay date"
                disabled={availableDates.length === 0}
                title={
                  availableDates.length === 0
                    ? "No replayable sessions for this symbol"
                    : "Historical session date to replay"
                }
              >
                {availableDates.length === 0 ? (
                  <option value="">NO SESSION</option>
                ) : (
                  availableDates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))
                )}
              </select>
            ) : (
              <span
                className="bg-card border border-border rounded px-2 py-1 text-xs font-mono text-muted-foreground"
                title={isHistorical ? "Canonical historical brain source" : "Read-only Alpaca SIP market data"}
              >
                {isHistorical
                  ? historicalCaseBound
                    ? "HISTORICAL BRAIN"
                    : "CASE REQUIRED"
                  : "ALPACA SIP"}
              </span>
            )}
          </div>

          {/* Timestamp + source badge */}
          <div className="hidden md:flex items-center gap-2 border-l border-border pl-3 font-mono text-[10px]">
            <span className="text-muted-foreground tabular-nums" title="Event timestamp">
              {headerTime}
            </span>
            <span className="border border-border px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground uppercase">
              SRC · {(event?.dataSource ?? (isHistorical ? "historical" : "alpaca_live")).toString().replace(/_/g, " ")}
            </span>
            {isHistorical ? (
              <span className="border border-primary/40 px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                HISTORICAL
              </span>
            ) : null}
          </div>

          {/* System + AI status */}
          <div className="flex items-center gap-2 border-l border-border pl-3 font-mono text-[10px]">
            <span className="flex items-center gap-1.5" title="System status">
              <span
                className={`w-2 h-2 rounded-full ${
                  health?.status === "ok" ? "bg-success" : "bg-warning animate-pulse"
                }`}
              />
              <span className="text-muted-foreground">SYS</span>
            </span>
            <span
              className={`flex items-center gap-1.5 border px-1.5 py-0.5 rounded ${
                aiStatus === "DEGRADED" || aiStatus === "OFFLINE"
                  ? "border-warning/40 text-warning bg-warning/10"
                  : "border-border text-muted-foreground bg-muted/20"
              }`}
              title="AI committee status"
            >
              AI · {aiStatus}
            </span>
          </div>

          {/* Replay status badge */}
          <span
            className={`font-mono text-[10px] border px-1.5 py-0.5 rounded ${
              isReplay
                ? "border-primary/40 text-primary bg-primary/10"
                : "border-dashed border-border text-muted-foreground/50"
            }`}
            title={
              isReplay
                ? "Replay mode active — research/practice only"
                : "Replay mode off — click REPLAY to enable"
            }
          >
            ⏵ REPLAY · {isReplay ? "ON" : "OFF"}
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-2 grid grid-cols-12 grid-rows-12 gap-2">
        {/* Left Column: Live Board & Feed Quality */}
        <div className="col-span-3 row-span-12 flex flex-col gap-2">
          <div className="flex-1 terminal-panel">
            <div className="terminal-panel-header">LIVE BOARD</div>
            <LiveBoardPanel
              event={event}
              recommendation={explain?.dashboardRead?.recommendation}
              isLoading={eventLoading}
              isError={!!eventError}
            />
          </div>
          <div className="h-64 terminal-panel shrink-0">
            <div className="terminal-panel-header">FEED QUALITY</div>
            <FeedQualityPanel event={event} isLoading={eventLoading} isError={!!eventError} />
          </div>
        </div>

        {/* Middle Column: Chart & Committee */}
        <div className="col-span-6 row-span-12 flex flex-col gap-2">
          <div className="flex-1 terminal-panel">
            <div className="terminal-panel-header">PRICE ACTION</div>
            <div className="terminal-panel-content p-0">
              <ChartPanel event={event} isLoading={eventLoading} isError={!!eventError} />
            </div>
          </div>
          <div className="h-80 terminal-panel shrink-0">
            <div className="terminal-panel-header">ANALYST COMMITTEE</div>
            <div className="terminal-panel-content p-0">
              <AnalystCommitteePanel explain={explain} isLoading={explainLoading} isError={!!explainError} />
            </div>
          </div>
        </div>

        {/* Right Column: Final Read, Position, History */}
        <div className="col-span-3 row-span-12 flex flex-col gap-2">
          <div className="h-64 terminal-panel shrink-0">
            <div className="terminal-panel-header">FINAL READ</div>
            <div className="terminal-panel-content p-0">
              <FinalReadPanel explain={explain} isLoading={explainLoading} isError={!!explainError} />
            </div>
          </div>
          <div className="h-72 terminal-panel shrink-0">
            <div className="terminal-panel-header">POSITION</div>
            <div className="terminal-panel-content p-0">
              <PositionPanel event={event} />
            </div>
          </div>
          <div className="flex-1 terminal-panel min-h-0">
            <div className="terminal-panel-header">HISTORY LOG</div>
            <div className="terminal-panel-content p-0">
              <HistoryLogPanel />
            </div>
          </div>
        </div>
      </main>

      {/* Footer: replay transport + measurement subsystem drawer triggers. */}
      <footer className="h-9 border-t border-border bg-card/50 flex items-center px-4 justify-between shrink-0 font-mono text-[10px] gap-4">
        {isReplay ? (
          <ReplayBar
            sessionDate={date}
            currentBarTime={currentBarTime}
            isLoading={eventLoading}
            unavailable={replayUnavailable}
          />
        ) : (
          <button
            type="button"
            onClick={() => selectMode("REPLAY")}
            className="flex items-center gap-2 text-muted-foreground/70 hover:text-foreground transition-colors"
            title="Enter replay mode"
          >
            <span className="uppercase tracking-wider">Replay</span>
            <span className="flex items-center gap-0.5">
              <span className="border border-border rounded px-1 py-0.5">⏮</span>
              <span className="border border-border rounded px-1 py-0.5">⏵</span>
              <span className="border border-border rounded px-1 py-0.5">⏭</span>
            </span>
            <span className="border border-border rounded px-1.5 py-0.5">ENTER REPLAY</span>
          </button>
        )}

        <MeasurementDrawer event={event} />
      </footer>
    </div>
  );
}
