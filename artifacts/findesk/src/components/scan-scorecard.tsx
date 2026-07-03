import { ClipboardCheck } from "lucide-react";
import {
  useGetScanScorecard,
  getGetScanScorecardQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toneBadge, toneText, signedPct } from "@/lib/finance";

const LIST_LABEL: Record<string, string> = {
  intraday: "Top Intraday",
  jump: "Likely Jump",
  fall: "Likely Fall",
};

/** Measured accountability for the Morning Scan: hit rates + recent graded picks. */
export function ScanScorecard() {
  const { data } = useGetScanScorecard({
    query: { queryKey: getGetScanScorecardQueryKey(), staleTime: 10 * 60 * 1000 },
  });

  const graded = data?.recent.filter((r) => r.hit !== null).slice(0, 8) ?? [];
  const totalGraded = data?.lists.reduce((a, l) => a + l.graded, 0) ?? 0;

  return (
    <section data-testid="section-scan-scorecard">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardCheck className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Scan Scorecard</h2>
        <span className="text-xs text-muted-foreground">picks vs. what actually happened</span>
      </div>
      <Card>
        <CardContent className="p-5 space-y-4">
          {totalGraded === 0 ? (
            <p className="text-sm text-muted-foreground">
              No graded picks yet — each morning's scan picks are recorded at the open and graded
              after the close. Hit rates appear after the first full session.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                {data!.lists.map((l) => (
                  <div key={l.list} className="rounded-md border border-border bg-background/40 p-3 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      {LIST_LABEL[l.list] ?? l.list}
                    </p>
                    <p className={cn("text-2xl font-bold font-mono-numbers", l.hitRate >= 50 ? toneText.bullish : toneText.bearish)}>
                      {l.graded > 0 ? `${l.hitRate}%` : "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono-numbers">
                      {l.hits}/{l.graded} hit
                    </p>
                  </div>
                ))}
              </div>
              {graded.length > 0 && (
                <div className="divide-y divide-border border-t border-border pt-1">
                  {graded.map((r, i) => (
                    <div key={i} className="py-2 flex items-center justify-between text-sm font-mono-numbers">
                      <span className="flex items-center gap-2">
                        <Badge className={cn("text-[10px] px-1.5 py-0", r.hit ? toneBadge.bullish : toneBadge.bearish)}>
                          {r.hit ? "HIT" : "MISS"}
                        </Badge>
                        <span className="font-bold">{r.symbol}</span>
                        <span className="text-xs text-muted-foreground">{LIST_LABEL[r.list] ?? r.list} · {r.scanDate}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.changePct != null ? `close ${signedPct(r.changePct)}` : ""}
                        {r.rangePct != null ? ` · range ${r.rangePct}%` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <p className="text-[11px] text-muted-foreground/70">
            Hit = intraday pick ranged ≥2% · jump closed up · fall closed down, vs the pre-market
            reference close. Honest measurement, not marketing.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
