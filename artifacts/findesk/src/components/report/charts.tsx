import { cn } from "@/lib/utils";
import { type Tone, toneFill, toneText, formatPrice, signedPct } from "@/lib/finance";

export function ProbabilityBar({ value, tone }: { value: number; tone: Tone }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", toneFill[tone])} style={{ width: `${v}%` }} />
    </div>
  );
}

export function ValuationRangeBar({ current, low, high }: { current: number; low: number; high: number }) {
  const lo = Math.min(current, low);
  const hi = Math.max(current, high);
  const pad = (hi - lo) * 0.12 || 1;
  const dMin = lo - pad;
  const dMax = hi + pad;
  const span = dMax - dMin || 1;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - dMin) / span) * 100));
  const mid = (low + high) / 2;
  const upside = current ? ((mid - current) / current) * 100 : 0;
  const upTone: Tone = upside >= 0 ? "bullish" : "bearish";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Fair value vs price</span>
        <span className={cn("text-xs font-mono-numbers font-semibold", toneText[upTone])} data-testid="text-upside">
          {signedPct(upside)} to midpoint
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-muted mt-8 mb-8">
        <div
          className="absolute inset-y-0 rounded-full bg-primary/30 border border-primary/50"
          style={{ left: `${pos(low)}%`, width: `${Math.max(2, pos(high) - pos(low))}%` }}
        />
        <div
          className="absolute -top-1.5 h-5 w-[3px] rounded-full bg-foreground"
          style={{ left: `calc(${pos(current)}% - 1.5px)` }}
        />
        <div
          className="absolute -top-7 -translate-x-1/2 whitespace-nowrap text-[10px] font-mono-numbers text-foreground"
          style={{ left: `${pos(current)}%` }}
        >
          {formatPrice(current)}
        </div>
        <div
          className="absolute top-5 -translate-x-1/2 text-[10px] font-mono-numbers text-primary"
          style={{ left: `${pos(low)}%` }}
        >
          {formatPrice(low)}
        </div>
        <div
          className="absolute top-5 -translate-x-1/2 text-[10px] font-mono-numbers text-primary"
          style={{ left: `${pos(high)}%` }}
        >
          {formatPrice(high)}
        </div>
      </div>
    </div>
  );
}

export function RsiGauge({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-lg font-bold font-mono-numbers text-muted-foreground">N/A</span>;
  }
  const v = Math.max(0, Math.min(100, value));
  const zone = v < 30 ? "Oversold" : v > 70 ? "Overbought" : "Neutral";
  const tone: Tone = v < 30 ? "bullish" : v > 70 ? "bearish" : "neutral";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-lg font-bold font-mono-numbers">{v.toFixed(1)}</span>
        <span className={cn("text-[10px] uppercase tracking-wider font-semibold", toneText[tone])}>{zone}</span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden flex">
        <div className="h-full bg-bullish/40" style={{ width: "30%" }} />
        <div className="h-full bg-neutral/30" style={{ width: "40%" }} />
        <div className="h-full bg-bearish/40" style={{ width: "30%" }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3.5 w-[3px] rounded-full bg-foreground"
          style={{ left: `calc(${v}% - 1.5px)` }}
        />
      </div>
    </div>
  );
}
