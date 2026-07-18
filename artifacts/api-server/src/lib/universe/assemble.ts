import type { SymbolInsert } from "@workspace/db";
import type { AssembleInput } from "./types.js";
import { classifySecurityType, floatBucket, evaluateEligibility } from "./eligibility.js";

/** Compose the three bulk sources into one deterministic symbols row. */
export function assembleSymbol(i: AssembleInput): SymbolInsert {
  const securityType = i.screener
    ? classifySecurityType({ symbol: i.symbol, fmpIsEtf: i.screener.isEtf, fmpIsFund: i.screener.isFund, fmpIsAdr: i.screener.isAdr })
    : "UNKNOWN";

  const price = i.screener?.price ?? null;
  const exchange = i.asset?.exchange ?? i.screener?.exchange ?? null;

  const { eligible, reason } = evaluateEligibility({
    brokerTradable: !!i.asset && i.asset.tradable && i.asset.status === "active" && i.asset.class === "us_equity",
    exchange,
    securityType,
    price,
    priceIsFresh: i.screener != null,
  });

  const floatShares = i.float?.floatShares ?? null;
  const sharesOut = i.float?.sharesOutstanding ?? null;
  const floatPct = floatShares != null && sharesOut ? floatShares / sharesOut : null;
  const avgVolume = i.screener?.volume ?? null;
  const avgDollarVolume = avgVolume != null && price != null ? avgVolume * price : null;

  const metadataIncomplete = i.screener == null || i.float == null;

  return {
    symbol: i.symbol,
    name: i.screener?.name ?? null,
    exchange,
    securityType,
    eligible,
    ineligibleReason: reason,
    lastPrice: price,
    prevClose: null,
    floatShares,
    sharesOutstanding: sharesOut,
    floatPct,
    floatBucket: floatBucket(floatShares),
    lowFloat: floatShares != null ? floatShares < 20_000_000 : null,
    avgVolume,
    avgDollarVolume,
    marketCap: i.screener?.marketCap ?? null,
    tradable: i.asset?.tradable ?? null,
    shortable: i.asset?.shortable ?? null,
    easyToBorrow: i.asset?.easyToBorrow ?? null,
    marginable: i.asset?.marginable ?? null,
    fractionable: i.asset?.fractionable ?? null,
    ssrFlag: null, // set by the real-time layer, not here
    dilutionRisk: "UNKNOWN", // enriched on-demand by a later sub-project
    recentOffering: null,
    recentSplit: null,
    isRecentIpo: i.isRecentIpo,
    ipoDate: i.ipoDate,
    earningsDate: null,
    sector: i.screener?.sector ?? null,
    industry: i.screener?.industry ?? null,
    sympathyTickers: null,
    lastFullRefresh: new Date(i.now),
    lastDailyRefresh: new Date(i.now),
    staleSince: null,
    metadataIncomplete,
  };
}
