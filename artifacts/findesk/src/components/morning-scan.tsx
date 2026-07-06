import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Sunrise, TrendingUp, TrendingDown, Crosshair, RefreshCw, Loader2, Users, ChevronDown } from "lucide-react";
import {
  useGetPremarketScan,
  getPremarketScan,
  getGetPremarketScanQueryKey,
  useAnalyzeTicker,
  useExplainCopilotEvent,
  getExplainCopilotEventQueryKey,
  type ScanCandidate,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toneText, toneBadge, formatPrice, signedPct } from "@/lib/finance";

// Backtest-validated class -> which execution playbook applies (see
// research/findings.md case study 3). Green = validated engine exists,
// amber = unreliable edge, gray = stand aside.
const classBadge: Record<string, { label: string; className: string }> = {
  rider: { label: "RIDER", className: "text-bullish border-bullish/50 bg-bullish/10" },
  scalper: { label: "SCALPER", className: "text-sky-500 border-sky-500/50 bg-sky-500/10" },
  caution: { label: "CAUTION", className: "text-amber-500 border-amber-500/50 bg-amber-500/10" },
  avoid: { label: "AVOID", className: "text-muted-foreground border-border bg-muted/30" },
};

// Keys match the wire enum (BULLISH | BEARISH | NEUTRAL | MIXED | UNKNOWN).
const biasTone: Record<string, string> = {
  BULLISH: "text-bullish border-bullish/40",
  BEARISH: "text-bearish border-bearish/40",
};

/** Read-only analyst committee panel for one board name. Fetches only while
 * open; Alpaca SIP is the only live source (yahoo_delayed is contract-blocked
 * server-side). The committee explains the deterministic read — it never
 * creates signals or overrides blocks. */
function CommitteePanel({ symbol }: { symbol: string }) {
  const { data, isLoading, isError } = useExplainCopilotEvent(
    { symbol, source: "alpaca_live" },
    {
      query: {
        queryKey: getExplainCopilotEventQueryKey({ symbol, source: "alpaca_live" }),
        staleTime: 5 * 60 * 1000,
      },
    },
  );

  if (isLoading) {
    return (
      <div className="mt-2 p-3 rounded-md border border-border bg-muted/20 text-xs text-muted-foreground flex items-center gap-2" data-testid={`committee-loading-${symbol}`}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Running 10-agent committee…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="mt-2 p-3 rounded-md border border-border bg-muted/20 text-xs text-muted-foreground" data-testid={`committee-error-${symbol}`}>
        Committee unavailable for {symbol} right now.
      </div>
    );
  }

  const read = data.dashboardRead;
  return (
    <div className="mt-2 p-3 rounded-md border border-border bg-muted/20 flex flex-col gap-2" data-testid={`committee-panel-${symbol}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px] font-semibold uppercase">
          {read.recommendation.replaceAll("_", " ")}
        </Badge>
        <span className="text-[11px] text-muted-foreground font-mono-numbers">confidence {read.confidence}</span>
        {data.l5Blocked && (
          <Badge variant="outline" className="text-[10px] text-bearish border-bearish/40">HARD BLOCKED</Badge>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground/70">
          {data.provider === "deterministic" ? "deterministic read" : `prose via ${data.provider}`}
          {data.degraded ? " · degraded" : ""}
        </span>
      </div>
      <p className="text-xs leading-relaxed">{read.oneSentenceRead}</p>
      <div className="flex flex-wrap gap-1.5">
        {data.agents.map((a) => (
          <Badge
            key={a.agent}
            variant="outline"
            title={a.headline}
            className={cn("text-[10px] font-normal", biasTone[a.bias] ?? "text-muted-foreground")}
            data-testid={`committee-agent-${symbol}-${a.agent}`}
          >
            {a.agent.replaceAll("_", " ")} · {a.bias.toLowerCase()}
          </Badge>
        ))}
      </div>
      {read.whatSupports.length > 0 && (
        <p className="text-[11px] text-muted-foreground"><span className="text-bullish">Supports:</span> {read.whatSupports.slice(0, 3).join(" · ")}</p>
      )}
      {read.whatArguesAgainst.length > 0 && (
        <p className="text-[11px] text-muted-foreground"><span className="text-bearish">Against:</span> {read.whatArguesAgainst.slice(0, 3).join(" · ")}</p>
      )}
      {read.riskNotes.length > 0 && (
        <p className="text-[11px] text-muted-foreground/80">Risk: {read.riskNotes.slice(0, 2).join(" · ")}</p>
      )}
    </div>
  );
}

function CandidateRow({
  c,
  onAnalyze,
  analyzing,
}: {
  c: ScanCandidate;
  onAnalyze: (symbol: string) => void;
  analyzing: string | null;
}) {
  const [committeeOpen, setCommitteeOpen] = useState(false);
  const gapTone = c.gapPct >= 0 ? "bullish" : "bearish";
  const busy = analyzing === c.symbol;
  const badge = c.tradeClass ? classBadge[c.tradeClass] : null;
  return (
    <div className="p-4 flex flex-col gap-2 hover-elevate" data-testid={`scan-row-${c.symbol}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onAnalyze(c.symbol)}
            disabled={analyzing !== null}
            className="font-mono-numbers font-bold text-primary hover:underline disabled:opacity-60"
            data-testid={`button-scan-analyze-${c.symbol}`}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : c.symbol}
          </button>
          <span className="text-xs text-muted-foreground truncate">{c.companyName}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 font-mono-numbers text-sm">
          {badge && (
            <Badge
              variant="outline"
              className={cn("text-[10px] px-2 py-0 font-semibold", badge.className)}
              title={c.classNote ?? undefined}
              data-testid={`badge-class-${c.symbol}`}
            >
              {badge.label}
            </Badge>
          )}
          <span>{formatPrice(c.price)}</span>
          <span className={toneText[gapTone]}>{signedPct(c.gapPct)}</span>
          <Badge className={cn("text-[10px] px-2 py-0", toneBadge[gapTone])}>score {c.score}</Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {c.reasons.slice(0, 3).map((r, i) => (
          <Badge key={i} variant="secondary" className="bg-background border border-border text-[10px] font-normal max-w-full truncate">
            {r}
          </Badge>
        ))}
        {c.multiTradeDays != null && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-mono-numbers",
              c.multiTradeDays >= 7 ? "text-bullish border-bullish/40" : "text-muted-foreground",
            )}
          >
            {c.multiTradeDays}/10d ≥2%
          </Badge>
        )}
        {c.atrPct != null && (
          <Badge variant="outline" className="text-[10px] font-mono-numbers text-muted-foreground">
            ATR {c.atrPct}%
          </Badge>
        )}
        {c.rsi != null && (
          <Badge variant="outline" className="text-[10px] font-mono-numbers text-muted-foreground">
            RSI {c.rsi}
          </Badge>
        )}
        <button
          type="button"
          onClick={() => setCommitteeOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          data-testid={`button-committee-${c.symbol}`}
        >
          <Users className="w-3 h-3" /> Committee
          <ChevronDown className={cn("w-3 h-3 transition-transform", committeeOpen && "rotate-180")} />
        </button>
      </div>
      {committeeOpen && <CommitteePanel symbol={c.symbol} />}
    </div>
  );
}

