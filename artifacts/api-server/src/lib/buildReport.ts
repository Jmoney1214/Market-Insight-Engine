/**
 * Assembles an analyst report from live market data (FMP fundamentals +
 * Alpaca SIP pricing/technicals), filling the exact shape produced by
 * generateMockReport. Every section degrades gracefully: if a provider call
 * fails or a key is missing, that section falls back to mock values, and
 * placeholder flags reflect whether the data is real.
 */
import { generateMockReport } from "./mockData.js";
import { hasLiveData, hasFmp, hasAlpaca } from "./providers/config.js";
import { logger } from "./logger.js";
import * as fmp from "./providers/fmp.js";
import * as alpaca from "./providers/alpaca.js";
import { sma, rsi, support, resistance, changeOverBars } from "./providers/indicators.js";

type Report = ReturnType<typeof generateMockReport>;

const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const pct = (n: number, p = 1) => round(n * 100, p);

function formatBigUSD(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${round(n / 1e12, 2)}T`;
  if (abs >= 1e9) return `$${round(n / 1e9, 1)}B`;
  if (abs >= 1e6) return `$${round(n / 1e6, 1)}M`;
  return `$${round(n, 0)}`;
}

const BULLISH = /\b(beat|beats|surge|soar|jump|rally|upgrade|raises?|growth|record|gains?|buy|outperform|strong|wins?|tops?|positive|boost)\b/i;
const BEARISH = /\b(miss|misses|fall|falls|drop|plunge|slump|downgrade|cuts?|lawsuit|probe|antitrust|warning|weak|loss|losses|decline|sell-off|selloff|recall|fraud|sinks?)\b/i;

function headlineSentiment(title: string): "Bullish" | "Bearish" | "Neutral" {
  if (BEARISH.test(title)) return "Bearish";
  if (BULLISH.test(title)) return "Bullish";
  return "Neutral";
}

/**
 * Build a report for `ticker`. Falls back to a fully mock report when no live
 * provider is configured.
 */
export async function buildReport(ticker: string, id = 0): Promise<Report> {
  const base = generateMockReport(ticker, id);
  if (!hasLiveData) return base;

  const [
    quote,
    profile,
    ratios,
    keyMetrics,
    income,
    dcf,
    priceTarget,
    rating,
    news,
    snapshot,
    bars,
    alpacaNews,
  ] = await Promise.all([
    hasFmp ? fmp.getQuote(ticker) : Promise.resolve(null),
    hasFmp ? fmp.getProfile(ticker) : Promise.resolve(null),
    hasFmp ? fmp.getRatiosTtm(ticker) : Promise.resolve(null),
    hasFmp ? fmp.getKeyMetricsTtm(ticker) : Promise.resolve(null),
    hasFmp ? fmp.getIncomeStatements(ticker) : Promise.resolve(null),
    hasFmp ? fmp.getDcf(ticker) : Promise.resolve(null),
    hasFmp ? fmp.getPriceTarget(ticker) : Promise.resolve(null),
    hasFmp ? fmp.getRating(ticker) : Promise.resolve(null),
    hasFmp ? fmp.getStockNews(ticker, 6) : Promise.resolve(null),
    hasAlpaca ? alpaca.getSnapshot(ticker) : Promise.resolve(null),
    hasAlpaca ? alpaca.getDailyBars(ticker) : Promise.resolve(null),
    hasAlpaca ? alpaca.getNews(ticker, 10) : Promise.resolve(null),
  ]);

  // News: prefer Alpaca (paid, no quota wall); fall back to FMP if present.
  const newsList: Array<{ title: string; source: string; date: string }> | null =
    alpacaNews ??
    (news ? news.map((n) => ({ title: n.title, source: n.publisher || "FMP", date: (n.publishedDate || "").split(" ")[0] || "" })) : null);

  const report: Report = base;

  // ---- Price (Alpaca SIP real-time preferred, FMP quote fallback) ----------
  const price = round(snapshot?.price ?? quote?.price ?? base.snapshot.price);
  let change1d = base.snapshot.change1d;
  if (snapshot && snapshot.prevClose) {
    change1d = round(((snapshot.price - snapshot.prevClose) / snapshot.prevClose) * 100);
  } else if (quote && quote.previousClose) {
    change1d = round(quote.changePercentage);
  }
  const change52w = bars
    ? round(changeOverBars(bars.closes, 252) ?? base.snapshot.change52w)
    : base.snapshot.change52w;

  // ---- Identity / profile --------------------------------------------------
  if (profile) {
    report.companyName = profile.companyName || base.companyName;
    report.sector = profile.sector || base.sector;
    report.industry = profile.industry || base.industry;
  }

  // ---- Snapshot ------------------------------------------------------------
  report.snapshot = {
    ...base.snapshot,
    description: profile?.description || base.snapshot.description,
    price,
    change1d,
    change52w,
    marketCap: quote?.marketCap ? formatBigUSD(quote.marketCap) : base.snapshot.marketCap,
    peRatio: ratios?.["priceToEarningsRatioTTM"]
      ? round(ratios["priceToEarningsRatioTTM"], 1)
      : base.snapshot.peRatio,
    eps: ratios?.["netIncomePerShareTTM"]
      ? round(ratios["netIncomePerShareTTM"])
      : base.snapshot.eps,
    revenue: income?.[0]?.revenue ? formatBigUSD(income[0].revenue) : base.snapshot.revenue,
    employees:
      profile?.fullTimeEmployees && Number.isFinite(Number(profile.fullTimeEmployees))
        ? Number(profile.fullTimeEmployees).toLocaleString("en-US")
        : base.snapshot.employees,
    headquarters:
      profile?.city && profile?.state ? `${profile.city}, ${profile.state}` : base.snapshot.headquarters,
    founded: profile?.ipoDate ? profile.ipoDate.split("-")[0]! : base.snapshot.founded,
    exchange: profile?.exchange || quote?.exchange || base.snapshot.exchange,
  };

  // ---- Financials ----------------------------------------------------------
  let revenueGrowthYoY = base.financials.revenueGrowthYoY;
  if (income && income.length >= 2 && income[1]!.revenue) {
    revenueGrowthYoY = round(((income[0]!.revenue - income[1]!.revenue) / income[1]!.revenue) * 100);
  }
  const revenueHistory =
    income && income.length > 0
      ? [...income]
          .reverse()
          .map((r) => ({ period: `FY${r.fiscalYear}`, revenue: round(r.revenue / 1e9, 1) }))
      : base.financials.revenueHistory;
  const fcf = keyMetrics?.["freeCashFlowToEquityTTM"] ?? keyMetrics?.["freeCashFlowToFirmTTM"];

  report.financials = {
    isPlaceholder: !(hasFmp && !!ratios),
    revenueGrowthYoY,
    grossMargin: ratios?.["grossProfitMarginTTM"] != null ? pct(ratios["grossProfitMarginTTM"]) : base.financials.grossMargin,
    operatingMargin: ratios?.["operatingProfitMarginTTM"] != null ? pct(ratios["operatingProfitMarginTTM"]) : base.financials.operatingMargin,
    netMargin: ratios?.["netProfitMarginTTM"] != null ? pct(ratios["netProfitMarginTTM"]) : base.financials.netMargin,
    debtToEquity: ratios?.["debtToEquityRatioTTM"] != null ? round(ratios["debtToEquityRatioTTM"]) : base.financials.debtToEquity,
    currentRatio: ratios?.["currentRatioTTM"] != null ? round(ratios["currentRatioTTM"]) : base.financials.currentRatio,
    freeCashFlow: fcf ? formatBigUSD(fcf) : base.financials.freeCashFlow,
    revenueHistory,
  };

  // ---- Valuation -----------------------------------------------------------
  const intrinsicLow = priceTarget?.targetLow || (dcf ? round(dcf.dcf * 0.85) : base.valuation.intrinsicValueLow);
  const intrinsicHigh = priceTarget?.targetHigh || (dcf ? round(dcf.dcf * 1.15) : base.valuation.intrinsicValueHigh);
  const consensus = priceTarget?.targetConsensus ?? priceTarget?.targetMedian;
  const dcfNotes = dcf && dcf.dcf > 0
    ? `DCF intrinsic value estimate: $${round(dcf.dcf)}/share. At the current price of $${price}, the stock trades at a ${Math.abs(round(((price - dcf.dcf) / dcf.dcf) * 100))}% ${price >= dcf.dcf ? "premium to" : "discount to"} DCF fair value.${consensus ? ` Analyst consensus target: $${round(consensus)}.` : ""}`
    : base.valuation.dcfNotes;
  const peComparison =
    consensus && ratios?.["priceToEarningsRatioTTM"]
      ? `Trades at ${round(ratios["priceToEarningsRatioTTM"], 1)}x TTM earnings. Analyst consensus target of $${round(consensus)} implies ${round(((consensus - price) / price) * 100)}% ${consensus >= price ? "upside" : "downside"} from current levels.`
      : base.valuation.peComparison;

  report.valuation = {
    ...base.valuation,
    isPlaceholder: !(hasFmp && (!!dcf || !!priceTarget)),
    currentPrice: price,
    intrinsicValueLow: intrinsicLow,
    intrinsicValueHigh: intrinsicHigh,
    peComparison,
    evEbitda: keyMetrics?.["evToEBITDATTM"] != null ? round(keyMetrics["evToEBITDATTM"], 1) : base.valuation.evEbitda,
    priceToBook: ratios?.["priceToBookRatioTTM"] != null ? round(ratios["priceToBookRatioTTM"], 1) : base.valuation.priceToBook,
    priceToSales: ratios?.["priceToSalesRatioTTM"] != null ? round(ratios["priceToSalesRatioTTM"], 1) : base.valuation.priceToSales,
    dcfNotes,
  };

  // ---- Technical (from Alpaca SIP daily bars) ------------------------------
  if (bars && bars.closes.length > 0) {
    const ma50 = sma(bars.closes, 50);
    const ma200 = sma(bars.closes, 200);
    const rsiVal = rsi(bars.closes, 14);
    const sup = support(bars.lows, 60);
    const res = resistance(bars.highs, 60);
    const golden = ma50 != null && ma200 != null ? ma50 > ma200 : base.technical.goldenCross;
    const aboveMa200 = ma200 != null ? price > ma200 : true;
    report.technical = {
      ...base.technical,
      isPlaceholder: false,
      trend: ma50 != null && ma200 != null ? (ma50 > ma200 && price > ma50 ? "Bullish" : price < (ma200 ?? price) ? "Bearish" : "Mixed") : base.technical.trend,
      rsi: rsiVal != null ? round(rsiVal, 1) : base.technical.rsi,
      macd: ma50 != null && ma200 != null ? (ma50 > ma200 ? "Above long-term MA" : "Below long-term MA") : base.technical.macd,
      supportLevel: sup != null ? round(sup) : base.technical.supportLevel,
      resistanceLevel: res != null ? round(res) : base.technical.resistanceLevel,
      ma50: ma50 != null ? round(ma50) : base.technical.ma50,
      ma200: ma200 != null ? round(ma200) : base.technical.ma200,
      goldenCross: golden,
      notes: `Price is ${aboveMa200 ? "above" : "below"} the 200-day moving average${rsiVal != null ? `; RSI(14) at ${round(rsiVal, 1)} (${rsiVal >= 70 ? "overbought" : rsiVal <= 30 ? "oversold" : "neutral"})` : ""}. 50-day MA ${golden ? "above" : "below"} 200-day MA (${golden ? "golden-cross" : "death-cross"} regime). Levels derived from ${bars.closes.length} daily bars on the Alpaca SIP feed.`,
    };
  }

  // ---- News (real headlines; sentiment is heuristic) -----------------------
  if (newsList && newsList.length > 0) {
    report.news = {
      isPlaceholder: false,
      sentiment: (() => {
        const tones = newsList.map((n) => headlineSentiment(n.title));
        const bull = tones.filter((t) => t === "Bullish").length;
        const bear = tones.filter((t) => t === "Bearish").length;
        return bull > bear ? "Bullish" : bear > bull ? "Bearish" : "Neutral";
      })(),
      headlines: newsList.slice(0, 5).map((n) => ({
        title: n.title,
        source: n.source,
        date: n.date,
        sentiment: headlineSentiment(n.title),
      })),
    };
  }

  // ---- Catalysts (data-driven from real metrics) ---------------------------
  if (hasFmp && (ratios || income)) {
    const positive: string[] = [];
    const negative: string[] = [];
    if (revenueGrowthYoY != null) {
      (revenueGrowthYoY >= 5 ? positive : negative).push(
        `Revenue ${revenueGrowthYoY >= 0 ? "grew" : "declined"} ${Math.abs(revenueGrowthYoY)}% YoY in the latest fiscal year`,
      );
    }
    if (report.financials.operatingMargin != null) {
      (report.financials.operatingMargin >= 20 ? positive : negative).push(
        `Operating margin of ${report.financials.operatingMargin}% (${report.financials.operatingMargin >= 20 ? "healthy profitability" : "margin pressure"})`,
      );
    }
    if (report.financials.freeCashFlow) positive.push(`Generates ${report.financials.freeCashFlow} in free cash flow`);
    if (report.financials.debtToEquity != null && report.financials.debtToEquity > 1.5) {
      negative.push(`Elevated debt-to-equity of ${report.financials.debtToEquity}x`);
    }
    if (consensus && price) {
      const up = round(((consensus - price) / price) * 100);
      (up >= 0 ? positive : negative).push(`Analyst consensus implies ${Math.abs(up)}% ${up >= 0 ? "upside" : "downside"} to $${round(consensus)}`);
    }
    report.catalysts = {
      positive: positive.length ? positive : base.catalysts.positive,
      negative: negative.length ? negative : base.catalysts.negative,
      upcoming: base.catalysts.upcoming,
    };
  }

  // ---- Rating + scenarios + action plan ------------------------------------
  let finalRating = base.overallRating;
  if (rating && Number.isFinite(rating.overallScore)) {
    finalRating = rating.overallScore >= 4 ? "BUY" : rating.overallScore <= 2 ? "SELL" : "HOLD";
  } else if (consensus && price) {
    const up = (consensus - price) / price;
    finalRating = up >= 0.12 ? "BUY" : up <= -0.08 ? "SELL" : "HOLD";
  }
  report.overallRating = finalRating;

  if (priceTarget) {
    report.thesis = {
      bull: {
        ...base.thesis.bull,
        targetPrice: round(priceTarget.targetHigh || price * 1.45),
        summary: `Analyst high target of $${round(priceTarget.targetHigh)} — upside scenario driven by sustained execution and multiple expansion.`,
      },
      base: {
        ...base.thesis.base,
        targetPrice: round(consensus || price * 1.15),
        summary: `Analyst consensus target of $${round(consensus || price * 1.15)} — steady compounding in line with current estimates.`,
      },
      bear: {
        ...base.thesis.bear,
        targetPrice: round(priceTarget.targetLow || price * 0.72),
        summary: `Analyst low target of $${round(priceTarget.targetLow)} — downside on macro/competitive pressure and multiple compression.`,
      },
    };
  }

  report.actionPlan = {
    ...base.actionPlan,
    rating: finalRating,
    entryZone: `$${round(price * 0.95)} – $${round(price * 0.99)} (current area or pullback toward support)`,
    stopLoss: `$${report.technical.supportLevel != null ? round(report.technical.supportLevel) : round(price * 0.85)} (key support / risk level)`,
    profitTarget: `$${round(consensus || price * 1.15)} (consensus) | $${round(priceTarget?.targetHigh || price * 1.45)} (high target)`,
  };

  logger.info(
    { ticker, hasFmp, hasAlpaca, price, rating: finalRating },
    "Built live report",
  );

  return report;
}
