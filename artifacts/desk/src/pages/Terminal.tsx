import {
  useGetCopilotEvent,
  useExplainCopilotEvent,
  useCopilotHealthCheck,
  getGetCopilotEventQueryKey,
  getExplainCopilotEventQueryKey,
  getCopilotHealthCheckQueryKey,
} from "@workspace/api-client-react";
import { useTerminalStore } from "@/hooks/use-terminal-store";

import { LiveBoardPanel } from "@/components/LiveBoardPanel";
import { FinalReadPanel } from "@/components/FinalReadPanel";
import { AnalystCommitteePanel } from "@/components/AnalystCommitteePanel";
import { FeedQualityPanel } from "@/components/FeedQualityPanel";
import { PositionPanel } from "@/components/PositionPanel";
import { HistoryLogPanel } from "@/components/HistoryLogPanel";
import { ChartPanel } from "@/components/ChartPanel";

const MODES = ["LIVE", "REPLAY", "RESEARCH"] as const;
// Only RESEARCH mode is shipped today. LIVE is intentionally never built
// (permanent no-trading constraint); REPLAY arrives in a later phase.
const AVAILABLE_MODES = new Set(["RESEARCH"]);

const PHASE6_PANELS = ["STRATEGY LAB", "EDGE SCOREBOARD", "JOURNAL"] as const;

export default function Terminal() {
  const { symbol, source, setSymbol, setSource } = useTerminalStore();

  const eventParams = { symbol, source, mode: "RESEARCH" as const };

  const { data: event, isLoading: eventLoading, error: eventError } = useGetCopilotEvent(
    eventParams,
    { query: { enabled: !!symbol, queryKey: getGetCopilotEventQueryKey(eventParams), refetchInterval: 10000 } }
  );

  const { data: explain, isLoading: explainLoading, error: explainError } = useExplainCopilotEvent(
    eventParams,
    { query: { enabled: !!symbol, queryKey: getExplainCopilotEventQueryKey(eventParams), staleTime: 5 * 60 * 1000, gcTime: 10 * 60 * 1000 } }
  );

  const { data: health } = useCopilotHealthCheck({
    query: { queryKey: getCopilotHealthCheckQueryKey(), refetchInterval: 30000 },
  });

  const currentMode = event?.mode ?? "RESEARCH";

  const headerDate = event?.timestamp ? new Date(event.timestamp) : null;
  const headerTime =
    headerDate && !isNaN(headerDate.getTime()) ? headerDate.toLocaleTimeString() : "--:--:--";

  const aiStatus = explainLoading
    ? "THINKING"
    : explainError
    ? "OFFLINE"
    : explain?.degraded
    ? "DEGRADED"
    : explain?.provider
    ? explain.provider.toUpperCase()
    : "READY";

  return (
    <div className="h-screen w-full bg-background text-foreground flex flex-col overflow-hidden font-sans">
      <header className="h-12 border-b border-border bg-card/50 flex items-center px-4 justify-between shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="font-mono font-bold text-sm tracking-tight whitespace-nowrap">
            TRADING DESK COPILOT
          </div>

          {/* Mode context: LIVE / REPLAY / RESEARCH. Only RESEARCH is active. */}
          <div className="flex items-center rounded border border-border overflow-hidden font-mono text-[10px]">
            {MODES.map((m, i) => {
              const active = m === currentMode;
              const available = AVAILABLE_MODES.has(m);
              return (
                <span
                  key={m}
                  title={available ? `${m} mode` : `${m} mode — coming in a later phase`}
                  className={`px-2 py-0.5 ${i < MODES.length - 1 ? "border-r border-border" : ""} ${
                    active
                      ? "bg-primary/20 text-primary font-medium"
                      : available
                      ? "text-muted-foreground"
                      : "text-muted-foreground/40"
                  }`}
                >
                  {m}
                </span>
              );
            })}
          </div>

          <div className="hidden lg:block text-[10px] text-muted-foreground font-mono uppercase tracking-wider whitespace-nowrap">
            Research Only — Not Trading Advice
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <select
              className="bg-card border border-border rounded px-2 py-1 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              aria-label="Symbol"
            >
              <option value="AAPL">AAPL</option>
              <option value="MSFT">MSFT</option>
              <option value="TSLA">TSLA</option>
              <option value="NODATA">NODATA</option>
            </select>

            <select
              className="bg-card border border-border rounded px-2 py-1 text-sm font-mono text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={source}
              onChange={(e) => setSource(e.target.value as any)}
              aria-label="Data source"
            >
              <option value="fixture">FIXTURE</option>
              <option value="yahoo_delayed">DELAYED</option>
            </select>
          </div>

          {/* Timestamp + source badge */}
          <div className="hidden md:flex items-center gap-2 border-l border-border pl-3 font-mono text-[10px]">
            <span className="text-muted-foreground tabular-nums" title="Event timestamp">
              {headerTime}
            </span>
            <span className="border border-border px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground uppercase">
              SRC · {(event?.dataSource ?? source).toString().replace(/_/g, " ")}
            </span>
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

          {/* Replay placeholder badge */}
          <span
            className="font-mono text-[10px] border border-dashed border-border px-1.5 py-0.5 rounded text-muted-foreground/50"
            title="Replay mode — coming in a later phase"
          >
            ⏵ REPLAY · OFF
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
              <PositionPanel />
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

      {/* Footer: out-of-scope placeholders, clearly marked (Phase 5 / Phase 6) */}
      <footer className="h-9 border-t border-border bg-card/50 flex items-center px-4 justify-between shrink-0 font-mono text-[10px]">
        <div className="flex items-center gap-2 text-muted-foreground/60" title="Replay controls — coming in a later phase">
          <span className="uppercase tracking-wider">Replay</span>
          <div className="flex items-center gap-0.5 opacity-50 pointer-events-none select-none" aria-hidden="true">
            <span className="border border-border rounded px-1 py-0.5">⏮</span>
            <span className="border border-border rounded px-1 py-0.5">⏵</span>
            <span className="border border-border rounded px-1 py-0.5">⏭</span>
          </div>
          <span className="border border-dashed border-border rounded px-1.5 py-0.5">PHASE 5 · COMING SOON</span>
        </div>

        <div className="flex items-center gap-2">
          {PHASE6_PANELS.map((label) => (
            <span
              key={label}
              title={`${label} — coming in a later phase`}
              className="border border-dashed border-border rounded px-2 py-0.5 text-muted-foreground/50 uppercase tracking-wider"
            >
              {label}
              <span className="ml-1 text-muted-foreground/40">· PHASE 6</span>
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
