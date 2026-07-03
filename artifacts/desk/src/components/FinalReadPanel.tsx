import { CommitteeRead } from "@workspace/api-client-react";
import { safeText, safeList } from "@/lib/safety";

interface FinalReadPanelProps {
  explain?: CommitteeRead;
  isLoading: boolean;
  isError: boolean;
}

export function FinalReadPanel({ explain, isLoading, isError }: FinalReadPanelProps) {
  if (isLoading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-10 bg-muted/50 rounded w-full"></div>
        <div className="h-4 bg-muted/50 rounded w-2/3"></div>
      </div>
    );
  }

  if (isError || !explain?.dashboardRead) {
    return (
      <div className="p-4 text-destructive font-mono text-sm">
        UNABLE TO LOAD FINAL READ
      </div>
    );
  }

  const { dashboardRead } = explain;
  const sentence = safeText(dashboardRead.oneSentenceRead, "No summary available.");
  
  const supports = safeList(dashboardRead.whatSupports);
  const arguesAgainst = safeList(dashboardRead.whatArguesAgainst);
  const riskNotes = safeList(dashboardRead.riskNotes);

  return (
    <div className="flex flex-col h-full font-mono text-sm overflow-y-auto">
      <div className="p-4 border-b border-border bg-muted/10">
        <div className="text-base font-semibold leading-snug">
          {sentence}
        </div>
        <div className="mt-2 text-xs text-muted-foreground flex justify-between">
          <span>CONFIDENCE</span>
          <span className="font-bold text-foreground">
            {dashboardRead.confidence !== undefined ? `${(dashboardRead.confidence * 100).toFixed(0)}%` : "—"}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {supports.length > 0 && (
          <div>
            <div className="text-xs font-bold text-success mb-1">SUPPORTS</div>
            <ul className="list-disc list-outside ml-4 text-xs text-muted-foreground space-y-1">
              {supports.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}

        {arguesAgainst.length > 0 && (
          <div>
            <div className="text-xs font-bold text-destructive mb-1">ARGUES AGAINST</div>
            <ul className="list-disc list-outside ml-4 text-xs text-muted-foreground space-y-1">
              {arguesAgainst.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}

        {riskNotes.length > 0 && (
          <div>
            <div className="text-xs font-bold text-warning mb-1">RISK NOTES</div>
            <ul className="list-disc list-outside ml-4 text-xs text-muted-foreground space-y-1">
              {riskNotes.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
