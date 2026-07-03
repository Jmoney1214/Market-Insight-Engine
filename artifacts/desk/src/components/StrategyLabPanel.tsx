import {
  useListStrategies,
  getListStrategiesQueryKey,
  useGetScoreboard,
  getGetScoreboardQueryKey,
  type StrategyRegistryEntry,
  type EdgeScore,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { safeText, safeList } from "@/lib/safety";
import {
  validationStatusClass,
  validationStatusLabel,
} from "@/lib/validation-status";

function PrimaryCard({
  strategy,
  score,
}: {
  strategy: StrategyRegistryEntry;
  score?: EdgeScore;
}) {
  const status = score?.validationStatus ?? "unproven";
  return (
    <div className="border border-border bg-card rounded p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold text-foreground">{strategy.hypothesisName}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {strategy.primaryEdgeType.replace(/_/g, " ")}
          </div>
        </div>
        <Badge
          variant="outline"
          className={`shrink-0 text-[9px] px-1.5 py-0 h-4 ${validationStatusClass(status)}`}
        >
          {validationStatusLabel(status)}
        </Badge>
      </div>

      <div className="text-[11px] text-muted-foreground">
        {safeText(strategy.universe)}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <div className="text-muted-foreground">HOLDING</div>
        <div className="text-right">{safeText(strategy.holdingPeriod, "—")}</div>
        <div className="text-muted-foreground">MIN SAMPLE</div>
        <div className="text-right tabular-nums">
          {score?.countableSampleCount ?? 0}/{strategy.minimumSampleCount}
        </div>
      </div>

      <div className="text-[11px]">
        <div className="text-muted-foreground mb-0.5">SETUP</div>
        <ul className="list-disc list-inside space-y-0.5 text-foreground/90">
          {safeList(strategy.setupConditions).map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RefinementCard({ strategy }: { strategy: StrategyRegistryEntry }) {
  return (
    <div className="border border-dashed border-border bg-muted/10 rounded p-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-foreground/90">
            {strategy.hypothesisName}
          </div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {strategy.primaryEdgeType.replace(/_/g, " ")}
          </div>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 text-[9px] px-1.5 py-0 h-4 border-warning/40 text-warning bg-warning/10"
        >
          FOLKLORE · NOT PROMOTABLE
        </Badge>
      </div>
      {strategy.note && (
        <div className="text-[11px] text-muted-foreground">
          {safeText(strategy.note)}
        </div>
      )}
    </div>
  );
}

export function StrategyLabPanel() {
  const {
    data: strategies,
    isLoading,
    isError,
  } = useListStrategies({ query: { queryKey: getListStrategiesQueryKey() } });
  const { data: scores } = useGetScoreboard({
    query: { queryKey: getGetScoreboardQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-2 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 bg-muted/50 rounded w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 text-destructive font-mono text-sm">
        FAILED TO LOAD STRATEGY LAB
      </div>
    );
  }

  const list = strategies ?? [];
  const primary = list.filter((s) => s.category === "primary_edge");
  const refinement = list.filter((s) => s.category === "entry_refinement");
  const scoreByName = new Map<string, EdgeScore>(
    (scores ?? []).map((s) => [s.hypothesisName, s]),
  );

  return (
    <div className="h-full overflow-y-auto font-mono text-xs space-y-5 pr-1">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold text-foreground tracking-wider">
            PRIMARY EDGE HYPOTHESES
          </div>
          <span className="text-[10px] text-success uppercase tracking-wider">
            promotable
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {primary.map((s) => (
            <PrimaryCard
              key={s.hypothesisName}
              strategy={s}
              score={scoreByName.get(s.hypothesisName)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold text-foreground tracking-wider">
            ENTRY REFINEMENT FEATURES
          </div>
          <span className="text-[10px] text-warning uppercase tracking-wider">
            never promotable
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground border-l-2 border-warning/40 pl-2">
          Entry-timing refinements, not standalone edges. They can sharpen an
          execution but are structurally barred from ever being measured or
          reported as a proven edge.
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {refinement.map((s) => (
            <RefinementCard key={s.hypothesisName} strategy={s} />
          ))}
        </div>
      </section>
    </div>
  );
}
