/**
 * X (Twitter) attention adapter — fixture-first (TradingAgents source pattern).
 * Live only with X_BEARER_TOKEN (paid API); unconfigured → null, never fabricated.
 * Output is AttentionSignal only — attention, never event proof.
 */
import { extractCashtag, type AttentionSignal } from "./attention";

export interface XOptions {
  bearerToken?: string;
  fetchFn?: typeof fetch;
}

interface XTweet {
  id?: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: { like_count?: number; retweet_count?: number };
}

export function parseXRecentSearch(json: unknown, retrievedAt: string): AttentionSignal[] {
  const tweets = (json as { data?: XTweet[] })?.data ?? [];
  return tweets
    .filter((t): t is XTweet => Boolean(t?.id && t?.text))
    .map((t) => ({
      kind: "X" as const,
      id: `x:${t.id}`,
      symbol: extractCashtag(t.text ?? ""),
      title: String(t.text),
      url: t.id ? `https://x.com/i/status/${t.id}` : null,
      author: t.author_id ?? null,
      engagement: (t.public_metrics?.like_count ?? 0) + (t.public_metrics?.retweet_count ?? 0),
      createdAt: t.created_at ?? retrievedAt,
      retrievedAt,
    }));
}

export class XAdapter {
  private readonly bearerToken: string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(opts: XOptions = {}) {
    this.bearerToken = opts.bearerToken ?? process.env["X_BEARER_TOKEN"]?.trim();
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.bearerToken);
  }

  /** Recent-search for a cashtag. Returns null when unconfigured/unavailable. */
  async search(symbol: string, limit = 25): Promise<AttentionSignal[] | null> {
    if (!this.bearerToken) return null;
    const query = encodeURIComponent(`$${symbol.toUpperCase()} -is:retweet lang:en`);
    try {
      const res = await this.fetchFn(
        `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=${Math.min(Math.max(limit, 10), 100)}&tweet.fields=created_at,public_metrics,author_id`,
        {
          headers: { authorization: `Bearer ${this.bearerToken}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) return null;
      return parseXRecentSearch(await res.json(), new Date().toISOString());
    } catch {
      return null;
    }
  }
}
