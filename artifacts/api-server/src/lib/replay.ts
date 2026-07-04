/**
 * Point-in-time (PIT) replay mode for the Morning Scan.
 *
 * When SCAN_AS_OF is set (e.g. "2026-07-01T08:00"), /scan/premarket serves the
 * board exactly as it would have looked at that ET moment: gaps from pre-market
 * trades up to the cutoff, indicators from daily bars strictly before the
 * session, catalysts from dated historical sources. The real dashboard renders
 * it unchanged. Used for trading-day simulation drills; never writes to the
 * scorecard.
 */
import { alpacaFeed, alpacaKeyId, alpacaSecretKey } from "./providers/config.js";
import { logger } from "./logger.js";
import { atr, rsi, rangeStats } from "./providers/indicators.js";
import * as fmp from "./providers/fmp.js";
import type { ScanCandidate, ScanResult } from "./scan.js";

const TOP_N = 12;
const GAP_T = 1.5;
const ENRICH_N = 30;
const PRICE_CEILING = 150;

const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function replayAsOf(): { date: string; cutoffUtc: string } | null {
  const raw = process.env["SCAN_AS_OF"]?.trim();
  if (!raw) return null;
  const [date, time = "08:00"] = raw.split("T");
  // ET summer offset (EDT, UTC-4) — the drill dates are all summer sessions.
  const [h, m] = time!.split(":").map(Number);
  const cutoffUtc = `${date}T${String((h ?? 8) + 4).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}:00Z`;
  return { date: date!, cutoffUtc };
}

type Bar = { t: string; o: number; h: number; l: number; c: number; v: number };
const AH = () => ({ "APCA-API-KEY-ID": alpacaKeyId, "APCA-API-SECRET-KEY": alpacaSecretKey });

async function batchBars(symbols: string[], params: Record<string, string>): Promise<Map<string, Bar[]>> {
  const out = new Map<string, Bar[]>();
  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100);
    let pageToken = "";
    do {
      const u = new URL("https://data.alpaca.markets/v2/stocks/bars");
      u.searchParams.set("symbols", chunk.join(","));
      u.searchParams.set("feed", alpacaFeed);
      u.searchParams.set("adjustment", "split");
      u.searchParams.set("limit", "10000");
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (pageToken) u.searchParams.set("page_token", pageToken);
      const res = await fetch(u, { headers: AH(), signal: AbortSignal.timeout(20000) });
      if (!res.ok) break;
      const data = (await res.json()) as { bars?: Record<string, Bar[]>; next_page_token?: string };
      for (const [sym, bars] of Object.entries(data.bars ?? {})) out.set(sym, [...(out.get(sym) ?? []), ...bars]);
      pageToken = data.next_page_token ?? "";
    } while (pageToken);
  }
  return out;
}

async function historicalNews(symbols: string[], date: string, cutoffUtc: string): Promise<Map<string, string>> {
  const u = new URL("https://data.alpaca.markets/v1beta1/news");
  u.searchParams.set("symbols", symbols.slice(0, 100).join(","));
  u.searchParams.set("start", new Date(new Date(date).getTime() - 86_400_000).toISOString().slice(0, 10) + "T20:00:00Z");
  u.searchParams.set("end", cutoffUtc);
  u.searchParams.set("limit", "50");
  const map = new Map<string, string>();
  try {
    const res = await fetch(u, { headers: AH(), signal: AbortSignal.timeout(15000) });
    if (!res.ok) return map;
    const data = (await res.json()) as { news?: Array<Record<string, any>> };
    for (const n of data.news ?? []) for (const s of (n["symbols"] ?? []) as string[]) if (!map.has(s)) map.set(s, String(n["headline"] ?? ""));
  } catch { /* news is enrichment only */ }
  return map;
}

let cached: { key: string; result: ScanResult } | null = null;

