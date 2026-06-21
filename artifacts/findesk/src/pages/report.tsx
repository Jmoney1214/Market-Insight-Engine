import { useRoute, useLocation, Link } from "wouter";
import { ArrowLeft, Building2, TrendingUp, LineChart, AlertTriangle, Scale, Target, ShieldAlert, Newspaper, FileText, Clock, TrendingDown } from "lucide-react";
import { useGetReport, getGetReportQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function ReportPage() {
  const [, params] = useRoute("/report/:id");
  const [, setLocation] = useLocation();
  const id = params?.id ? parseInt(params.id, 10) : 0;

  const { data: report, isLoading, isError } = useGetReport(id, {
    query: {
      enabled: !!id,
      queryKey: getGetReportQueryKey(id)
    }
  });

  if (isLoading) {
    return (
      <div className="flex-1 container mx-auto p-4 max-w-6xl space-y-8">
        <div className="flex items-center gap-4 py-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Skeleton className="h-[200px] md:col-span-4" />
          <Skeleton className="h-[300px] md:col-span-2" />
          <Skeleton className="h-[300px] md:col-span-2" />
        </div>
      </div>
    );
  }

  if (isError || !report) {
    return (
      <div className="flex-1 container mx-auto p-4 flex flex-col items-center justify-center min-h-[50vh]">
        <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
        <h2 className="text-xl font-bold mb-2">Report Not Found</h2>
        <p className="text-muted-foreground mb-6">The requested analysis report could not be loaded.</p>
        <Link href="/" className="text-primary hover:underline flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Link>
      </div>
    );
  }

  const getRatingColor = (rating: string) => {
    switch (rating.toUpperCase()) {
      case "BUY": return "bg-green-500/20 text-green-500 border-green-500/50";
      case "SELL": return "bg-red-500/20 text-red-500 border-red-500/50";
      case "HOLD": return "bg-blue-500/20 text-blue-500 border-blue-500/50";
      default: return "bg-gray-500/20 text-gray-400 border-gray-500/50";
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity.toUpperCase()) {
      case "HIGH": return "bg-red-500/20 text-red-500 border-red-500/30";
      case "MEDIUM": return "bg-amber-500/20 text-amber-500 border-amber-500/30";
      case "LOW": return "bg-green-500/20 text-green-500 border-green-500/30";
      default: return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment.toUpperCase()) {
      case "BULLISH": return "bg-green-500/20 text-green-500 border-green-500/30";
      case "BEARISH": return "bg-red-500/20 text-red-500 border-red-500/30";
      case "NEUTRAL": return "bg-blue-500/20 text-blue-500 border-blue-500/30";
      default: return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

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
    actionPlan
  } = report;

  return (
    <div className="flex-1 flex flex-col">
      {/* Sticky Header */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between max-w-6xl">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-muted-foreground hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold font-mono-numbers tracking-tight">{report.ticker}</h1>
              <span className="text-sm text-muted-foreground hidden sm:inline-block">{report.companyName}</span>
              <Badge variant="outline" className={`ml-2 text-sm font-bold font-mono-numbers px-3 ${getRatingColor(report.overallRating)}`}>
                {report.overallRating}
              </Badge>
            </div>
          </div>
          <div className="text-xs text-muted-foreground font-mono-numbers">
            Generated: {new Date(report.generatedAt).toLocaleDateString()}
          </div>
        </div>
      </div>

      <div className="flex-1 container mx-auto p-4 max-w-6xl space-y-8 py-8">
        
        {/* 1. Company Snapshot */}
        <section>
          <div className="flex items-center gap-2 mb-4 text-primary">
            <Building2 className="w-5 h-5" />
            <h2 className="text-lg font-bold tracking-tight uppercase">Company Snapshot</h2>
          </div>
          <Card className="bg-card border-card-border">
            <CardContent className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
                <div className="col-span-2 md:col-span-4 lg:col-span-6 mb-2">
                  <p className="text-sm text-muted-foreground leading-relaxed">{snapshot.description}</p>
                </div>
                
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Price</p>
                  <p className="text-xl font-bold font-mono-numbers">${snapshot.price.toFixed(2)}</p>
                  <p className={`text-xs font-mono-numbers ${snapshot.change1d >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {snapshot.change1d > 0 ? '+' : ''}{snapshot.change1d}% (1D)
                  </p>
                </div>
                
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Market Cap</p>
                  <p className="text-xl font-bold font-mono-numbers">{snapshot.marketCap}</p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">P/E Ratio</p>
                  <p className="text-xl font-bold font-mono-numbers">{snapshot.peRatio ? snapshot.peRatio.toFixed(2) : 'N/A'}</p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">EPS</p>
                  <p className="text-xl font-bold font-mono-numbers">{snapshot.eps ? `$${snapshot.eps.toFixed(2)}` : 'N/A'}</p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Revenue</p>
                  <p className="text-xl font-bold font-mono-numbers">{snapshot.revenue}</p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">52W Change</p>
                  <p className={`text-xl font-bold font-mono-numbers ${snapshot.change52w >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {snapshot.change52w > 0 ? '+' : ''}{snapshot.change52w}%
                  </p>
                </div>
                
                <div className="col-span-2 md:col-span-4 lg:col-span-6 pt-4 border-t border-border/50 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Exchange:</span> <span className="font-mono-numbers text-foreground">{snapshot.exchange}</span></div>
                  <div><span className="text-muted-foreground">Sector:</span> <span className="text-foreground">{report.sector}</span></div>
                  <div><span className="text-muted-foreground">Industry:</span> <span className="text-foreground">{report.industry}</span></div>
                  <div><span className="text-muted-foreground">Employees:</span> <span className="font-mono-numbers text-foreground">{snapshot.employees}</span></div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* 2. Catalyst Summary */}
        <section>
          <div className="flex items-center gap-2 mb-4 text-primary">
            <Target className="w-5 h-5" />
            <h2 className="text-lg font-bold tracking-tight uppercase">Catalyst Summary</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-card border-green-500/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-green-500 uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Positive
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {catalysts.positive.map((cat, i) => (
                    <li key={i} className="flex gap-2"><span className="text-green-500/50">•</span><span className="text-muted-foreground">{cat}</span></li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card className="bg-card border-red-500/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-red-500 uppercase tracking-wider flex items-center gap-2">
                  <TrendingDown className="w-4 h-4" /> Negative
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {catalysts.negative.map((cat, i) => (
                    <li key={i} className="flex gap-2"><span className="text-red-500/50">•</span><span className="text-muted-foreground">{cat}</span></li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card className="bg-card border-blue-500/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-blue-500 uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Upcoming
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {catalysts.upcoming.map((cat, i) => (
                    <li key={i} className="flex gap-2"><span className="text-blue-500/50">•</span><span className="text-muted-foreground">{cat}</span></li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* 3. Recent News */}
          <section>
            <div className="flex items-center gap-2 mb-4 text-primary">
              <Newspaper className="w-5 h-5" />
              <h2 className="text-lg font-bold tracking-tight uppercase">Recent News</h2>
              {news.isPlaceholder && (
                <Badge variant="outline" className="ml-auto text-xs font-normal border-dashed text-muted-foreground">Integration Pending</Badge>
              )}
            </div>
            <Card className="bg-card border-card-border h-full">
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {news.headlines.map((item, i) => (
                    <div key={i} className="p-4 hover:bg-accent/10 transition-colors">
                      <div className="flex justify-between items-start gap-4 mb-2">
                        <h3 className="text-sm font-medium leading-snug">{item.title}</h3>
                        <Badge variant="outline" className={`text-[10px] uppercase px-1.5 py-0 ${getSentimentColor(item.sentiment)}`}>
                          {item.sentiment}
                        </Badge>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{item.source}</span>
                        <span className="font-mono-numbers">{item.date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          {/* 4. SEC Filings */}
          <section>
            <div className="flex items-center gap-2 mb-4 text-primary">
              <FileText className="w-5 h-5" />
              <h2 className="text-lg font-bold tracking-tight uppercase">SEC Filings</h2>
              {filings.isPlaceholder && (
                <Badge variant="outline" className="ml-auto text-xs font-normal border-dashed text-muted-foreground">Integration Pending</Badge>
              )}
            </div>
            <Card className="bg-card border-card-border h-full">
              <CardContent className="p-6 space-y-6">
                <div className="flex gap-8 border-b border-border pb-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase mb-1">Last 10-K</p>
                    <p className="font-mono-numbers text-sm">{filings.lastForm10K}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase mb-1">Last 10-Q</p>
                    <p className="font-mono-numbers text-sm">{filings.lastForm10Q}</p>
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wider">Key Highlights</h3>
                  <ul className="space-y-3 text-sm">
                    {filings.keyHighlights.map((hl, i) => (
                      <li key={i} className="flex gap-3 text-muted-foreground">
                        <span className="text-primary/50 shrink-0 mt-0.5">↳</span>
                        <span className="leading-relaxed">{hl}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>

        {/* 5. Financial Overview */}
        <section>
          <div className="flex items-center gap-2 mb-4 text-primary">
            <LineChart className="w-5 h-5" />
            <h2 className="text-lg font-bold tracking-tight uppercase">Financial Statement Overview</h2>
            {financials.isPlaceholder && (
              <Badge variant="outline" className="ml-auto text-xs font-normal border-dashed text-muted-foreground">Integration Pending</Badge>
            )}
          </div>
          <Card className="bg-card border-card-border">
            <CardContent className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="grid grid-cols-2 gap-6 lg:col-span-1">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">YoY Growth</p>
                    <p className="text-lg font-bold font-mono-numbers">{financials.revenueGrowthYoY ? `${financials.revenueGrowthYoY}%` : 'N/A'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Gross Margin</p>
                    <p className="text-lg font-bold font-mono-numbers">{financials.grossMargin ? `${financials.grossMargin}%` : 'N/A'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Oper. Margin</p>
                    <p className="text-lg font-bold font-mono-numbers">{financials.operatingMargin ? `${financials.operatingMargin}%` : 'N/A'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Net Margin</p>
                    <p className="text-lg font-bold font-mono-numbers">{financials.netMargin ? `${financials.netMargin}%` : 'N/A'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">D/E Ratio</p>
                    <p className="text-lg font-bold font-mono-numbers">{financials.debtToEquity ? financials.debtToEquity.toFixed(2) : 'N/A'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Current Ratio</p>
                    <p className="text-lg font-bold font-mono-numbers">{financials.currentRatio ? financials.currentRatio.toFixed(2) : 'N/A'}</p>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Free Cash Flow</p>
                    <p className="text-lg font-bold font-mono-numbers">{financials.freeCashFlow}</p>
                  </div>
                </div>
                
                <div className="lg:col-span-2 h-[250px] border border-border/50 rounded p-4 bg-background/50">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-4 text-center">Revenue History (Millions)</p>
                  <ResponsiveContainer width="100%" height="80%">
                    <BarChart data={financials.revenueHistory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="period" stroke="#888" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff' }}
                        itemStyle={{ color: '#38bdf8' }}
                      />
                      <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* 6. Valuation & 7. Technical */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section>
            <div className="flex items-center gap-2 mb-4 text-primary">
              <Scale className="w-5 h-5" />
              <h2 className="text-lg font-bold tracking-tight uppercase">Valuation Framework</h2>
            </div>
            <Card className="bg-card border-card-border h-full">
              <CardContent className="p-6 space-y-6">
                <div className="bg-accent/10 border border-border p-4 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase mb-1">Current Price</p>
                    <p className="text-2xl font-bold font-mono-numbers">${valuation.currentPrice.toFixed(2)}</p>
                  </div>
                  <div className="text-center px-4">
                    <p className="text-xs text-muted-foreground uppercase mb-1">VS</p>
                    <ArrowLeft className="w-4 h-4 mx-auto text-muted-foreground" />
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground uppercase mb-1">Intrinsic Range</p>
                    <p className="text-xl font-bold font-mono-numbers text-primary">
                      ${valuation.intrinsicValueLow.toFixed(2)} - ${valuation.intrinsicValueHigh.toFixed(2)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 border-b border-border pb-6">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">EV/EBITDA</p>
                    <p className="font-mono-numbers">{valuation.evEbitda?.toFixed(2) || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">P/B</p>
                    <p className="font-mono-numbers">{valuation.priceToBook?.toFixed(2) || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">P/S</p>
                    <p className="font-mono-numbers">{valuation.priceToSales?.toFixed(2) || 'N/A'}</p>
                  </div>
                </div>
                
                <div>
                  <p className="text-sm font-medium mb-2">DCF Note</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{valuation.dcfNotes}</p>
                </div>
                
                {valuation.comparables.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-3">Comps</p>
                    <div className="border border-border rounded-md overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 border-b border-border">
                          <tr>
                            <th className="py-2 px-3 text-left font-medium">Ticker</th>
                            <th className="py-2 px-3 text-right font-medium">P/E</th>
                            <th className="py-2 px-3 text-right font-medium">EV/EBITDA</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {valuation.comparables.map((comp, i) => (
                            <tr key={i} className="hover:bg-muted/20">
                              <td className="py-2 px-3 font-mono-numbers">{comp.ticker}</td>
                              <td className="py-2 px-3 text-right font-mono-numbers">{comp.pe?.toFixed(2) || '-'}</td>
                              <td className="py-2 px-3 text-right font-mono-numbers">{comp.evEbitda?.toFixed(2) || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4 text-primary">
              <LineChart className="w-5 h-5" />
              <h2 className="text-lg font-bold tracking-tight uppercase">Technical Trend</h2>
            </div>
            <Card className="bg-card border-card-border h-full">
              <CardContent className="p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <span className="text-sm text-muted-foreground uppercase tracking-wider">Primary Trend</span>
                  <Badge variant="outline" className={`font-mono-numbers px-3 ${getSentimentColor(technical.trend)}`}>
                    {technical.trend}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-6">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase mb-1">RSI (14)</p>
                    <p className="text-lg font-mono-numbers">{technical.rsi?.toFixed(2) || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase mb-1">MACD</p>
                    <p className="text-lg font-mono-numbers">{technical.macd}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase mb-1">Support</p>
                    <p className="text-lg font-mono-numbers text-green-500">${technical.supportLevel?.toFixed(2) || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase mb-1">Resistance</p>
                    <p className="text-lg font-mono-numbers text-red-500">${technical.resistanceLevel?.toFixed(2) || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase mb-1">MA 50</p>
                    <p className="text-lg font-mono-numbers">${technical.ma50?.toFixed(2) || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase mb-1">MA 200</p>
                    <p className="text-lg font-mono-numbers">${technical.ma200?.toFixed(2) || 'N/A'}</p>
                  </div>
                </div>

                {technical.goldenCross !== null && (
                  <div className={`p-3 rounded-md text-sm flex items-center justify-center gap-2 border ${technical.goldenCross ? 'bg-green-500/10 border-green-500/30 text-green-500' : 'bg-muted border-border text-muted-foreground'}`}>
                    <TrendingUp className="w-4 h-4" />
                    {technical.goldenCross ? 'Golden Cross Active' : 'No Golden Cross'}
                  </div>
                )}

                <div className="pt-2 border-t border-border">
                  <p className="text-sm text-muted-foreground leading-relaxed">{technical.notes}</p>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>

        {/* 8. Risk Checklist */}
        <section>
          <div className="flex items-center gap-2 mb-4 text-primary">
            <ShieldAlert className="w-5 h-5" />
            <h2 className="text-lg font-bold tracking-tight uppercase">Risk Checklist</h2>
          </div>
          <Card className="bg-card border-card-border">
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {risks.items.map((risk, i) => (
                  <div key={i} className="p-4 flex items-start gap-4">
                    <Badge variant="outline" className={`w-20 justify-center text-[10px] uppercase mt-0.5 ${getSeverityColor(risk.severity)}`}>
                      {risk.severity}
                    </Badge>
                    <div>
                      <h4 className="text-sm font-medium mb-1">{risk.category}</h4>
                      <p className="text-sm text-muted-foreground">{risk.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* 9. Thesis Cases */}
        <section>
          <div className="flex items-center gap-2 mb-4 text-primary">
            <TrendingUp className="w-5 h-5" />
            <h2 className="text-lg font-bold tracking-tight uppercase">Scenario Analysis</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-card border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.05)]">
              <CardHeader className="border-b border-border/50 pb-4">
                <div className="flex justify-between items-center mb-2">
                  <CardTitle className="text-green-500 uppercase tracking-wider text-sm font-bold">Bull Case</CardTitle>
                  <span className="text-xs font-mono-numbers text-green-500 bg-green-500/10 px-2 py-1 rounded">{thesis.bull.probability}% Prob</span>
                </div>
                <div className="text-3xl font-bold font-mono-numbers text-green-500">${thesis.bull.targetPrice.toFixed(2)}</div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <p className="text-sm text-muted-foreground italic">"{thesis.bull.summary}"</p>
                <ul className="space-y-2 text-sm">
                  {thesis.bull.points.map((pt, i) => (
                    <li key={i} className="flex gap-2 text-muted-foreground"><span className="text-green-500 shrink-0">+</span> <span>{pt}</span></li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="bg-card border-blue-500/30">
              <CardHeader className="border-b border-border/50 pb-4">
                <div className="flex justify-between items-center mb-2">
                  <CardTitle className="text-blue-500 uppercase tracking-wider text-sm font-bold">Base Case</CardTitle>
                  <span className="text-xs font-mono-numbers text-blue-500 bg-blue-500/10 px-2 py-1 rounded">{thesis.base.probability}% Prob</span>
                </div>
                <div className="text-3xl font-bold font-mono-numbers text-blue-500">${thesis.base.targetPrice.toFixed(2)}</div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <p className="text-sm text-muted-foreground italic">"{thesis.base.summary}"</p>
                <ul className="space-y-2 text-sm">
                  {thesis.base.points.map((pt, i) => (
                    <li key={i} className="flex gap-2 text-muted-foreground"><span className="text-blue-500 shrink-0">•</span> <span>{pt}</span></li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="bg-card border-red-500/30">
              <CardHeader className="border-b border-border/50 pb-4">
                <div className="flex justify-between items-center mb-2">
                  <CardTitle className="text-red-500 uppercase tracking-wider text-sm font-bold">Bear Case</CardTitle>
                  <span className="text-xs font-mono-numbers text-red-500 bg-red-500/10 px-2 py-1 rounded">{thesis.bear.probability}% Prob</span>
                </div>
                <div className="text-3xl font-bold font-mono-numbers text-red-500">${thesis.bear.targetPrice.toFixed(2)}</div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <p className="text-sm text-muted-foreground italic">"{thesis.bear.summary}"</p>
                <ul className="space-y-2 text-sm">
                  {thesis.bear.points.map((pt, i) => (
                    <li key={i} className="flex gap-2 text-muted-foreground"><span className="text-red-500 shrink-0">-</span> <span>{pt}</span></li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* 10. Action Plan */}
        <section className="pb-12">
          <Card className="bg-primary/5 border-primary/30 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
            <CardContent className="p-6 md:p-8 space-y-6">
              <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 border-b border-primary/10 pb-6">
                <div>
                  <h2 className="text-xl font-bold tracking-tight uppercase text-primary mb-2">Final Action Plan</h2>
                  <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">{actionPlan.rationale}</p>
                </div>
                <Badge variant="outline" className={`text-xl font-bold font-mono-numbers px-6 py-2 border-2 ${getRatingColor(actionPlan.rating)}`}>
                  {actionPlan.rating}
                </Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <p className="text-xs text-muted-foreground uppercase mb-1">Time Horizon</p>
                  <p className="font-medium font-mono-numbers text-foreground">{actionPlan.timeHorizon}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase mb-1">Position Size</p>
                  <p className="font-medium font-mono-numbers text-foreground">{actionPlan.positionSizing}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase mb-1">Entry Zone</p>
                  <p className="font-medium font-mono-numbers text-green-500">{actionPlan.entryZone}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase mb-1">Target / Stop</p>
                  <p className="font-medium font-mono-numbers">
                    <span className="text-green-500">{actionPlan.profitTarget}</span> / <span className="text-red-500">{actionPlan.stopLoss}</span>
                  </p>
                </div>
              </div>

              <div className="pt-4">
                <p className="text-xs text-muted-foreground uppercase mb-2">Key Monitors</p>
                <div className="flex flex-wrap gap-2">
                  {actionPlan.keyMonitors.map((monitor, i) => (
                    <Badge key={i} variant="secondary" className="bg-background border-border text-xs font-normal">
                      {monitor}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="mt-8 pt-4 border-t border-primary/10">
                <p className="text-[10px] text-muted-foreground/70 text-center uppercase tracking-widest leading-relaxed">
                  {actionPlan.disclaimer}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

      </div>
    </div>
  );
}
