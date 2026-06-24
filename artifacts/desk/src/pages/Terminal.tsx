import { 
  useGetCopilotEvent, 
  useExplainCopilotEvent,
  useCopilotHealthCheck,
  getGetCopilotEventQueryKey,
  getExplainCopilotEventQueryKey,
  getCopilotHealthCheckQueryKey
} from "@workspace/api-client-react";
import { useTerminalStore } from "@/hooks/use-terminal-store";

import { LiveBoardPanel } from "@/components/LiveBoardPanel";
import { FinalReadPanel } from "@/components/FinalReadPanel";
import { AnalystCommitteePanel } from "@/components/AnalystCommitteePanel";
import { FeedQualityPanel } from "@/components/FeedQualityPanel";
import { PositionPanel } from "@/components/PositionPanel";
import { HistoryLogPanel } from "@/components/HistoryLogPanel";
import { ChartPanel } from "@/components/ChartPanel";

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
    query: { queryKey: getCopilotHealthCheckQueryKey(), refetchInterval: 30000 }
  });

  return (
    <div className="h-screen w-full bg-background text-foreground flex flex-col overflow-hidden font-sans">
      <header className="h-12 border-b border-border bg-card/50 flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="font-mono font-bold text-sm tracking-tight">TRADING DESK COPILOT</div>
          <div className="bg-primary/20 text-primary border border-primary/30 px-2 py-0.5 rounded text-xs font-mono font-medium">RESEARCH</div>
          <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Research Only — Not Trading Advice</div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <select 
              className="bg-card border border-border rounded px-2 py-1 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
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
            >
              <option value="fixture">FIXTURE</option>
              <option value="yahoo_delayed">DELAYED</option>
            </select>
          </div>

          <div className="flex items-center gap-3 border-l border-border pl-4">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${health?.status === 'ok' ? 'bg-success' : 'bg-warning animate-pulse'}`} />
              <span className="text-xs font-mono text-muted-foreground">SYS</span>
            </div>
            {explain?.provider && (
              <div className="text-xs font-mono text-muted-foreground border border-border px-1.5 py-0.5 rounded bg-muted/20">
                {explain.provider}
                {explain.degraded && <span className="ml-1 text-warning">(! DEGRADED)</span>}
              </div>
            )}
          </div>
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
    </div>
  );
}
