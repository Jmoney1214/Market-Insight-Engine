import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  YAxis,
  ReferenceLine,
  XAxis,
} from "recharts";
import { CopilotEvent } from "@workspace/api-client-react";

interface ChartPanelProps {
  event?: CopilotEvent;
  isLoading: boolean;
  isError: boolean;
}

interface Level {
  value: number;
  label: string;
  color: string;
  strokeDasharray?: string;
}

export function ChartPanel({ event, isLoading, isError }: ChartPanelProps) {
  // Only plot REAL point-in-time level lines from the snapshot and the
  // research-only risk/reward preview. We never fabricate OHLC candles.
  const levels = useMemo<Level[]>(() => {
    if (!event) return [];
    const { snapshot, riskReward } = event;
    const l: Level[] = [];
    if (snapshot.price != null)
      l.push({ value: snapshot.price, label: "PRICE", color: "hsl(var(--foreground))" });
    if (snapshot.vwap != null)
      l.push({ value: snapshot.vwap, label: "VWAP", color: "hsl(var(--warning))" });
    if (snapshot.openingRangeHigh != null)
      l.push({ value: snapshot.openingRangeHigh, label: "ORH", color: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" });
    if (snapshot.openingRangeLow != null)
      l.push({ value: snapshot.openingRangeLow, label: "ORL", color: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" });
    if (riskReward.entry != null)
      l.push({ value: riskReward.entry, label: "ENTRY", color: "hsl(var(--primary))" });
    if (riskReward.invalidation != null)
      l.push({ value: riskReward.invalidation, label: "INVAL", color: "hsl(var(--destructive))" });
    if (riskReward.target != null)
      l.push({ value: riskReward.target, label: "TARGET", color: "hsl(var(--success))" });
    return l;
  }, [event]);

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center font-mono text-muted-foreground text-sm">
        LOADING CHART...
      </div>
    );
  }
  if (isError || !event) {
    return (
      <div className="h-full w-full flex items-center justify-center font-mono text-destructive text-sm">
        CHART UNAVAILABLE
      </div>
    );
  }
  if (levels.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center font-mono text-muted-foreground text-sm">
        NO PRICE DATA
      </div>
    );
  }

  const values = levels.map((l) => l.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = (max - min) * 0.1 || (min ? min * 0.01 : 1);

  // Recharts needs at least a minimal dataset to render the axis + reference lines.
  const data = [{ x: 0 }, { x: 1 }];

  // Corner legend (sorted high → low) replaces inline labels so close-together
  // levels never overlap on the price axis.
  const legend = [...levels].sort((a, b) => b.value - a.value);

  return (
    <div className="relative h-full w-full p-2 bg-[#0c1017]">
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 font-mono text-[10px] pointer-events-none">
        {legend.map((lv, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-[2px] shrink-0"
              style={{ backgroundColor: lv.color }}
            />
            <span className="text-muted-foreground w-14">{lv.label}</span>
            <span className="text-foreground tabular-nums">{lv.value.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 20, right: 52, bottom: 20, left: 10 }}>
          <XAxis dataKey="x" hide />
          <YAxis
            domain={[min - padding, max + padding]}
            tickFormatter={(val) => Number(val).toFixed(2)}
            orientation="right"
            stroke="hsl(var(--muted-foreground))"
            tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          {levels.map((level, i) => (
            <ReferenceLine
              key={i}
              y={level.value}
              stroke={level.color}
              strokeDasharray={level.strokeDasharray}
              ifOverflow="extendDomain"
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
