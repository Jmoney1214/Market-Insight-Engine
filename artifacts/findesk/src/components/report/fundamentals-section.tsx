import { Landmark, Coins, Users2 } from "lucide-react";
import type { Fundamentals } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toneBadge } from "@/lib/finance";
import { ReportSection, MetricTile } from "@/components/report/primitives";

function fmtUSD(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  return `${sign}$${a.toFixed(0)}`;
}

function consensusTone(c: string | null | undefined): "bullish" | "bearish" | "neutral" {
  const s = (c ?? "").toLowerCase();
  if (s.includes("buy")) return "bullish";
  if (s.includes("sell")) return "bearish";
  return "neutral";
}

/** Renders the rich FMP fundamentals block: analyst ratings, balance sheet, cash flow, estimates. */
export function FundamentalsSection({ f }: { f: Fundamentals }) {
  const ratings = [
    { label: "Strong Buy", n: f.ratingStrongBuy, tone: "bullish" as const },
    { label: "Buy", n: f.ratingBuy, tone: "bullish" as const },
    { label: "Hold", n: f.ratingHold, tone: "neutral" as const },
    { label: "Sell", n: f.ratingSell, tone: "bearish" as const },
    { label: "Strong Sell", n: f.ratingStrongSell, tone: "bearish" as const },
  ].filter((r) => r.n != null);
  const hasRatings = ratings.length > 0 && f.ratingConsensus;
  const hasBalance = f.totalAssets != null || f.totalEquity != null;
  const hasCashFlow = f.freeCashFlow != null || f.operatingCashFlow != null;
  const hasEstimates = f.estimatedRevenueAvg != null || f.estimatedEpsAvg != null;

  return (
    <ReportSection id="fundamentals" title="Fundamentals" icon={Landmark}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {hasRatings && (
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <Users2 className="w-4 h-4" /> Analyst Ratings
                </div>
                <Badge className={cn("px-3", toneBadge[consensusTone(f.ratingConsensus)])}>{f.ratingConsensus}</Badge>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {ratings.map((r) => (
                  <div key={r.label} className="text-center">
                    <p className="text-lg font-bold font-mono-numbers">{r.n}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-1">{r.label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {hasEstimates && (
          <Card>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Coins className="w-4 h-4" /> Analyst Estimates {f.estimateFiscalYear ? `(FY${f.estimateFiscalYear})` : ""}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MetricTile label="Est. Revenue" value={fmtUSD(f.estimatedRevenueAvg)} />
                <MetricTile label="Est. EPS" value={f.estimatedEpsAvg != null ? `$${f.estimatedEpsAvg.toFixed(2)}` : "N/A"} />
              </div>
            </CardContent>
          </Card>
        )}

        {hasBalance && (
          <Card>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Landmark className="w-4 h-4" /> Balance Sheet {f.fiscalYear ? `(FY${f.fiscalYear})` : ""}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <MetricTile label="Total Assets" value={fmtUSD(f.totalAssets)} />
                <MetricTile label="Total Debt" value={fmtUSD(f.totalDebt)} />
                <MetricTile label="Net Debt" value={fmtUSD(f.netDebt)} />
                <MetricTile label="Cash & ST Inv." value={fmtUSD(f.cashAndShortTermInvestments)} />
                <MetricTile label="Total Equity" value={fmtUSD(f.totalEquity)} />
              </div>
            </CardContent>
          </Card>
        )}

        {hasCashFlow && (
          <Card>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Coins className="w-4 h-4" /> Cash Flow {f.fiscalYear ? `(FY${f.fiscalYear})` : ""}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <MetricTile label="Operating CF" value={fmtUSD(f.operatingCashFlow)} />
                <MetricTile label="CapEx" value={fmtUSD(f.capitalExpenditure)} />
                <MetricTile label="Free Cash Flow" value={fmtUSD(f.freeCashFlow)} tone="bullish" />
                <MetricTile label="Dividends" value={fmtUSD(f.dividendsPaid)} />
                <MetricTile label="Buybacks" value={fmtUSD(f.stockBuybacks)} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ReportSection>
  );
}
