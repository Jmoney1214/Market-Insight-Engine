import { type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { AppHeader } from "@/components/app-header";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] w-full flex flex-col font-sans bg-background text-foreground">
      <div className="w-full bg-caution/10 border-b border-caution/20 px-4 py-1.5 text-center text-[11px] font-mono-numbers text-caution/90 tracking-wide">
        Research support only — not licensed financial advice. Live quotes via Yahoo Finance · analysis by FinDesk AI. Do not trade solely on this output.
      </div>
      <AppHeader />
      <main className="flex-1 flex flex-col">{children}</main>
      <footer className="border-t border-border bg-card/30">
        <div className="container mx-auto max-w-7xl px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5 text-muted-foreground" />
            <span>FinDesk — AI analyst research, for informational use only.</span>
          </div>
          <span className="font-mono-numbers">© {new Date().getFullYear()} FinDesk</span>
        </div>
      </footer>
    </div>
  );
}
