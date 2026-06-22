import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type Report } from "@workspace/api-client-react";
import { ratingTone, changeTone, toneBadge, toneText, formatPrice, signedPct, type Tone } from "@/lib/finance";
import { ProbabilityBar } from "@/components/report/charts";

export function VerdictSummary({ report }: { report: Report }) {
  const { snapshot, thesis, actionPlan } = report;
  const rTone = ratingTone(report.overallRating);
  const cTone = changeTone(snapshot.change1d);
  const ChangeIcon = snapshot.change1d > 0 ? TrendingUp : snapshot.change1d < 0 ? TrendingDown : Minus;

  const cases: { key: string; label: string; tone: Tone; data: typeof thesis.bull }[] = [
    { key: "bull", label: "Bull", tone: "bullish", data: thesis.bull },
    { key: "base", label: "Base", tone: "neutral", data: thesis.base },
    { key: "bear", label: "Bear", tone: "bearish", data: thesis.bear },
  ];

  return (
    <section id="verdict" className="scroll-mt-[120px]">
      <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card to-card">
        <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
        <CardContent className="p-6 md:p-8 space-y-7">
          <div className="flex flex-col sm:flex-row sm:items-start gap-5 justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-bold font-mono-numbers tracking-tight" data-testid="text-report-ticker">
                  {report.ticker}
                </h1>
                <Badge className={cn("text-sm font-bold px-3 py-1", toneBadge[rTone])} data-testid="badge-rating">
                  {report.overallRating}
                </Badge>
              </div>
              <p className="text-muted-foreground" data-testid="text-company-name">
                {report.companyName}
              </p>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {report.sector} · {report.industry}
              </p>
            </div>
            <div className="text-left sm:text-right shrink-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Last price</p>
              <p className="text-3xl font-bold font-mono-numbers" data-testid="text-price">
                {formatPrice(snapshot.price)}
              </p>
              <p className={cn("text-sm font-mono-numbers flex items-center gap-1 sm:justify-end", toneText[cTone])}>
                <ChangeIcon className="w-3.5 h-3.5" /> {signedPct(snapshot.change1d)} 1D
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background/40 p-4">
            <p className="text-[10px] uppercase tracking-wider text-primary mb-2 font-semibold">Analyst verdict</p>
            <p className="text-sm leading-relaxed text-foreground/90" data-testid="text-rationale">
              {actionPlan.rationale}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {cases.map((c) => {
              const up = snapshot.price ? ((c.data.targetPrice - snapshot.price) / snapshot.price) * 100 : 0;
              return (
                <div
                  key={c.key}
                  className="rounded-lg border border-border bg-background/40 p-4"
                  data-testid={`card-verdict-${c.key}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn("text-xs font-bold uppercase tracking-wider", toneText[c.tone])}>{c.label} case</span>
                    <span className="text-xs font-mono-numbers text-muted-foreground">{c.data.probability}%</span>
                  </div>
                  <p className="text-2xl font-bold font-mono-numbers">{formatPrice(c.data.targetPrice)}</p>
                  <p className={cn("text-xs font-mono-numbers mt-0.5 mb-3", up >= 0 ? toneText.bullish : toneText.bearish)}>
                    {signedPct(up)} vs last
                  </p>
                  <ProbabilityBar value={c.data.probability} tone={c.tone} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
