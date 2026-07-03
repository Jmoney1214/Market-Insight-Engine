import { useRoute, Link } from "wouter";
import {
  ArrowLeft,
  Building2,
  Target,
  Newspaper,
  FileText,
  BarChart3,
  Scale,
  Activity,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Clock,
  Crosshair,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useGetReport, getGetReportQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ratingTone,
  severityTone,
  sentimentTone,
  changeTone,
  toneText,
  toneBadge,
  toneSurface,
  formatPrice,
  signedPct,
  formatPct,
  formatNum,
  type Tone,
} from "@/lib/finance";
import { ReportNav, type NavSection } from "@/components/report/report-nav";
import { VerdictSummary } from "@/components/report/verdict-summary";
import { ReportSection, MetricTile, KeyValue } from "@/components/report/primitives";
import { ValuationRangeBar, RsiGauge } from "@/components/report/charts";
import { TradingViewChart, TradingViewTechnicals, TradingViewFundamentals } from "@/components/tradingview";
import { FundamentalsSection } from "@/components/report/fundamentals-section";
import { TodaySetupSection } from "@/components/report/today-setup";

const SECTIONS: NavSection[] = [
  { id: "today", label: "Today" },
  { id: "verdict", label: "Verdict" },
  { id: "snapshot", label: "Snapshot" },
  { id: "chart", label: "Chart" },
  { id: "catalysts", label: "Catalysts" },
  { id: "news", label: "News" },
  { id: "filings", label: "Filings" },
  { id: "financials", label: "Financials" },
  { id: "valuation", label: "Valuation" },
  { id: "technical", label: "Technical" },
  { id: "fundamentals", label: "Fundamentals" },
  { id: "risks", label: "Risks" },
  { id: "scenarios", label: "Scenarios" },
  { id: "action", label: "Action" },
];

function PlaceholderBadge() {
  return (
    <Badge
      variant="outline"
      className="text-[10px] font-normal border-dashed text-muted-foreground"
      data-testid="badge-placeholder"
    >
      Integration pending
    </Badge>
  );
}