function CandidateList({
  list,
  empty,
  onAnalyze,
  analyzing,
}: {
  list: ScanCandidate[];
  empty: string;
  onAnalyze: (symbol: string) => void;
  analyzing: string | null;
}) {
  if (list.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground text-center">{empty}</p>;
  }
  return (
    <div className="divide-y divide-border">
      {list.map((c) => (
        <CandidateRow key={c.symbol} c={c} onAnalyze={onAnalyze} analyzing={analyzing} />
      ))}
    </div>
  );
}

export function MorningScan() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const analyze = useAnalyzeTicker();
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

  const { data, isLoading, isError, isFetching } = useGetPremarketScan(undefined, {
    query: { queryKey: getGetPremarketScanQueryKey(), staleTime: 5 * 60 * 1000 },
  });

  const runAnalyze = (symbol: string) => {
    if (analyze.isPending) return;
    setAnalyzing(symbol);
    analyze.mutate(
      { data: { ticker: symbol } },
      {
        onSuccess: (report) => setLocation(`/report/${report.id}`),
        onSettled: () => setAnalyzing(null),
      },
    );
  };

  // Rescan must bypass the server's short-lived cache (?refresh=true), not just
  // refetch the client query — otherwise within the cache window the identical
  // payload comes back and the button appears dead.
  const refresh = async () => {
    setRescanning(true);
    try {
      const fresh = await getPremarketScan({ refresh: true });
      queryClient.setQueryData(getGetPremarketScanQueryKey(), fresh);
    } catch {
      /* leave existing data in place; the button re-enables */
    } finally {
      setRescanning(false);
    }
  };

  return (
    <section data-testid="section-morning-scan">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sunrise className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Morning Scan</h2>
          {data && (
            <span className="text-xs text-muted-foreground font-mono-numbers">
              {data.universeSize} liquid names under ${data.priceCeiling} ·{" "}
              {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={rescanning || isFetching} data-testid="button-scan-refresh">
          {rescanning || isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Rescan
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : isError || !data ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            Scan unavailable — live market-data keys (Alpaca + FMP) must be configured.
          </CardContent>
        </Card>
      ) : (
        <>
          <Tabs defaultValue="intraday">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="intraday" data-testid="tab-scan-intraday">
                <Crosshair className="w-4 h-4 mr-1.5" /> Top Intraday
              </TabsTrigger>
              <TabsTrigger value="jump" data-testid="tab-scan-jump">
                <TrendingUp className="w-4 h-4 mr-1.5" /> Likely Jump
              </TabsTrigger>
              <TabsTrigger value="fall" data-testid="tab-scan-fall">
                <TrendingDown className="w-4 h-4 mr-1.5" /> Likely Fall
              </TabsTrigger>
            </TabsList>
            <Card className="mt-2">
              <CardContent className="p-0">
                <TabsContent value="intraday" className="m-0">
                  <CandidateList list={data.topIntraday} empty="No qualifying candidates right now." onAnalyze={runAnalyze} analyzing={analyzing} />
                </TabsContent>
                <TabsContent value="jump" className="m-0">
                  <CandidateList list={data.likelyJump} empty="No significant up-gaps at the moment." onAnalyze={runAnalyze} analyzing={analyzing} />
                </TabsContent>
                <TabsContent value="fall" className="m-0">
                  <CandidateList list={data.likelyFall} empty="No significant down-gaps at the moment." onAnalyze={runAnalyze} analyzing={analyzing} />
                </TabsContent>
              </CardContent>
            </Card>
          </Tabs>
          <p className="mt-2 text-[11px] text-muted-foreground/70 leading-relaxed">{data.note}</p>
        </>
      )}
    </section>
  );
}
