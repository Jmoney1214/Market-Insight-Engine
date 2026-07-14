import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateJournalEntry,
  getListJournalEntriesQueryKey,
  getGetScoreboardQueryKey,
  newIdempotencyKey,
  type CopilotEvent,
} from "@workspace/api-client-react";
import { buildCloseOutcome } from "@/lib/journal-actions";

interface PositionPanelProps {
  /** The active copilot event, used to tag archived tracking notes. */
  event?: CopilotEvent;
}

interface PositionState {
  status: "FLAT" | "IN_POSITION";
  direction: "LONG" | "SHORT" | null;
  entry: string;
  invalidation: string;
  target: string;
  currentR: string;
  thesisStatus: "VALID" | "WEAKENING" | "INVALIDATED" | "UNKNOWN";
}

const defaultState: PositionState = {
  status: "FLAT",
  direction: null,
  entry: "",
  invalidation: "",
  target: "",
  currentR: "",
  thesisStatus: "UNKNOWN"
};

export function PositionPanel({ event }: PositionPanelProps) {
  const [pos, setPos] = useState<PositionState>(defaultState);
  // Default to the conservative confidence: a close is only an estimate from the
  // current price unless the trader explicitly confirms a real fill. Only a
  // confirmed close ever counts toward the edge scoreboard.
  const [confirmed, setConfirmed] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const journalHeaders = useRef(new Headers());
  const createJournal = useCreateJournalEntry({
    request: { headers: journalHeaders.current },
  });

  const stackName = event?.triggerStack?.stackName ?? null;

  useEffect(() => {
    const saved = localStorage.getItem("desk-position");
    if (saved) {
      try {
        setPos(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  const save = (newPos: PositionState) => {
    setPos(newPos);
    localStorage.setItem("desk-position", JSON.stringify(newPos));
  };

  const updateField = (field: keyof PositionState, value: any) => {
    save({ ...pos, [field]: value });
  };

  const invalidateMeasurement = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetScoreboardQueryKey() }),
    ]);

  const handleJournal = async () => {
    if (!event) {
      toast({
        title: "Nothing to archive",
        description: "No active read is loaded yet.",
        duration: 3000,
      });
      return;
    }
    try {
      journalHeaders.current.set("Idempotency-Key", newIdempotencyKey());
      await createJournal.mutateAsync({
        data: {
          mode: event.mode,
          symbol: event.symbol,
          eventTimestamp: event.timestamp,
          eventSnapshot: {
            alertLevel: event.alertLevel ?? null,
            l5Blocked: event.l5Blocked,
            dataSource: event.dataSource,
            marketQuality: event.marketQuality,
            hardBlocks: event.hardBlocks,
          },
          manualOutcome: { ...pos },
        },
      });
      await invalidateMeasurement();
      toast({
        title: "Tracking note archived",
        description: `${event.symbol} • ${event.mode} • ${
          event.timestamp
            ? new Date(event.timestamp).toLocaleTimeString()
            : "—"
        }`,
        duration: 3000,
      });
    } catch {
      toast({
        title: "Could not archive note",
        description: "Please try again.",
        variant: "destructive",
        duration: 3000,
      });
    }
  };

  // CLOSE & JOURNAL records a scoreable outcome. It is refused unless the active
  // read carries a named primary-edge trigger AND a finite R is entered, so we
  // never journal a fake or unattributable sample.
  const handleCloseAndJournal = async () => {
    if (!event) {
      toast({
        title: "No active read",
        description: "Load a symbol before closing a tracked position.",
        duration: 3000,
      });
      return;
    }
    const outcome = buildCloseOutcome({
      strategyName: stackName,
      rMultiple: pos.currentR,
      confirmed,
      direction: pos.direction,
    });
    if (!outcome) {
      toast({
        title: "Cannot journal close",
        description: stackName
          ? "Enter a numeric R multiple to record an outcome."
          : "Active read has no attributable strategy trigger.",
        variant: "destructive",
        duration: 4000,
      });
      return;
    }
    try {
      journalHeaders.current.set("Idempotency-Key", newIdempotencyKey());
      await createJournal.mutateAsync({
        data: {
          mode: event.mode,
          symbol: event.symbol,
          eventTimestamp: event.timestamp,
          eventSnapshot: {
            alertLevel: event.alertLevel ?? null,
            triggerStack: event.triggerStack ?? null,
            dataSource: event.dataSource,
            marketQuality: event.marketQuality,
          },
          manualOutcome: {
            ...outcome,
            thesisStatus: pos.thesisStatus,
            entry: pos.entry,
            target: pos.target,
            invalidation: pos.invalidation,
          },
        },
      });
      await invalidateMeasurement();
      save(defaultState);
      setConfirmed(false);
      toast({
        title: "Position closed & journaled",
        description: `${event.symbol} • ${outcome.rMultiple.toFixed(2)}R • ${outcome.outcomeConfidence.replace(/_/g, " ")}`,
        duration: 3500,
      });
    } catch {
      toast({
        title: "Could not journal close",
        description: "Please try again.",
        variant: "destructive",
        duration: 3000,
      });
    }
  };

  const handleClear = () => {
    save(defaultState);
  };

  return (
    <div className="flex flex-col h-full font-mono text-sm overflow-y-auto">
      <div className="p-3 border-b border-border bg-muted/10 flex justify-between items-center shrink-0">
        <div className="text-xs text-muted-foreground">LOCAL POSITION (MANUAL)</div>
        <Badge variant="outline" className={`rounded-sm text-[10px] px-1 py-0 h-4 ${pos.status === 'IN_POSITION' ? 'bg-primary/20 text-primary border-primary/30' : 'bg-muted text-muted-foreground'}`}>
          {pos.status}
        </Badge>
      </div>

      <div className="p-3 space-y-3">
        {pos.status === 'FLAT' ? (
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full text-xs font-mono bg-card"
            onClick={() => updateField('status', 'IN_POSITION')}
          >
            START TRACKING
          </Button>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-muted-foreground text-[10px] mb-1 block">DIRECTION</label>
                <select 
                  className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                  value={pos.direction || ""}
                  onChange={(e) => updateField('direction', e.target.value)}
                >
                  <option value="">SELECT...</option>
                  <option value="LONG">LONG</option>
                  <option value="SHORT">SHORT</option>
                </select>
              </div>

              <div>
                <label className="text-muted-foreground text-[10px] mb-1 block">THESIS STATUS</label>
                <select 
                  className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                  value={pos.thesisStatus}
                  onChange={(e) => updateField('thesisStatus', e.target.value)}
                >
                  <option value="UNKNOWN">UNKNOWN</option>
                  <option value="VALID">VALID</option>
                  <option value="WEAKENING">WEAKENING</option>
                  <option value="INVALIDATED">INVALIDATED</option>
                </select>
              </div>

              <div>
                <label className="text-muted-foreground text-[10px] mb-1 block">ENTRY</label>
                <input 
                  type="number" 
                  className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                  value={pos.entry}
                  onChange={(e) => updateField('entry', e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="text-muted-foreground text-[10px] mb-1 block">CURRENT R</label>
                <input 
                  type="number" 
                  className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                  value={pos.currentR}
                  onChange={(e) => updateField('currentR', e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="text-muted-foreground text-[10px] mb-1 block">STOP / INVAL</label>
                <input 
                  type="number" 
                  className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                  value={pos.invalidation}
                  onChange={(e) => updateField('invalidation', e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="text-muted-foreground text-[10px] mb-1 block">TARGET</label>
                <input 
                  type="number" 
                  className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                  value={pos.target}
                  onChange={(e) => updateField('target', e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Attribution + outcome confidence for CLOSE & JOURNAL. */}
            <div className="border-t border-border/60 pt-2 space-y-2 text-[11px]">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">STRATEGY</span>
                <span className="truncate text-right" title={stackName ?? ""}>
                  {stackName ?? "— (no trigger)"}
                </span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-muted-foreground">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  Confirmed fill{" "}
                  <span className="text-muted-foreground/60">
                    ({confirmed ? "MANUAL_CONFIRMED" : "CURRENT_PRICE_ASSUMED"})
                  </span>
                </span>
              </label>
            </div>

            <div className="pt-1 flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs font-mono border-success/60 text-success hover:bg-success/10"
                onClick={handleCloseAndJournal}
                disabled={!event || !stackName || createJournal.isPending}
                title={
                  !event
                    ? "No active read loaded"
                    : !stackName
                    ? "Active read has no attributable strategy trigger"
                    : "Close the position and record a scoreable outcome"
                }
              >
                {createJournal.isPending ? "JOURNALING…" : "CLOSE & JOURNAL"}
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full text-xs font-mono border-primary text-primary hover:bg-primary/10"
                onClick={handleJournal}
                disabled={!event || createJournal.isPending}
                title={event ? `Archive a ${event.mode} tracking note` : "No active read loaded"}
              >
                {createJournal.isPending ? "ARCHIVING…" : "ARCHIVE TRACKING NOTE"}
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full text-xs font-mono text-muted-foreground hover:text-foreground"
                onClick={handleClear}
              >
                CLEAR
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
