/**
 * AttentionSignal — the normalized output of every social adapter.
 * System rule (contracts SentimentReading.isEventProof=false): social items
 * are attention data only; they can never confirm that an event occurred.
 */
export interface AttentionSignal {
  kind: "REDDIT" | "X" | "NEWS" | "OTHER_SOCIAL";
  id: string;
  symbol: string | null;
  title: string;
  url: string | null;
  author: string | null;
  /** Platform-native engagement score (upvotes, likes) — not comparable across kinds. */
  engagement: number;
  createdAt: string;
  retrievedAt: string;
}

const CASHTAG = /\$([A-Z]{1,5})\b/;

/** Best-effort symbol extraction from a title ($RGTI style cashtags only). */
export function extractCashtag(title: string): string | null {
  const m = CASHTAG.exec(title.toUpperCase());
  return m ? m[1]! : null;
}
