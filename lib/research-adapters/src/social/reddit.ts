/**
 * Reddit attention adapter — fixture-first (TradingAgents source pattern).
 *
 * Live modes:
 * - REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET set → OAuth client-credentials
 *   against oauth.reddit.com (the registered-app path);
 * - otherwise, if allowPublic is set, the public JSON endpoint with a UA.
 * Unconfigured → returns null (never fabricates); tests use parseRedditListing
 * on fixtures. Output is AttentionSignal only — attention, never event proof.
 */
import { extractCashtag, type AttentionSignal } from "./attention";

export interface RedditOptions {
  clientId?: string;
  clientSecret?: string;
  userAgent?: string;
  allowPublic?: boolean;
  fetchFn?: typeof fetch;
}

interface RedditChild {
  data?: {
    id?: string;
    title?: string;
    permalink?: string;
    author?: string;
    score?: number;
    created_utc?: number;
  };
}

export function parseRedditListing(json: unknown, retrievedAt: string): AttentionSignal[] {
  const children = (json as { data?: { children?: RedditChild[] } })?.data?.children ?? [];
  return children
    .map((c) => c.data)
    .filter((d): d is NonNullable<RedditChild["data"]> => Boolean(d?.id && d?.title))
    .map((d) => ({
      kind: "REDDIT" as const,
      id: `reddit:${d.id}`,
      symbol: extractCashtag(d.title ?? ""),
      title: String(d.title),
      url: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
      author: d.author ?? null,
      engagement: Number(d.score ?? 0),
      createdAt: new Date((d.created_utc ?? 0) * 1000).toISOString(),
      retrievedAt,
    }));
}

export class RedditAdapter {
  private readonly opts: RedditOptions;
  private readonly fetchFn: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(opts: RedditOptions = {}) {
    this.opts = {
      clientId: opts.clientId ?? process.env["REDDIT_CLIENT_ID"]?.trim(),
      clientSecret: opts.clientSecret ?? process.env["REDDIT_CLIENT_SECRET"]?.trim(),
      userAgent: opts.userAgent ?? process.env["REDDIT_USER_AGENT"]?.trim() ?? "findesk-research/1.0",
      allowPublic: opts.allowPublic ?? false,
      fetchFn: opts.fetchFn,
    };
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  get configured(): boolean {
    return Boolean((this.opts.clientId && this.opts.clientSecret) || this.opts.allowPublic);
  }

  private async bearer(): Promise<string | null> {
    if (!this.opts.clientId || !this.opts.clientSecret) return null;
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    try {
      const res = await this.fetchFn("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": this.opts.userAgent!,
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;
      this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
      return this.token.value;
    } catch {
      return null;
    }
  }

  /** Search recent posts mentioning a symbol. Returns null when unconfigured/unavailable. */
  async search(symbol: string, limit = 25): Promise<AttentionSignal[] | null> {
    if (!this.configured) return null;
    const q = encodeURIComponent(`$${symbol.toUpperCase()} OR ${symbol.toUpperCase()}`);
    const token = await this.bearer();
    const base = token ? "https://oauth.reddit.com" : "https://www.reddit.com";
    if (!token && !this.opts.allowPublic) return null;
    try {
      const res = await this.fetchFn(
        `${base}/search.json?q=${q}&sort=new&limit=${Math.min(limit, 100)}&t=day`,
        {
          headers: {
            "user-agent": this.opts.userAgent!,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) return null;
      return parseRedditListing(await res.json(), new Date().toISOString());
    } catch {
      return null;
    }
  }
}
