// artifacts/api-server/src/lib/universe/buildUniverse.ts
import type { SymbolInsert } from "@workspace/db";
import { logger } from "../logger.js";
import * as fmp from "../providers/fmp.js";
import type { UniverseScreenerRow } from "../providers/fmp.js";
import { getAssets, type AlpacaAsset } from "../providers/alpacaAssets.js";
import { assembleSymbol } from "./assemble.js";
import { floatBucket } from "./eligibility.js";
import { upsertSymbols, markAllStale } from "./universeStore.js";
import { PRICE_MIN, PRICE_MAX } from "./types.js";

/**
 * Fail-closed degrade guard: if either bulk source is missing we cannot
 * recompute eligibility safely, so we do NOT touch the master (never wipe).
 */
export function shouldAbortRebuild(
  screener: UniverseScreenerRow[] | null, assets: AlpacaAsset[] | null,
): boolean {
  return screener == null || assets == null;
}

/** Pure join: drive off the in-band screener set, attach the broker asset + IPO flag. */
export function joinRows(
  screener: UniverseScreenerRow[], assets: AlpacaAsset[], recentIpo: Set<string>, now: string,
): SymbolInsert[] {
  const assetBySymbol = new Map(assets.map((a) => [a.symbol, a]));
  return screener.map((s) =>
    assembleSymbol({
      symbol: s.symbol,
      now,
      screener: { name: s.name, price: s.price, volume: s.volume, marketCap: s.marketCap, sector: s.sector, industry: s.industry, exchange: s.exchange, isEtf: s.isEtf, isFund: s.isFund, isAdr: s.isAdr },
      asset: assetBySymbol.get(s.symbol) ?? null,
      float: null, // enriched below for the eligible subset
      isRecentIpo: recentIpo.has(s.symbol),
      ipoDate: null,
    }),
  );
}

/**
 * Enrich the eligible subset with float from ONE bulk pass (FMP rate-limits
 * per-symbol calls, so 4k individual lookups leave most rows UNKNOWN). Missing
 * float stays UNKNOWN — it is metadata, never a gate.
 */
async function enrichFloat(rows: SymbolInsert[]): Promise<void> {
  const floatMap = await fmp.getAllSharesFloat();
  if (!floatMap) return; // bulk float unavailable → leave UNKNOWN (metadataIncomplete already set)
  for (const r of rows) {
    if (!r.eligible) continue;
    const f = floatMap.get(r.symbol);
    if (f) {
      r.floatShares = f.floatShares;
      r.sharesOutstanding = f.sharesOutstanding;
      r.floatPct = f.sharesOutstanding ? f.floatShares / f.sharesOutstanding : null;
      r.floatBucket = floatBucket(f.floatShares);
      r.lowFloat = f.floatShares < 20_000_000;
      r.metadataIncomplete = false; // float resolved; every row here came from a screener row
    }
  }
}

/** Nightly full rebuild (~6–8 PM ET). Fail-closed: never wipe on a source outage. */
export async function runFullRebuild(now = new Date()): Promise<{ upserted: number; aborted: boolean }> {
  const nowIso = now.toISOString();
  const day = (ms: number) => new Date(now.getTime() + ms).toISOString().slice(0, 10);
  const [screener, assets, recentIpo] = await Promise.all([
    fmp.getUniverseScreener(PRICE_MIN, PRICE_MAX),
    getAssets(),
    fmp.getRecentIpoSymbols(day(-90 * 86_400_000), day(0)),
  ]);

  if (shouldAbortRebuild(screener, assets)) {
    logger.warn("Universe rebuild aborted: a bulk source was unavailable; keeping last-good");
    await markAllStale(now);
    return { upserted: 0, aborted: true };
  }

  const rows = joinRows(screener!, assets!, recentIpo ?? new Set(), nowIso);
  await enrichFloat(rows);
  const upserted = await upsertSymbols(rows);
  logger.info({ upserted, eligible: rows.filter((r) => r.eligible).length }, "Universe full rebuild complete");
  return { upserted, aborted: false };
}

/** Pre-open daily refresh (~7 AM ET): re-run the rebuild to refresh daily-mutable fields. */
export async function runDailyRefresh(now = new Date()): Promise<{ upserted: number; aborted: boolean }> {
  return runFullRebuild(now);
}
