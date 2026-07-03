import { CommitteeRead, AgentRead } from "@workspace/api-client-react";
import { safeText, safeList } from "@/lib/safety";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface AnalystCommitteePanelProps {
  explain?: CommitteeRead;
  isLoading: boolean;
  isError: boolean;
}

function AgentCard({ agent }: { agent: AgentRead }) {
  const headline = safeText(agent.headline, "No read provided.");
  const factors = safeList(agent.supportingFactors);
  
  const biasColor = 
    agent.bias === "BULLISH" ? "text-success border-success/30 bg-success/10" :
    agent.bias === "BEARISH" ? "text-destructive border-destructive/30 bg-destructive/10" :
    agent.bias === "MIXED" ? "text-warning border-warning/30 bg-warning/10" :
    "text-muted-foreground border-border bg-muted/20";

  return (
    <div className="border border-border rounded bg-card/50 p-3 flex flex-col gap-2 font-mono">
      <div className="flex justify-between items-start">
        <div className="font-bold text-xs uppercase tracking-wider text-foreground">
          {agent.agent.replace(/_/g, " ")}
        </div>
        <div className="flex items-center gap-1">
          {agent.status !== 'OK' && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-warning/50 text-warning bg-warning/10">
              {agent.status}
            </Badge>
          )}
          <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${biasColor}`}>
            {agent.bias}
          </Badge>
        </div>
      </div>
      
      <div className="text-xs text-foreground font-medium leading-relaxed">
        {headline}
      </div>

      {factors.length > 0 && (
        <ul className="list-disc list-inside text-[10px] text-muted-foreground mt-1 space-y-0.5">
          {factors.map((f, i) => (
            <li key={i} className="truncate" title={f}>{f}</li>
          ))}
        </ul>
      )}

      {agent.agent === 'risk_critic' && agent.riskVerdict && (
        <div className="mt-1 pt-2 border-t border-border/50 flex justify-between items-center text-[10px]">
          <span className="text-muted-foreground">RISK VERDICT</span>
          <span className={`font-bold ${
            agent.riskVerdict === 'PASS' ? 'text-success' :
            agent.riskVerdict === 'WARN' ? 'text-warning' :
            'text-destructive'
          }`}>
            {agent.riskVerdict}
          </span>
        </div>
      )}
    </div>
  );
}

export function AnalystCommitteePanel({ explain, isLoading, isError }: AnalystCommitteePanelProps) {
  if (isLoading) {
    return (
      <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 animate-pulse">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted/30 rounded border border-border"></div>
        ))}
      </div>
    );
  }

  if (isError || !explain?.agents) {
    return (
      <div className="p-4 text-destructive font-mono text-sm">
        FAILED TO LOAD COMMITTEE
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {explain.agents.map((agent, i) => (
          <AgentCard key={i} agent={agent} />
        ))}
      </div>
    </ScrollArea>
  );
}
