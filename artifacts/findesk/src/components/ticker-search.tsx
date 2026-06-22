import { useState } from "react";
import { useLocation } from "wouter";
import { Search, Loader2, ArrowRight } from "lucide-react";
import { useAnalyzeTicker } from "@workspace/api-client-react";
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
  const analyze = useAnalyzeTicker();

  const runAnalyze = (raw: string) => {
    const value = raw.trim().toUpperCase();
    if (!value || analyze.isPending) return;
    setPendingTicker(value);
    analyze.mutate(
      { data: { ticker: value } },
      { onSuccess: (report) => setLocation(`/report/${report.id}`) }
    );
  };

  const hero = variant === "hero";

  return (
    <div className={cn("w-full", className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runAnalyze(ticker);
        }}
        className="relative"
        data-testid="form-ticker-search"
      >
        <Search
          className={cn(
            "absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none",
            hero ? "left-4 w-5 h-5" : "left-3 w-4 h-4"
          )}
        />
        <Input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 5))}
          placeholder={hero ? "Enter a ticker — e.g. AAPL" : "Search ticker"}
          aria-label="Ticker symbol"
          autoFocus={autoFocus}
          disabled={analyze.isPending}
          maxLength={5}
          data-testid="input-ticker"
          className={cn(
            "font-mono-numbers uppercase bg-card/80 border-border focus-visible:ring-primary",
            hero ? "h-14 text-lg pl-12 pr-36" : "h-9 text-sm pl-9 pr-9"
          )}
        />
        {hero ? (
          <Button
            type="submit"
            disabled={!ticker || analyze.isPending}
            data-testid="button-analyze"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-6 font-semibold"
          >
            {analyze.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Analyzing
              </>
            ) : (
              "Analyze"
            )}
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            variant="ghost"
            disabled={!ticker || analyze.isPending}
            data-testid="button-analyze"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-primary"
          >
            {analyze.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          </Button>
        )}
      </form>

      {hero && examples && examples.length > 0 ? (
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

      {hero && analyze.isPending ? (
        <p className="mt-4 text-center text-sm text-primary font-mono-numbers animate-pulse" data-testid="text-analyzing">
          Generating analyst report for {pendingTicker}…
        </p>
      ) : null}

      {hero && analyze.isError ? (
        <p className="mt-3 text-center text-sm text-bearish" data-testid="text-analyze-error">
          Could not generate a report. Check the ticker and try again.
        </p>
      ) : null}
    </div>
  );
}
