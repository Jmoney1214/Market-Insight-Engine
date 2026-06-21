import { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] w-full flex flex-col font-sans">
      <div className="w-full bg-primary/10 border-b border-primary/20 py-1.5 px-4 text-center text-xs font-mono-numbers text-primary tracking-wide">
        FinDesk provides research support only — not licensed financial advice. All analysis is for informational purposes. Do not trade solely on this output.
      </div>
      <main className="flex-1 flex flex-col">
        {children}
      </main>
    </div>
  );
}