function CatalystColumn({
  title,
  items,
  tone,
  icon: Icon,
  marker,
}: {
  title: string;
  items: string[];
  tone: Tone;
  icon: typeof TrendingUp;
  marker: string;
}) {
  return (
    <Card className={cn("h-full", toneSurface[tone])}>
      <CardContent className="p-5">
        <div className={cn("flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-wider", toneText[tone])}>
          <Icon className="w-4 h-4" /> {title}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None noted.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {items.map((c, i) => (
              <li key={i} className="flex gap-2 text-foreground/80">
                <span className={cn("shrink-0 font-mono-numbers", toneText[tone])}>{marker}</span>
                <span className="leading-relaxed">{c}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ScenarioCard({
  label,
  tone,
  marker,
  data,
  currentPrice,
}: {
  label: string;
  tone: Tone;
  marker: string;
  data: { probability: number; targetPrice: number; summary: string; points: string[] };
  currentPrice: number;
}) {
  const upside = currentPrice ? ((data.targetPrice - currentPrice) / currentPrice) * 100 : 0;
  const upTone: Tone = upside >= 0 ? "bullish" : "bearish";
  return (
    <Card className={cn("h-full", toneSurface[tone])}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className={cn("text-xs font-bold uppercase tracking-wider", toneText[tone])}>{label} case</span>
          <Badge className={cn("text-[10px] px-2 py-0", toneBadge[tone])}>{data.probability}% prob</Badge>
        </div>
        <div>
          <p className={cn("text-3xl font-bold font-mono-numbers", toneText[tone])}>{formatPrice(data.targetPrice)}</p>
          <p className={cn("text-xs font-mono-numbers mt-1", toneText[upTone])}>{signedPct(upside)} vs last</p>
        </div>
        <p className="text-sm text-muted-foreground italic leading-relaxed">&ldquo;{data.summary}&rdquo;</p>
        <ul className="space-y-2 text-sm">
          {data.points.map((pt, i) => (
            <li key={i} className="flex gap-2 text-foreground/80">
              <span className={cn("shrink-0 font-mono-numbers", toneText[tone])}>{marker}</span>
              <span className="leading-relaxed">{pt}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function ReportPage() {
  const [, params] = useRoute("/report/:id");
  const id = params?.id ? parseInt(params.id, 10) : 0;

  const { data: report, isLoading, isError } = useGetReport(id, {
    query: {
      enabled: !!id,
      queryKey: getGetReportQueryKey(id),
    },
  });

  if (isLoading) {
    return (
      <div className="flex-1 container mx-auto p-4 max-w-6xl space-y-6 py-8" data-testid="report-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  if (isError || !report) {
    return (
      <div className="flex-1 container mx-auto p-4 flex flex-col items-center justify-center min-h-[50vh]">
        <AlertTriangle className="w-12 h-12 text-bearish mb-4" />
        <h2 className="text-xl font-bold mb-2">Report not found</h2>
        <p className="text-muted-foreground mb-6">The requested analysis could not be loaded.</p>
        <Link href="/" className="text-primary hover:underline flex items-center gap-2" data-testid="link-back-error">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>
      </div>
    );
  }

  const {
    snapshot,
    catalysts,
    news,
    filings,
    financials,
    valuation,
    technical,
    risks,
    thesis,
    actionPlan,
  } = report;

  const actionTone = ratingTone(actionPlan.rating);

  return (
    <div className="flex-1 flex flex-col">
      <ReportNav
        sections={SECTIONS}
        ticker={report.ticker}
        companyName={report.companyName}
        rating={report.overallRating}
        price={snapshot.price}
        change={snapshot.change1d}
      />

      <div className="flex-1 container mx-auto px-4 max-w-6xl space-y-10 py-8">
        {/* Today's Setup FIRST — "what do I trade today" leads the report */}
        {report.todaySetup && !report.todaySetup.isPlaceholder && (
          <TodaySetupSection t={report.todaySetup} price={snapshot.price} />
        )}

        <VerdictSummary report={report} />

        {/* Snapshot */}
        <ReportSection id="snapshot" title="Company Snapshot" icon={Building2}>
          <Card>
            <CardContent className="p-6 space-y-6">
              <p className="text-sm text-muted-foreground leading-relaxed max-w-4xl">{snapshot.description}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <MetricTile
                  label="Price"
                  value={formatPrice(snapshot.price)}
                  sub={`${signedPct(snapshot.change1d)} 1D`}
                  subTone={changeTone(snapshot.change1d)}
                  testId="metric-price"
                />
                <MetricTile label="Market Cap" value={snapshot.marketCap} />
                <MetricTile label="P/E Ratio" value={snapshot.peRatio != null ? formatNum(snapshot.peRatio) : "N/A"} />
                <MetricTile label="EPS" value={snapshot.eps != null ? formatPrice(snapshot.eps) : "N/A"} />
                <MetricTile label="Revenue (TTM)" value={snapshot.revenue} />
                <MetricTile
                  label="52W Change"
                  value={signedPct(snapshot.change52w)}
                  tone={changeTone(snapshot.change52w)}
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-border">
                <KeyValue label="Exchange" value={snapshot.exchange} />
                <KeyValue label="Sector" value={report.sector} />
                <KeyValue label="Industry" value={report.industry} />
                <KeyValue label="Employees" value={snapshot.employees} />
              </div>
            </CardContent>
          </Card>
        </ReportSection>

        {/* Live chart (TradingView) */}
        <ReportSection id="chart" title="Price Chart" icon={BarChart3}>
          <TradingViewChart symbol={report.ticker} />
        </ReportSection>

        {/* Catalysts */}
        <ReportSection id="catalysts" title="Catalyst Summary" icon={Target}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <CatalystColumn title="Positive" items={catalysts.positive} tone="bullish" icon={TrendingUp} marker="+" />
            <CatalystColumn title="Negative" items={catalysts.negative} tone="bearish" icon={TrendingDown} marker="−" />
            <CatalystColumn title="Upcoming" items={catalysts.upcoming} tone="neutral" icon={Clock} marker="•" />
          </div>
        </ReportSection>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
          {/* News */}
          <ReportSection
            id="news"
            title="Recent News"
            icon={Newspaper}
            action={news.isPlaceholder ? <PlaceholderBadge /> : undefined}
          >
            <Card className="h-full">
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {news.headlines.map((item, i) => {
                    const tone = sentimentTone(item.sentiment);
                    return (
                      <div key={i} className="p-4 hover-elevate">
                        <div className="flex justify-between items-start gap-3 mb-2">
                          <h3 className="text-sm font-medium leading-snug">{item.title}</h3>
                          <Badge className={cn("text-[10px] uppercase px-1.5 py-0 shrink-0", toneBadge[tone])}>
                            {item.sentiment}
                          </Badge>
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{item.source}</span>
                          <span className="font-mono-numbers">{item.date}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </ReportSection>

          {/* Filings */}
          <ReportSection
            id="filings"
            title="SEC Filings"
            icon={FileText}
            action={filings.isPlaceholder ? <PlaceholderBadge /> : undefined}
          >
            <Card className="h-full">
              <CardContent className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile label="Last 10-K" value={filings.lastForm10K} />
                  <MetricTile label="Last 10-Q" value={filings.lastForm10Q} />
                </div>
                <div>
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
                    Key highlights
                  </h3>
                  <ul className="space-y-3 text-sm">
                    {filings.keyHighlights.map((hl, i) => (
                      <li key={i} className="flex gap-3 text-foreground/80">
                        <span className="text-primary shrink-0 mt-0.5">↳</span>
                        <span className="leading-relaxed">{hl}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </ReportSection>
        </div>

        {/* Financials */}
        <ReportSection
          id="financials"
          title="Financial Overview"
          icon={BarChart3}
          action={financials.isPlaceholder ? <PlaceholderBadge /> : undefined}
        >
          <Card>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="grid grid-cols-2 gap-3 lg:col-span-1 content-start">
                  <MetricTile label="Rev. Growth YoY" value={financials.revenueGrowthYoY != null ? formatPct(financials.revenueGrowthYoY) : "N/A"} tone={changeTone(financials.revenueGrowthYoY)} />
                  <MetricTile label="Gross Margin" value={financials.grossMargin != null ? formatPct(financials.grossMargin) : "N/A"} />
                  <MetricTile label="Oper. Margin" value={financials.operatingMargin != null ? formatPct(financials.operatingMargin) : "N/A"} />
                  <MetricTile label="Net Margin" value={financials.netMargin != null ? formatPct(financials.netMargin) : "N/A"} />
                  <MetricTile label="D/E Ratio" value={financials.debtToEquity != null ? formatNum(financials.debtToEquity) : "N/A"} />
                  <MetricTile label="Current Ratio" value={financials.currentRatio != null ? formatNum(financials.currentRatio) : "N/A"} />
                  <MetricTile label="Free Cash Flow" value={financials.freeCashFlow} className="col-span-2" />
                </div>
                <div className="lg:col-span-2 h-[260px] rounded-md border border-border bg-background/40 p-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 text-center">
                    Revenue history ($ billions)
                  </p>
                  <ResponsiveContainer width="100%" height="85%">
                    <BarChart data={financials.revenueHistory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 32% 17%)" vertical={false} />
                      <XAxis dataKey="period" stroke="hsl(215 20% 65%)" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(215 20% 65%)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                      <Tooltip
                        cursor={{ fill: "hsl(199 89% 48% / 0.08)" }}
                        contentStyle={{
                          backgroundColor: "hsl(222 47% 9%)",
                          border: "1px solid hsl(217 32% 17%)",
                          borderRadius: "6px",
                          color: "hsl(210 40% 98%)",
                          fontSize: "12px",
                        }}
                        itemStyle={{ color: "hsl(199 89% 48%)" }}
                        labelStyle={{ color: "hsl(215 20% 65%)" }}
                      />
                      <Bar dataKey="revenue" fill="hsl(199 89% 48%)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="mt-4">
            <TradingViewFundamentals symbol={report.ticker} />
          </div>
        </ReportSection>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
          {/* Valuation */}
          <ReportSection id="valuation" title="Valuation Framework" icon={Scale}>
            <Card className="h-full">
              <CardContent className="p-6 space-y-6">
                <ValuationRangeBar
                  current={valuation.currentPrice}
                  low={valuation.intrinsicValueLow}
                  high={valuation.intrinsicValueHigh}
                />
                <div className="grid grid-cols-3 gap-3">
                  <MetricTile label="EV/EBITDA" value={valuation.evEbitda != null ? formatNum(valuation.evEbitda) : "N/A"} />
                  <MetricTile label="P/B" value={valuation.priceToBook != null ? formatNum(valuation.priceToBook) : "N/A"} />
                  <MetricTile label="P/S" value={valuation.priceToSales != null ? formatNum(valuation.priceToSales) : "N/A"} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">DCF note</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{valuation.dcfNotes}</p>
                </div>
                {valuation.comparables.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Comparables</p>
                    <div className="border border-border rounded-md overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40 border-b border-border text-muted-foreground">
                          <tr>
                            <th className="py-2 px-3 text-left font-medium text-[10px] uppercase tracking-wider">Ticker</th>
                            <th className="py-2 px-3 text-right font-medium text-[10px] uppercase tracking-wider">P/E</th>
                            <th className="py-2 px-3 text-right font-medium text-[10px] uppercase tracking-wider">EV/EBITDA</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {valuation.comparables.map((comp, i) => (
                            <tr key={i} className="hover-elevate">
                              <td className="py-2 px-3 font-mono-numbers font-medium">{comp.ticker}</td>
                              <td className="py-2 px-3 text-right font-mono-numbers">{comp.pe != null ? formatNum(comp.pe) : "—"}</td>
                              <td className="py-2 px-3 text-right font-mono-numbers">{comp.evEbitda != null ? formatNum(comp.evEbitda) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </ReportSection>

          {/* Technical */}
          <ReportSection id="technical" title="Technical Trend" icon={Activity}>
            <Card className="h-full">
              <CardContent className="p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Primary trend</span>
                  <Badge className={cn("px-3", toneBadge[sentimentTone(technical.trend)])}>{technical.trend}</Badge>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">RSI (14)</p>
                  <RsiGauge value={technical.rsi} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile label="MACD" value={technical.macd} />
                  <MetricTile label="Support" value={technical.supportLevel != null ? formatPrice(technical.supportLevel) : "N/A"} tone="bullish" />
                  <MetricTile label="Resistance" value={technical.resistanceLevel != null ? formatPrice(technical.resistanceLevel) : "N/A"} tone="bearish" />
                  <MetricTile label="MA 50 / 200" value={`${technical.ma50 != null ? formatPrice(technical.ma50) : "N/A"} / ${technical.ma200 != null ? formatPrice(technical.ma200) : "N/A"}`} />
                </div>
                {technical.goldenCross !== null && (
                  <div
                    className={cn(
                      "p-3 rounded-md text-sm flex items-center justify-center gap-2 border",
                      technical.goldenCross ? toneSurface.bullish : "bg-muted/40 border-border"
                    )}
                  >
                    <TrendingUp className={cn("w-4 h-4", technical.goldenCross ? toneText.bullish : "text-muted-foreground")} />
                    <span className={technical.goldenCross ? toneText.bullish : "text-muted-foreground"}>
                      {technical.goldenCross ? "Golden cross active" : "No golden cross"}
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t border-border">
                  <p className="text-sm text-muted-foreground leading-relaxed">{technical.notes}</p>
                </div>
              </CardContent>
            </Card>
            <div className="mt-4">
              <TradingViewTechnicals symbol={report.ticker} />
            </div>
          </ReportSection>
        </div>

        {/* Fundamentals (FMP) */}
        {report.fundamentals && !report.fundamentals.isPlaceholder && (
          <FundamentalsSection f={report.fundamentals} />
        )}

        {/* Risks */}
        <ReportSection id="risks" title="Risk Checklist" icon={ShieldAlert}>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {risks.items.map((risk, i) => {
                  const tone = severityTone(risk.severity);
                  return (
                    <div key={i} className="p-4 flex items-start gap-4">
                      <Badge className={cn("w-20 justify-center text-[10px] uppercase mt-0.5 shrink-0", toneBadge[tone])}>
                        {risk.severity}
                      </Badge>
                      <div>
                        <h4 className="text-sm font-medium mb-1">{risk.category}</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed">{risk.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </ReportSection>

        {/* Scenarios */}
        <ReportSection id="scenarios" title="Scenario Analysis" icon={TrendingUp}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ScenarioCard label="Bull" tone="bullish" marker="+" data={thesis.bull} currentPrice={snapshot.price} />
            <ScenarioCard label="Base" tone="neutral" marker="•" data={thesis.base} currentPrice={snapshot.price} />
            <ScenarioCard label="Bear" tone="bearish" marker="−" data={thesis.bear} currentPrice={snapshot.price} />
          </div>
        </ReportSection>

        {/* Action Plan */}
        <ReportSection id="action" title="Final Action Plan" icon={Crosshair} className="pb-4">
          <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card to-card">
            <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
            <CardContent className="p-6 md:p-8 space-y-6">
              <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 border-b border-border pb-6">
                <div>
                  <div className="flex items-center gap-2 mb-2 text-primary">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Recommendation</span>
                  </div>
                  <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">{actionPlan.rationale}</p>
                </div>
                <Badge className={cn("text-xl font-bold px-6 py-2 shrink-0", toneBadge[actionTone])}>
                  {actionPlan.rating}
                </Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricTile label="Time Horizon" value={actionPlan.timeHorizon} />
                <MetricTile label="Position Size" value={actionPlan.positionSizing} />
                <MetricTile label="Entry Zone" value={actionPlan.entryZone} tone="bullish" />
                <MetricTile
                  label="Target / Stop"
                  value={
                    <>
                      <span className={toneText.bullish}>{actionPlan.profitTarget}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className={toneText.bearish}>{actionPlan.stopLoss}</span>
                    </>
                  }
                />
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Key monitors</p>
                <div className="flex flex-wrap gap-2">
                  {actionPlan.keyMonitors.map((monitor, i) => (
                    <Badge key={i} variant="secondary" className="bg-background border border-border text-xs font-normal">
                      {monitor}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <p className="text-[10px] text-muted-foreground/70 text-center uppercase tracking-widest leading-relaxed">
                  {actionPlan.disclaimer}
                </p>
              </div>
            </CardContent>
          </Card>
        </ReportSection>
      </div>
    </div>
  );
}