export async function runPitReplayScan(refresh = false): Promise<ScanResult> {
  const asOf = replayAsOf();
  if (!asOf) throw new Error("SCAN_AS_OF not set");
  const key = asOf.cutoffUtc;
  if (!refresh && cached?.key === key) return cached.result;
  const { date, cutoffUtc } = asOf;

  const uni = ((await fmp.getScreenerUniverse(PRICE_CEILING, 500)) ?? []).filter((u) => /^[A-Z]{1,5}$/.test(u.symbol));
  const symbols = uni.map((u) => u.symbol);
  const nameOf = new Map(uni.map((u) => [u.symbol, u.companyName]));

  const histStart = new Date(new Date(date).getTime() - 130 * 86_400_000).toISOString().slice(0, 10);
  const [dailies, pmBars, earnings] = await Promise.all([
    batchBars(symbols, { timeframe: "1Day", start: histStart, end: `${date}T00:00:00Z` }),
    batchBars(symbols, { timeframe: "5Min", start: `${date}T08:00:00Z`, end: cutoffUtc }),
    fmp.getEarningsCalendar(date, date),
  ]);

  type Pre = { sym: string; price: number; gap: number; pmVol: number; atrPct: number | null; mtd: number | null; rsiV: number | null; dollarVol: number };
  const pre: Pre[] = [];
  for (const sym of symbols) {
    const hist = (dailies.get(sym) ?? []).filter((b) => b.t.slice(0, 10) < date);
    if (hist.length < 30) continue;
    const refClose = hist[hist.length - 1]!.c;
    const pms = pmBars.get(sym) ?? [];
    const price = pms.length > 0 ? pms[pms.length - 1]!.c : refClose;
    if (price > PRICE_CEILING) continue; // ceiling enforced at the as-of price
    const highs = hist.map((b) => b.h), lows = hist.map((b) => b.l), closes = hist.map((b) => b.c);
    const a = atr(highs, lows, closes, 14);
    const rs = rangeStats(highs, lows, closes, 10, 2);
    const vol20 = hist.slice(-20).reduce((s, b) => s + b.v, 0) / Math.min(20, hist.length);
    pre.push({
      sym,
      price: round(price),
      gap: round(((price - refClose) / refClose) * 100),
      pmVol: pms.reduce((s, b) => s + b.v, 0),
      atrPct: a != null ? round((a / price) * 100) : null,
      mtd: rs?.daysAboveThreshold ?? null,
      rsiV: rsi(closes, 14) != null ? round(rsi(closes, 14)!, 1) : null,
      dollarVol: vol20 * refClose,
    });
  }

  const prelimScore = (c: Pre) => Math.abs(c.gap) + (earnings?.has(c.sym) ? 2 : 0) + clamp01(Math.log10(Math.max(c.dollarVol, 1) / 1e8));
  const finalists = [...pre].sort((a, b) => prelimScore(b) - prelimScore(a)).slice(0, ENRICH_N);
  const newsMap = await historicalNews(finalists.map((f) => f.sym), date, cutoffUtc);

  const candidates: ScanCandidate[] = finalists.map((c) => {
    const reasons: string[] = [];
    if (c.mtd != null && c.mtd >= 7) reasons.push(`Ranged ≥2% on ${c.mtd} of last 10 days (multi-trade profile)`);
    if (Math.abs(c.gap) >= GAP_T) reasons.push(`Gap ${c.gap >= 0 ? "+" : ""}${c.gap}% vs last close`);
    if (c.pmVol > 0) reasons.push(`Pre-market volume ${(c.pmVol / 1000).toFixed(0)}k by cutoff`);
    if (earnings?.has(c.sym)) reasons.push("Earnings today/next session");
    const headline = newsMap.get(c.sym);
    if (headline) reasons.push(`News: ${headline.slice(0, 80)}`);
    const volatility = 0.55 * clamp01((c.mtd ?? 3) / 8) + 0.45 * clamp01((c.atrPct ?? 1.5) / 5);
    const liquidity = clamp01(Math.log10(Math.max(c.dollarVol, 1)) / Math.log10(5e9));
    const gapMag = clamp01(Math.abs(c.gap) / 5);
    const catalyst = clamp01((earnings?.has(c.sym) ? 0.5 : 0) + (headline ? 0.2 : 0));
    return {
      symbol: c.sym,
      companyName: nameOf.get(c.sym) ?? null,
      price: c.price,
      gapPct: c.gap,
      avgVolume: null,
      atrPct: c.atrPct,
      rsi: c.rsiV,
      avgDailyRangePct: null,
      multiTradeDays: c.mtd,
      score: round(100 * (0.4 * volatility + 0.25 * liquidity + 0.15 * gapMag + 0.2 * catalyst), 1),
      reasons,
    };
  });

  const result: ScanResult = {
    generatedAt: new Date(cutoffUtc).toISOString(),
    universeSize: uni.length,
    priceCeiling: PRICE_CEILING,
    note: `REPLAY MODE — point-in-time board as of ${date} ${process.env["SCAN_AS_OF"]?.split("T")[1] ?? "08:00"} ET. Inputs restricted to what was knowable at that moment; no scorecard recording.`,
    topIntraday: [...candidates].sort((a, b) => b.score - a.score).slice(0, TOP_N),
    likelyJump: candidates.filter((c) => c.gapPct >= GAP_T).sort((a, b) => b.gapPct - a.gapPct).slice(0, TOP_N),
    likelyFall: candidates.filter((c) => c.gapPct <= -GAP_T).sort((a, b) => a.gapPct - b.gapPct).slice(0, TOP_N),
  };
  cached = { key, result };
  logger.info({ date, cutoffUtc, universe: uni.length, finalists: finalists.length }, "PIT replay scan built");
  return result;
}
