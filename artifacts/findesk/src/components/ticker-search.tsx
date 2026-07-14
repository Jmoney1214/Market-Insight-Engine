import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search, Loader2 } from "lucide-react";
import { newIdempotencyKey, useAnalyzeTicker } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TickerSearchProps {
  variant?: "hero" | "compact";
  autoFocus?: boolean;
  className?: string;
  examples?: string[];
}

export function TickerSearch({ variant = "compact", autoFocus, className, examples }: TickerSearchProps) {
  const [ticker, setTicker] = useState("");
  const [pendingTicker, setPendingTicker] = useState("");
  const [, setLocation] = useLocation();
  const analyzeHeaders = useRef(new Headers());
  const analyze = useAnalyzeTicker({ request: { headers: analyzeHeaders.current } });

  const runAnalyze = (raw: string) => {
    const value = raw.trim().toUpperCase();
    if (!value || analyze.isPending) return;
    analyzeHeaders.current.set("Idempotency-Key", newIdempotencyKey());
    setPendingTicker(value);
    analyze.mutate(
      { data: { ticker: value } },
      { onSuccess: (report) => setLocation(`/report/${report.id}`) }
    );
  };

  const hero = variant === "hero";

  if (!hero) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runAnalyze(ticker);
        }}
        className={cn("relative", className)}
        data-testid="form-ticker-search"
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 5))}
          placeholder="Search ticker"
          aria-label="Ticker symbol"
          autoFocus={autoFocus}
          disabled={analyze.isPending}
          maxLength={5}
          data-testid="input-ticker"
          className="font-mono-numbers uppercase bg-card/80 border-border focus-visible:ring-primary h-9 text-sm pl-9 pr-3"
        />
      </form>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runAnalyze(ticker);
        }}
        className="flex gap-2"
        data-testid="form-ticker-search"
      >
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
          <Input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 5))}
            placeholder="Enter a ticker — e.g. AAPL"
            aria-label="Ticker symbol"
            autoFocus={autoFocus}
            disabled={analyze.isPending}
            maxLength={5}
            data-testid="input-ticker"
            className="w-full font-mono-numbers uppercase bg-card/80 border-border focus-visible:ring-primary h-14 text-lg pl-12 pr-4"
          />
        </div>
        <Button
          type="submit"
          disabled={!ticker || analyze.isPending}
          data-testid="button-analyze"
          className="h-14 px-7 text-base font-semibold shrink-0"
        >
          {analyze.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Analyzing
            </>
          ) : (
            "Analyze"
          )}
        </Button>
      </form>

      {examples && examples.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Try</span>
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => runAnalyze(ex)}
              disabled={analyze.isPending}
              className="px-3 py-1 rounded-full border border-border bg-card/60 text-sm font-mono-numbers text-foreground/80 hover-elevate hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid={`button-example-${ex}`}
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      {analyze.isPending ? (
        <p className="mt-4 text-center text-sm text-primary font-mono-numbers animate-pulse" data-testid="text-analyzing">
          Generating analyst report for {pendingTicker}…
        </p>
      ) : null}

      {analyze.isError ? (
        <p className="mt-3 text-center text-sm text-bearish" data-testid="text-analyze-error">
          Could not generate a report. Check the ticker and try again.
        </p>
      ) : null}
    </div>
  );
}
