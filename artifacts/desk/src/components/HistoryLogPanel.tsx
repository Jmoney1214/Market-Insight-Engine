import { useListHistoryEvents, getListHistoryEventsQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useTerminalStore } from "@/hooks/use-terminal-store";

export function HistoryLogPanel() {
  const { data: events, isLoading, isError } = useListHistoryEvents({
    query: { queryKey: getListHistoryEventsQueryKey() }
  });
  const { toast } = useToast();
  const { setSymbol } = useTerminalStore();

  if (isLoading) {
    return (
      <div className="p-4 space-y-2 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 bg-muted/50 rounded w-full"></div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 text-destructive font-mono text-sm">
        FAILED TO LOAD HISTORY
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="p-4 text-muted-foreground font-mono text-sm text-center">
        NO HISTORY EVENTS
      </div>
    );
  }

  const handleJournal = () => {
    toast({ title: "Coming Soon", description: "Journaling is slated for a later phase." });
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-2 gap-2">
      {events.map((ev) => {
        const date = new Date(ev.createdAt);
        const timeStr = isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString();

        return (
          <div key={ev.id} className="border border-border bg-card rounded p-2 text-xs font-mono flex flex-col gap-2">
            <div className="flex justify-between items-center border-b border-border/50 pb-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">{ev.symbol}</span>
                <span className="text-muted-foreground">{timeStr}</span>
              </div>
              <div className="flex items-center gap-1">
                {ev.alertLevel && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                    {ev.alertLevel}
                  </Badge>
                )}
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-muted-foreground/30 text-muted-foreground">
                  {ev.mode}
                </Badge>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-muted-foreground truncate" title={ev.eventSnapshot?.triggerStack?.stackName}>
                {ev.eventSnapshot?.triggerStack?.stackName || "—"}
              </span>
              <span className={`font-bold ${
                ev.eventSnapshot?.feedQuality?.verdict === 'OK' ? 'text-success' : 'text-warning'
              }`}>
                {ev.eventSnapshot?.feedQuality?.verdict || "—"}
              </span>
            </div>

            <div className="flex gap-1 mt-1">
              <Button 
                variant="outline" 
                size="sm" 
                className="h-6 text-[10px] px-2 flex-1"
                onClick={() => {
                  if (ev.symbol) setSymbol(ev.symbol);
                }}
              >
                EXPLAIN
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-6 text-[10px] px-2 flex-1 border-primary/50 text-primary hover:bg-primary/10"
                onClick={handleJournal}
              >
                JOURNAL
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
