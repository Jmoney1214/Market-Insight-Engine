/**
 * Size-matched event-study benchmark selection (audit issue #33).
 *
 * Fitting small/microcap catalyst names against SPY inflates |CAR| and biases
 * the event-study t-test toward false "significant" (MacKinlay 1997) — and
 * those verdicts feed memory reinforcement and the accuracy ranker. Rule,
 * deterministic: market cap >= $10B -> SPY, else IWM; unknown cap -> IWM
 * (the traded universe skews small). The chosen benchmark is stamped into
 * every stored event_study payload so each grade is auditable.
 */
import * as fmp from "./providers/fmp.js";

export type BenchmarkSymbol = "SPY" | "IWM";

export const LARGE_CAP_MIN_MARKET_CAP = 10_000_000_000;

const CAP_TTL_MS = 6 * 3_600_000;
/** Failed lookups retry quickly — a 6h miss-pin could misclassify a large cap. */
const CAP_MISS_TTL_MS = 10 * 60_000;
const capCache = new Map<string, { at: number; cap: number | null }>();

async function marketCapOf(symbol: string): Promise<number | null> {
  const hit = capCache.get(symbol);
  if (hit && Date.now() - hit.at < (hit.cap === null ? CAP_MISS_TTL_MS : CAP_TTL_MS)) return hit.cap;
  const quote = await fmp.getQuote(symbol).catch(() => null);
  const cap =
    quote && Number.isFinite(quote.marketCap) && quote.marketCap > 0 ? quote.marketCap : null;
  capCache.set(symbol, { at: Date.now(), cap });
  return cap;
}

/** Pure decision given a (possibly unknown) market cap. */
export function benchmarkForCap(marketCap: number | null): BenchmarkSymbol {
  return marketCap !== null && marketCap >= LARGE_CAP_MIN_MARKET_CAP ? "SPY" : "IWM";
}

/** Benchmark for a symbol via cached FMP market cap; unknown -> IWM. */
export async function benchmarkFor(symbol: string): Promise<BenchmarkSymbol> {
  return benchmarkForCap(await marketCapOf(symbol));
}
