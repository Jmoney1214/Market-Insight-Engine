import { useState } from "react";
import { useLocation } from "wouter";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAnalyzeTicker } from "@workspace/api-client-react";
import { RecentReports } from "@/components/recent-reports";
import { Watchlist } from "@/components/watchlist";

export default function Home() {
  const [ticker, setTicker] = useState("");
  const [, setLocation] = useLocation();
  
  const analyze = useAnalyzeTicker();

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) return;
    
    analyze.mutate(
      { data: { ticker: ticker.toUpperCase() } },
      {
        onSuccess: (report) => {
          setLocation(`/report/${report.id}`);
        },
      }
    );
  };

  return (
    <div className="flex-1 flex flex-col container mx-auto p-4 md:p-8 max-w-7xl">
      <div className="flex flex-col items-center justify-center py-16 md:py-24 text-center space-y-6">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground font-sans">
          FinDesk
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground font-light max-w-2xl">
          AI-Powered Analyst Reports. Institutional-Grade Research.
        </p>
        
        <form onSubmit={handleAnalyze} className="w-full max-w-md relative mt-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
          <Input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 5))}
            placeholder="ENTER TICKER (E.G. AAPL)"
            className="w-full pl-12 pr-32 h-14 text-lg font-mono-numbers bg-card border-primary/20 focus-visible:ring-primary uppercase"
            disabled={analyze.isPending}
            maxLength={5}
          />
          <Button 
            type="submit" 
            className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-6 font-semibold"
            disabled={!ticker || analyze.isPending}
          >
            {analyze.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Analyze"}
          </Button>
        </form>
        
        {analyze.isPending && (
          <div className="text-sm text-primary font-mono-numbers animate-pulse">
            Generating analyst report for {ticker}...
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
        <div className="lg:col-span-2">
          <RecentReports />
        </div>
        <div className="lg:col-span-1">
          <Watchlist />
        </div>
      </div>
    </div>
  );
}
