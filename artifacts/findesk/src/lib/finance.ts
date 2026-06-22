export type Tone = "bullish" | "bearish" | "neutral" | "caution" | "muted";

export const toneText: Record<Tone, string> = {
  bullish: "text-bullish",
  bearish: "text-bearish",
  neutral: "text-neutral",
  caution: "text-caution",
  muted: "text-muted-foreground",
};

export const toneBadge: Record<Tone, string> = {
  bullish: "bg-bullish/15 text-bullish border-bullish/30",
  bearish: "bg-bearish/15 text-bearish border-bearish/30",
  neutral: "bg-neutral/15 text-neutral border-neutral/30",
  caution: "bg-caution/15 text-caution border-caution/30",
  muted: "bg-muted text-muted-foreground border-border",
};

export const toneSurface: Record<Tone, string> = {
  bullish: "bg-bullish/5 border-bullish/20",
  bearish: "bg-bearish/5 border-bearish/20",
  neutral: "bg-neutral/5 border-neutral/20",
  caution: "bg-caution/5 border-caution/20",
  muted: "bg-muted/40 border-border",
};

export const toneFill: Record<Tone, string> = {
  bullish: "bg-bullish",
  bearish: "bg-bearish",
  neutral: "bg-neutral",
  caution: "bg-caution",
  muted: "bg-muted-foreground",
};

export function ratingTone(rating: string): Tone {
  switch (rating?.toUpperCase()) {
    case "BUY":
      return "bullish";
    case "SELL":
      return "bearish";
    case "HOLD":
      return "neutral";
    case "WATCH":
      return "caution";
    default:
      return "muted";
  }
}

export function severityTone(severity: string): Tone {
  switch (severity?.toUpperCase()) {
    case "HIGH":
      return "bearish";
    case "MEDIUM":
      return "caution";
    case "LOW":
      return "bullish";
    default:
      return "muted";
  }
}

export function sentimentTone(sentiment: string): Tone {
  switch (sentiment?.toUpperCase()) {
    case "BULLISH":
      return "bullish";
    case "BEARISH":
      return "bearish";
    case "NEUTRAL":
      return "neutral";
    case "MIXED":
      return "caution";
    default:
      return "muted";
  }
}

export function changeTone(n: number | null | undefined): Tone {
  if (n == null || n === 0) return "muted";
  return n > 0 ? "bullish" : "bearish";
}

export function formatPrice(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "N/A";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function signedPct(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "N/A";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "N/A";
  return `${n.toFixed(digits)}%`;
}

export function formatNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "N/A";
  return n.toFixed(digits);
}
