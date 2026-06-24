import { CopilotEvent } from "@workspace/api-client-react";

interface FeedQualityPanelProps {
  event?: CopilotEvent;
  isLoading: boolean;
  isError: boolean;
}

function GateRow({ name, gate }: { name: string, gate?: { status: string, reason: string } }) {
  if (!gate) return null;
  const statusColor = 
    gate.status === 'PASS' ? 'text-success' :
    gate.status === 'WARN' ? 'text-warning' :
    'text-destructive';

  return (
    <div className="flex justify-between items-start text-xs border-b border-border/50 py-1.5 last:border-0">
      <div className="font-medium text-muted-foreground capitalize">{name}</div>
      <div className="flex flex-col items-end text-right ml-4">
        <span className={`font-bold ${statusColor}`}>{gate.status}</span>
        {gate.reason && gate.status !== 'PASS' && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[150px]" title={gate.reason}>
            {gate.reason}
          </span>
        )}
      </div>
    </div>
  );
}

export function FeedQualityPanel({ event, isLoading, isError }: FeedQualityPanelProps) {
  if (isLoading) {
    return <div className="p-4 font-mono text-sm text-muted-foreground">LOADING...</div>;
  }
  if (isError || !event) {
    return <div className="p-4 font-mono text-sm text-destructive">UNAVAILABLE</div>;
  }

  const fq = event.feedQuality;
  const g = event.gates;
  const blocks = event.hardBlocks || [];

  return (
    <div className="flex flex-col h-full font-mono text-sm overflow-y-auto">
      {event.l5Blocked && (
        <div className="bg-destructive/20 border-b border-destructive/30 p-2 flex flex-col items-center">
          <div className="text-xs font-bold text-destructive text-center">
            L5 HARD BLOCK ACTIVE
          </div>
          {blocks.length > 0 && (
            <div className="text-[10px] text-destructive/80 mt-1 uppercase text-center">
              {blocks.join(', ')}
            </div>
          )}
        </div>
      )}

      <div className="p-3 border-b border-border flex justify-between items-center bg-card">
        <div className="text-xs text-muted-foreground">FEED STATUS</div>
        <div className={`text-xs font-bold ${
          fq?.verdict === 'OK' ? 'text-success' :
          fq?.verdict === 'DEGRADED' ? 'text-warning' :
          'text-destructive'
        }`}>
          {fq?.verdict || "UNKNOWN"}
        </div>
      </div>

      <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs border-b border-border">
        <div className="text-muted-foreground">SOURCE</div>
        <div className="text-right truncate">{fq?.source || "—"}</div>

        <div className="text-muted-foreground">COMPLETENESS</div>
        <div className="text-right">{fq?.completeness !== undefined ? `${(fq.completeness * 100).toFixed(0)}%` : "—"}</div>

        <div className="text-muted-foreground">QUOTE AGE</div>
        <div className="text-right">{fq?.quoteAgeSeconds !== null ? `${fq.quoteAgeSeconds}s` : "—"}</div>

        <div className="text-muted-foreground">BAR AGE</div>
        <div className="text-right">{fq?.barAgeSeconds !== null ? `${fq.barAgeSeconds}s` : "—"}</div>
      </div>

      <div className="p-3">
        <div className="text-xs font-bold text-muted-foreground mb-2">GATES</div>
        <div className="flex flex-col">
          <GateRow name="Data" gate={g?.data} />
          <GateRow name="Staleness" gate={g?.staleness} />
          <GateRow name="Spread" gate={g?.spread} />
          <GateRow name="Market Quality" gate={g?.marketQuality} />
          <GateRow name="Credibility" gate={g?.credibility} />
          <GateRow name="Validation" gate={g?.validation} />
        </div>
      </div>
    </div>
  );
}
