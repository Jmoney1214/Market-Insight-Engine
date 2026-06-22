import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ratingTone, changeTone, toneBadge, toneText, formatPrice, signedPct } from "@/lib/finance";

export interface NavSection {
  id: string;
  label: string;
}

function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState<string>(ids[0] ?? "");
  const key = ids.join("|");
  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -65% 0px", threshold: [0, 0.1] }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

export function ReportNav({
  sections,
  ticker,
  companyName,
  rating,
  price,
  change,
}: {
  sections: NavSection[];
  ticker: string;
  companyName: string;
  rating: string;
  price: number;
  change: number;
}) {
  const active = useScrollSpy(sections.map((s) => s.id));
  const rTone = ratingTone(rating);
  const cTone = changeTone(change);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="sticky top-14 z-40 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="flex items-center gap-3 h-12">
          <Link
            href="/"
            className="text-muted-foreground hover:text-primary transition-colors shrink-0"
            data-testid="link-back"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-bold font-mono-numbers text-sm" data-testid="text-nav-ticker">
              {ticker}
            </span>
            <span className="hidden md:inline text-xs text-muted-foreground max-w-[160px] truncate">{companyName}</span>
            <Badge className={cn("text-[10px] px-2 py-0", toneBadge[rTone])}>{rating}</Badge>
            <span className="hidden sm:inline text-xs font-mono-numbers text-muted-foreground">{formatPrice(price)}</span>
            <span className={cn("hidden sm:inline text-xs font-mono-numbers", toneText[cTone])}>{signedPct(change)}</span>
          </div>
          <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar ml-auto" data-testid="nav-sections">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => handleClick(e, s.id)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors",
                  active === s.id
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover-elevate"
                )}
                data-testid={`link-section-${s.id}`}
              >
                {s.label}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
