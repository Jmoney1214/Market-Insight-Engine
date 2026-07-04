import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Sunrise, TrendingUp, TrendingDown, Crosshair, RefreshCw, Loader2 } from "lucide-react";
import {
  useGetPremarketScan,
  getPremarketScan,
  getGetPremarketScanQueryKey,
  useAnalyzeTicker,
  type ScanCandidate,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toneText, toneBadge, formatPrice, signedPct } from "@/lib/finance";

function CandidateRow({
  c,
  onAnalyze,
  analyzing,
}: {
  c: ScanCandidate;
  onAnalyze: (symbol: string) => void;
  analyzing: string | null;
}) {
  const gapTone = c.gapPct >= 0 ? "bullish" : "bearish";
  const busy = analyzing === c.symbol;
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
      </div>
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
