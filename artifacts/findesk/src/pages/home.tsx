import { FileBarChart, Scale, GitBranch } from "lucide-react";
import { TickerSearch } from "@/components/ticker-search";
import { RecentReports } from "@/components/recent-reports";
import { Watchlist } from "@/components/watchlist";

const FEATURES = [
  { icon: FileBarChart, title: "10-section reports", desc: "Snapshot, catalysts, filings, and financials in one view." },
  { icon: Scale, title: "Valuation & technicals", desc: "Intrinsic-value ranges, comps, RSI, and trend signals." },
  { icon: GitBranch, title: "Scenario targets", desc: "Bull, base, and bear price targets with probabilities." },
];

export default function Home() {
  return (
    <div className="flex-1 flex flex-col container mx-auto px-4 md:px-8 max-w-7xl">
      <section className="flex flex-col items-center text-center pt-14 pb-10 md:pt-20 md:pb-14">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] font-mono-numbers uppercase tracking-wider text-muted-foreground mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-bullish animate-pulse" />
          AI analyst desk
        </span>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground">
          Fin<span className="text-primary">Desk</span>
        </h1>
        <p className="mt-4 text-base md:text-xl text-muted-foreground font-light max-w-2xl">
          Institutional-grade equity research, generated on demand. Enter a ticker for a full analyst report.
        </p>
        <div className="w-full max-w-xl mt-8">
          <TickerSearch variant="hero" autoFocus examples={["AAPL", "NVDA", "TSLA", "MSFT", "AMZN"]} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-12 w-full max-w-4xl text-left">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-card/40 p-4">
              <f.icon className="w-5 h-5 text-primary mb-2" />
              <h3 className="text-sm font-semibold mb-1">{f.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 pb-12">
        <div className="lg:col-span-2">
          <RecentReports />
        </div>
        <div className="lg:col-span-1">
          <Watchlist />
        </div>
      </section>
    </div>
  );
}
