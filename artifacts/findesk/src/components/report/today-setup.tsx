import { Sunrise, CalendarClock, Megaphone } from "lucide-react";
import type { TodaySetup } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toneText, toneBadge, formatPrice, signedPct, type Tone } from "@/lib/finance";
import { ReportSection, MetricTile } from "@/components/report/primitives";

/** Expected-range bar: where the current price sits inside prev-close ± ATR. */
function RangeBar({ low, high, price }: { low: number; high: number; price: number }) {
  const pct = high > low ? Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100)) : 50;
  return (
    <div>
      <div className="flex justify-between text-[10px] font-mono-numbers text-muted-foreground mb-1">
        <span>{formatPrice(low)}</span>
        <span className="uppercase tracking-wider">ATR expected range</span>
        <span>{formatPrice(high)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-muted">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background"
          style={{ left: `calc(${pct}% - 6px)` }}
          data-testid="today-range-marker"
        />
      </div>
    </div>
  );
}

export function TodaySetupSection({ t, price }: { t: TodaySetup; price: number }) {
  const gapTone: Tone = t.gapPct >= 0 ? "bullish" : "bearish";
  const vwapTone: Tone =
    t.sessionVwap != null ? (price >= t.sessionVwap ? "bullish" : "bearish") : "neutral";

  return (
    <ReportSection id="today" title="Today's Setup" icon={Sunrise}>
      <Card className="border-primary/20">
        <CardContent className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("px-3 py-1 text-sm font-mono-numbers", toneBadge[gapTone])}>
              Gap {signedPct(t.gapPct)}
            </Badge>
            {t.earningsToday && (
              <Badge variant="outline" className="gap-1 text-xs">
                <CalendarClock className="w-3 h-3" /> Earnings today
              </Badge>
            )}
            {t.gradeChange && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Megaphone className="w-3 h-3" /> {t.gradeChange}
              </Badge>
            )}
            {t.rvol != null && (
              <Badge variant="outline" className="text-xs font-mono-numbers">
                RVOL {t.rvol}x
              </Badge>
            )}
            {t.multiTradeDays != null && (
              <Badge
                className={cn(
                  "text-xs font-mono-numbers",
                  t.multiTradeDays >= 7 ? toneBadge.bullish : "bg-muted text-muted-foreground",
                )}
              >
                Multi-trade: ≥2% range on {t.multiTradeDays}/10 days
              </Badge>
            )}
            {t.avgDailyRangePct != null && (
              <Badge variant="outline" className="text-xs font-mono-numbers">
                Avg range {t.avgDailyRangePct}%/day
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricTile label="Prev Close" value={formatPrice(t.prevClose)} />
            <MetricTile label="Session Open" value={t.sessionOpen != null ? formatPrice(t.sessionOpen) : "—"} />
            <MetricTile label="Session High" value={t.sessionHigh != null ? formatPrice(t.sessionHigh) : "—"} tone="bullish" />
            <MetricTile label="Session Low" value={t.sessionLow != null ? formatPrice(t.sessionLow) : "—"} tone="bearish" />
            <MetricTile
              label="Session VWAP"
              value={t.sessionVwap != null ? formatPrice(t.sessionVwap) : "—"}
              sub={t.sessionVwap != null ? (price >= t.sessionVwap ? "price above" : "price below") : undefined}
              subTone={vwapTone}
            />
            <MetricTile label="ATR (14d)" value={t.atrPct != null ? `${t.atrPct}%/day` : "—"} />
          </div>

          {t.expectedRangeLow != null && t.expectedRangeHigh != null && (
            <RangeBar low={t.expectedRangeLow} high={t.expectedRangeHigh} price={price} />
          )}

          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            Session stats from the Alpaca SIP feed (pre-market aware); expected range is ±1 ATR around the
            current price — a volatility yardstick, not a forecast.
          </p>
        </CardContent>
      </Card>
    </ReportSection>
  );
}
