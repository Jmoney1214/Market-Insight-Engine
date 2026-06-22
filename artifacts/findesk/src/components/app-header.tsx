import { Link } from "wouter";
import { Activity } from "lucide-react";
import { TickerSearch } from "@/components/ticker-search";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container mx-auto max-w-7xl px-4 h-14 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0" data-testid="link-logo">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary border border-primary/30">
            <Activity className="w-4 h-4" />
          </span>
          <span className="text-base font-bold tracking-tight">
            Fin<span className="text-primary">Desk</span>
          </span>
        </Link>
        <div className="ml-auto w-full max-w-[260px]">
          <TickerSearch variant="compact" />
        </div>
      </div>
    </header>
  );
}
