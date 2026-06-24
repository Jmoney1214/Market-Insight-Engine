import { 
  CopilotEvent,
  DashboardReadRecommendation,
  useGetScoreboard,
  getGetScoreboardQueryKey
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { validationStatusClass, validationStatusLabel } from "@/lib/validation-status";

interface LiveBoardPanelProps {
  event?: CopilotEvent;
  recommendation?: DashboardReadRecommendation;
  isLoading: boolean;
  isError: boolean;
}

export function LiveBoardPanel({ event, recommendation, isLoading, isError }: LiveBoardPanelProps) {
  const { data: scores } = useGetScoreboard({
    query: { queryKey: getGetScoreboardQueryKey() }
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-6 bg-muted rounded w-1/3"></div>
        <div className="h-20 bg-muted/50 rounded w-full"></div>
      </div>
    );
  }

  if (isError || !event) {
    return (
      <div className="p-4 text-destructive font-mono text-sm">
        FAILED TO LOAD LIVE BOARD
      </div>
    );
  }

  const {
    symbol,
    alertLevel,
    triggerStack,
    marketQuality,
    riskReward,
    timestamp
  } = event;

  const date = new Date(timestamp);
  const timeStr = isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString();

  const strategyScore = scores?.find(s => s.hypothesisName === triggerStack?.stackName);

  return (
    <div className="flex flex-col h-full font-mono text-sm divide-y divide-border overflow-y-auto">
      <div className="p-3 flex justify-between items-start">
        <div>
          <div className="text-2xl font-bold tracking-tight text-foreground">{symbol}</div>
          <div className="text-xs text-muted-foreground">{timeStr}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {alertLevel && (
            <Badge variant="outline" className={`rounded-sm px-1.5 py-0 text-xs font-bold ${
              alertLevel === 'L5' || alertLevel === 'L4' ? 'bg-destructive/20 text-destructive border-destructive/30' :
              alertLevel === 'L3' ? 'bg-warning/20 text-warning border-warning/30' :
              'bg-primary/20 text-primary border-primary/30'
            }`}>
              {alertLevel}
            </Badge>
          )}
          {recommendation && (
            <Badge variant="outline" className="rounded-sm px-1.5 py-0 text-xs bg-muted text-foreground border-border">
              {recommendation.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
      </div>

      <div className="p-3 space-y-3">
        <div className="flex justify-between items-end mb-1">
          <div className="text-xs font-bold text-muted-foreground">TRIGGER STACK</div>
          {strategyScore && (
            <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${validationStatusClass(strategyScore.validationStatus)}`}>
              {validationStatusLabel(strategyScore.validationStatus)}
            </Badge>
          )}
        </div>
        
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div className="text-muted-foreground">NAME</div>
          <div className="text-right truncate" title={triggerStack?.stackName}>{triggerStack?.stackName || "—"}</div>
          
          <div className="text-muted-foreground">CATEGORY</div>
          <div className="text-right">{triggerStack?.category || "—"}</div>
          
          <div className="text-muted-foreground">CREDIBILITY</div>
          <div className="text-right">
            {triggerStack?.credibility !== undefined 
              ? `${(triggerStack.credibility * 100).toFixed(0)}%` 
              : "—"}
          </div>
        </div>
        {triggerStack?.detectedTriggers && triggerStack.detectedTriggers.length > 0 && (
          <div className="mt-2 text-xs">
            <div className="text-muted-foreground mb-1">DETECTIONS</div>
            <div className="flex flex-wrap gap-1">
              {triggerStack.detectedTriggers.map((t, i) => (
                <span key={i} className="bg-muted/50 border border-border px-1 py-0.5 rounded text-[10px]">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 space-y-2">
        <div className="text-xs font-bold text-muted-foreground mb-1">MARKET QUALITY</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="text-muted-foreground">SPREAD</div>
          <div className={`text-right ${marketQuality.spreadOk ? "text-success" : "text-destructive"}`}>
            {marketQuality.spreadOk === null ? "—" : marketQuality.spreadOk ? "PASS" : "FAIL"}
          </div>

          <div className="text-muted-foreground">QUOTE</div>
          <div className={`text-right ${marketQuality.quoteFresh ? "text-success" : "text-destructive"}`}>
            {marketQuality.quoteFresh === null ? "—" : marketQuality.quoteFresh ? "FRESH" : "STALE"}
          </div>

          <div className="text-muted-foreground">LIQUIDITY</div>
          <div className={`text-right ${marketQuality.liquidityOk ? "text-success" : "text-destructive"}`}>
            {marketQuality.liquidityOk === null ? "—" : marketQuality.liquidityOk ? "PASS" : "FAIL"}
          </div>
        </div>
      </div>

      <div className="p-3 space-y-2">
        <div className="text-xs font-bold text-muted-foreground mb-1">RISK / REWARD</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="text-muted-foreground">DIRECTION</div>
          <div className={`text-right font-bold ${
            riskReward.direction === 'LONG' ? 'text-success' : 
            riskReward.direction === 'SHORT' ? 'text-destructive' : ''
          }`}>
            {riskReward.direction || "—"}
          </div>

          <div className="text-muted-foreground">ENTRY</div>
          <div className="text-right">{riskReward.entry?.toFixed(2) || "—"}</div>

          <div className="text-muted-foreground">TARGET</div>
          <div className="text-right">{riskReward.target?.toFixed(2) || "—"}</div>

          <div className="text-muted-foreground">INVALIDATION</div>
          <div className="text-right">{riskReward.invalidation?.toFixed(2) || "—"}</div>

          <div className="text-muted-foreground">RATIO</div>
          <div className="text-right">{riskReward.ratio?.toFixed(2) || "—"} R</div>
        </div>
      </div>
    </div>
  );
}
