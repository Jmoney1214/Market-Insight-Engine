import { useQueryClient } from "@tanstack/react-query";
import {
  useListJournalEntries,
  getListJournalEntriesQueryKey,
  getGetScoreboardQueryKey,
  useCreateJournalEntry,
  type CopilotEvent,
  type JournalEntry,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { safeText } from "@/lib/safety";
import { MANUAL_ACTIONS, buildManualActionOutcome } from "@/lib/journal-actions";

interface JournalPanelProps {
  /** The active read; manual annotations are tagged against it. */
  event?: CopilotEvent;
}

interface ParsedOutcome {
  strategyName: string | null;
  outcomeConfidence: string | null;
  rMultiple: number | null;
  action: string | null;
}

function parseOutcome(raw: unknown): ParsedOutcome {
  const o =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    strategyName: typeof o.strategyName === "string" ? o.strategyName : null,
    outcomeConfidence:
      typeof o.outcomeConfidence === "string" ? o.outcomeConfidence : null,
    rMultiple:
      typeof o.rMultiple === "number" && Number.isFinite(o.rMultiple)
        ? o.rMultiple
        : null,
    action: typeof o.action === "string" ? o.action : null,
  };
}

function parseStack(raw: unknown): string | null {
  const snap =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ts =
    snap.triggerStack && typeof snap.triggerStack === "object"
      ? (snap.triggerStack as Record<string, unknown>)
      : {};
  return typeof ts.stackName === "string" ? ts.stackName : null;
}

const CONFIDENCE_CLASS: Record<string, string> = {
  MANUAL_CONFIRMED: "border-success/40 text-success bg-success/10",
  MANUAL_ESTIMATED: "border-primary/40 text-primary bg-primary/10",
  CURRENT_PRICE_ASSUMED: "border-warning/40 text-warning bg-warning/10",
  WATCH_ONLY: "border-border text-muted-foreground bg-muted/20",
  INVALID_SAMPLE: "border-destructive/40 text-destructive bg-destructive/10",
};

function EntryRow({ entry }: { entry: JournalEntry }) {
  const outcome = parseOutcome(entry.manualOutcome);
  const stack = outcome.strategyName ?? parseStack(entry.eventSnapshot);
  const date = new Date(entry.createdAt);
  const timeStr = isNaN(date.getTime())
    ? "--:--:--"
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  return (
    <div className="border border-border bg-card rounded p-2 text-[11px] font-mono space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-foreground">{entry.symbol}</span>
          <span className="text-muted-foreground">{timeStr}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {outcome.rMultiple !== null && (
            <span
              className={`font-bold tabular-nums ${
                outcome.rMultiple >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {outcome.rMultiple >= 0 ? "+" : ""}
              {outcome.rMultiple.toFixed(2)}R
            </span>
          )}
          <Badge
            variant="outline"
            className="text-[9px] px-1 py-0 h-4 border-muted-foreground/30 text-muted-foreground"
          >
            {entry.mode}
          </Badge>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground truncate" title={stack ?? ""}>
          {stack ?? "—"}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {outcome.action && (
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
              {outcome.action.replace(/_/g, " ")}
            </span>
          )}
          {outcome.outcomeConfidence && (
            <Badge
              variant="outline"
              className={`text-[9px] px-1 py-0 h-4 ${
                CONFIDENCE_CLASS[outcome.outcomeConfidence] ??
                "border-border text-muted-foreground"
              }`}
            >
              {outcome.outcomeConfidence.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
      </div>

      {entry.notes && (
        <div className="text-muted-foreground border-t border-border/50 pt-1">
          {safeText(entry.notes)}
        </div>
      )}
    </div>
  );
}

export function JournalPanel({ event }: JournalPanelProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createJournal = useCreateJournalEntry();
  const {
    data: entries,
    isLoading,
    isError,
  } = useListJournalEntries({
    query: { queryKey: getListJournalEntriesQueryKey() },
  });

  const logAction = async (key: string) => {
    if (!event) {
      toast({
        title: "No active read",
        description: "Load a symbol before logging an annotation.",
        duration: 3000,
      });
      return;
    }
    const manualOutcome = buildManualActionOutcome(key);
    if (!manualOutcome) return;
    try {
      await createJournal.mutateAsync({
        data: {
          mode: event.mode,
          symbol: event.symbol,
          eventTimestamp: event.timestamp,
          eventSnapshot: {
            alertLevel: event.alertLevel ?? null,
            triggerStack: event.triggerStack ?? null,
            dataSource: event.dataSource,
          },
          manualOutcome,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getListJournalEntriesQueryKey(),
        }),
        queryClient.invalidateQueries({ queryKey: getGetScoreboardQueryKey() }),
      ]);
      toast({
        title: "Annotation logged",
        description: `${event.symbol} • ${key.replace(/_/g, " ")}`,
        duration: 2500,
      });
    } catch {
      toast({
        title: "Could not log annotation",
        description: "Please try again.",
        variant: "destructive",
        duration: 3000,
      });
    }
  };

  return (
    <div className="h-full flex flex-col font-mono min-h-0">
      <div className="shrink-0 pb-2 mb-2 border-b border-border">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
          Annotate active read{event ? ` · ${event.symbol}` : ""}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MANUAL_ACTIONS.map((action) => (
            <Button
              key={action.key}
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2 font-mono"
              disabled={!event || createJournal.isPending}
              title={action.description}
              onClick={() => logAction(action.key)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 space-y-1.5 pr-1">
        {isLoading ? (
          <div className="space-y-1.5 animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 bg-muted/50 rounded w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="text-destructive text-sm">FAILED TO LOAD JOURNAL</div>
        ) : !entries || entries.length === 0 ? (
          <div className="text-muted-foreground text-sm text-center pt-6">
            NO JOURNAL ENTRIES
          </div>
        ) : (
          entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
