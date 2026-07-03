import {
  useGetScoreboard,
  getGetScoreboardQueryKey,
} from "@workspace/api-client-react";
import { safeText } from "@/lib/safety";
import {
  validationStatusClass,
  validationStatusLabel,
} from "@/lib/validation-status";

const fmt = (v: number | null, digits = 2) =>
  v === null ? "—" : v.toFixed(digits);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);

export function EdgeScoreboardPanel() {
  const { data, isLoading, isError } = useGetScoreboard({
    query: { queryKey: getGetScoreboardQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-2 animate-pulse">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-7 bg-muted/50 rounded w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 text-destructive font-mono text-sm">
        FAILED TO LOAD EDGE SCOREBOARD
      </div>
    );
  }

  const rows = data ?? [];

  return (
    <div className="h-full overflow-auto font-mono text-[11px]">
      <table className="w-full border-collapse [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1.5 [&_td]:whitespace-nowrap">
        <thead className="sticky top-0 z-10 bg-background text-left text-muted-foreground">
          <tr className="border-b border-border">
            <th className="text-left">HYPOTHESIS</th>
            <th className="text-left">STATUS</th>
            <th className="text-right">N</th>
            <th className="text-right">FWD</th>
            <th className="text-right">REPLAY</th>
            <th className="text-right">BT</th>
            <th className="text-right">EXP R</th>
            <th className="text-right">PF</th>
            <th className="text-right">WIN</th>
            <th className="text-right">MAXDD R</th>
            <th className="text-right">MFE</th>
            <th className="text-right">MAE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr
              key={s.hypothesisName}
              className="border-b border-border/50 hover:bg-muted/20"
            >
              <td
                className="text-left font-medium text-foreground"
                title={safeText(s.note ?? "", "")}
              >
                {s.hypothesisName}
              </td>
              <td className="text-left">
                <span
                  className={`inline-block border rounded px-1.5 py-0 text-[9px] ${validationStatusClass(s.validationStatus)}`}
                >
                  {validationStatusLabel(s.validationStatus)}
                </span>
              </td>
              <td className="text-right tabular-nums">
                {s.countableSampleCount}/{s.sampleCount}
              </td>
              <td className="text-right tabular-nums">{s.forwardSampleCount}</td>
              <td className="text-right tabular-nums">{s.paperSampleCount}</td>
              <td className="text-right tabular-nums">{s.backtestSampleCount}</td>
              <td className="text-right tabular-nums">{fmt(s.expectancyR)}</td>
              <td className="text-right tabular-nums">{fmt(s.profitFactor)}</td>
              <td className="text-right tabular-nums">{pct(s.winRate)}</td>
              <td className="text-right tabular-nums">{fmt(s.maxDrawdownR)}</td>
              <td className="text-right tabular-nums">{fmt(s.avgMfeR)}</td>
              <td className="text-right tabular-nums">{fmt(s.avgMaeR)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2 py-3 text-[10px] text-muted-foreground">
        Only MANUAL_CONFIRMED outcomes count toward an edge. Backtest samples
        never substitute for forward (live/replay) confirmation.
      </div>
    </div>
  );
}
