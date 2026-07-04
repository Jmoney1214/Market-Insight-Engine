/**
 * Pre-market scan pipeline — the "morning research" engine.
 *
 * Universe (FMP screener: liquid, active, < priceCeiling)
 *   -> batch snapshots (Alpaca SIP, pre/post-market aware gaps)
 *   -> catalyst overlay (earnings today, analyst grade changes, fresh news)
 *   -> bar enrichment for finalists (ATR%, RSI from real daily bars)
 *   -> three ranked lists: topIntraday, likelyJump, likelyFall.
 *
 * This is an evidence ranker, not a prophecy machine: every candidate carries
 * the reasons it scored, and the composite favors *tradeability* (range,
 * liquidity) plus *catalysts* over naked momentum.
 */
import { hasFmp, hasAlpaca } from "./providers/config.js";
import { replayAsOf } from "./replay.js";
import { logger } from "./logger.js";
import * as fmp from "./providers/fmp.js";
import * as alpaca from "./providers/alpaca.js";
import { atr, rsi, rangeStats } from "./providers/indicators.js";

export type ScanCandidate = {
  symbol: string;
  companyName: string | null;
  price: number;
  gapPct: number;
  avgVolume: number | null;
  atrPct: number | null;
  rsi: number | null;
  avgDailyRangePct: number | null;
  multiTradeDays: number | null;
  score: number;
  reasons: string[];
};

export type ScanResult = {
  generatedAt: string;
  universeSize: number;
  priceCeiling: number;
  note: string;
  topIntraday: ScanCandidate[];
  likelyJump: ScanCandidate[];
  likelyFall: ScanCandidate[];
};

const PRICE_CEILING = 150;
const GAP_THRESHOLD = 1.5; // % — minimum move to call a gapper
const TOP_N = 12;
const ENRICH_N = 30; // finalists that get real bar-based ATR/RSI
const CACHE_TTL_MS = 5 * 60 * 1000;

const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

let cached: { at: number; result: ScanResult } | null = null;

function todayNY(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function scanAvailable(): boolean {
  return hasFmp && hasAlpaca;
}

/** Minutes since midnight in New York, plus weekday flag. */
function nyClock(): { minutes: number; isWeekday: boolean } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const isWeekday = !["Sat", "Sun"].includes(get("weekday"));
  return { minutes, isWeekday };
}

const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;
const WINDOW_START = 7 * 60; // 7:00 ET — research is ready well before 8:30
const WINDOW_END = 16 * 60; // 4:00 ET — keep movers fresh through the close
const RECORD_START = 8 * 60 + 15; // record the actionable pre-open picks (8:15-9:30)
const RECORD_END = 9 * 60 + 30;
const GRADE_AFTER = 16 * 60 + 15; // grade once the session bar is final

function todayNYDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Proactive hunter + accountability loop, every 5 minutes on weekdays:
 *  - 07:00-16:00 ET: refresh the scan so the dashboard opens pre-researched.
 *  - 08:15-09:30 ET: record the morning picks to the scorecard (idempotent).
 *  - after 16:15 ET (throttled hourly): grade pending picks vs the actual
 *    session bar, building the measured hit rate.
 * ~10 provider calls per refresh — negligible against the 750/min budget.
 */
export function startScanScheduler(): void {
  if (replayAsOf()) {
    logger.info("Scan scheduler not started (SCAN_AS_OF replay mode — frozen clock, no recording/grading)");
    return;
  }
  if (!scanAvailable()) {
    logger.info("Scan scheduler not started (provider keys missing)");
    return;
  }
  let lastGradeAttempt = 0;
  const tick = async () => {
    const { minutes, isWeekday } = nyClock();
    if (!isWeekday) return;
    const { recordScanPicks, gradePending } = await import("./scorecard.js");

    if (minutes >= WINDOW_START && minutes < WINDOW_END) {
      try {
        const result = await runPremarketScan(true);
        logger.info("Scheduled scan refreshed");
        if (minutes >= RECORD_START && minutes <= RECORD_END) {
          await recordScanPicks(result, todayNYDate());
        }
      } catch (err) {
        logger.warn({ err: String(err) }, "Scheduled scan failed");
      }
      return;
    }

    // Outside market hours: grade anything pending (today after 16:15, or older days).
    if (Date.now() - lastGradeAttempt < 60 * 60 * 1000) return;
    lastGradeAttempt = Date.now();
    const maxDate = minutes >= GRADE_AFTER ? todayNYDate() : new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    try {
      await gradePending(maxDate);
    } catch (err) {
      logger.warn({ err: String(err) }, "Scorecard grading pass failed");
    }
  };
  setInterval(tick, SCHEDULER_INTERVAL_MS).unref();
  void tick(); // warm immediately if we boot inside the window
  logger.info("Scan scheduler started (weekdays: refresh 07:00-16:00 ET, record 08:15-09:30, grade after close)");
}

export async function runPremarketScan(refresh = false): Promise<ScanResult> {
  // Trading-day simulation: SCAN_AS_OF freezes the board at a historical moment.
  if (replayAsOf()) {
    const { runPitReplayScan } = await import("./replay.js");
    return runPitReplayScan(refresh);
  }
  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  // 1. Universe — liquid US names under the ceiling (ETFs/funds excluded).
  // Plain-ticker filter: FMP emits share-class forms like "BRK-B" that Alpaca's
  // batch snapshot rejects with a 400 for the whole chunk.
  const universe = ((await fmp.getScreenerUniverse(PRICE_CEILING, 500)) ?? []).filter((u) =>
    /^[A-Z]{1,5}$/.test(u.symbol),
  );
  const bySymbol = new Map(universe.map((u) => [u.symbol, u]));

  // 2. Live gaps for the whole universe (batched SIP snapshots).
  const snaps = (await alpaca.getSnapshots(universe.map((u) => u.symbol))) ?? new Map();

  // 3. Catalyst overlays — three cheap market-wide calls.
  const [earnings, grades] = await Promise.all([
    fmp.getEarningsCalendar(todayNY(), todayNY(1)),
    fmp.getLatestGradeChanges(150),
  ]);
  const gradeMap = new Map<string, fmp.FmpGradeChange>();
  for (const g of grades ?? []) if (!gradeMap.has(g.symbol)) gradeMap.set(g.symbol, g);

  // Preliminary score to pick finalists worth a bar fetch.
  type Prelim = { symbol: string; gapPct: number; price: number; dollarVol: number; prelim: number };
  const prelims: Prelim[] = [];
  for (const [sym, snap] of snaps) {
    const u = bySymbol.get(sym);
    if (!u || snap.price > PRICE_CEILING) continue;
    const dollarVol = u.volume * snap.price;
    const catalyst = (earnings?.has(sym) ? 1 : 0) + (gradeMap.has(sym) ? 0.6 : 0);
    prelims.push({
      symbol: sym,
      gapPct: snap.gapPct,
      price: snap.price,
      dollarVol,
      prelim: Math.abs(snap.gapPct) + catalyst * 2 + clamp01(Math.log10(dollarVol / 1e8)) ,
    });
  }
  prelims.sort((a, b) => b.prelim - a.prelim);
  const finalists = prelims.slice(0, ENRICH_N);

  // News overlay only for finalists (single multi-symbol call).
  const newsMap = (await alpaca.getNewsMulti(finalists.map((f) => f.symbol))) ?? new Map();

  // 4. Bar enrichment (parallel; ~45 days is enough for ATR14 + RSI14).
  const barsList = await Promise.all(
    finalists.map((f) => alpaca.getDailyBars(f.symbol, 60).catch(() => null)),
  );

  const candidates: ScanCandidate[] = finalists.map((f, i) => {
    const u = bySymbol.get(f.symbol);
    const snap = snaps.get(f.symbol);
    const bars = barsList[i];
    let atrPct: number | null = null;
    let rsiVal: number | null = null;
    let avgDailyRangePct: number | null = null;
    let multiTradeDays: number | null = null;
    if (bars && bars.closes.length > 15) {
      const a = atr(bars.highs, bars.lows, bars.closes, 14);
      atrPct = a != null ? round((a / f.price) * 100) : null;
      const r = rsi(bars.closes, 14);
      rsiVal = r != null ? round(r, 1) : null;
      const rs = rangeStats(bars.highs, bars.lows, bars.closes, 10, 2);
      if (rs) {
        avgDailyRangePct = round(rs.avgRangePct, 1);
        multiTradeDays = rs.daysAboveThreshold;
      }
    }

    const reasons: string[] = [];
    if (multiTradeDays != null && multiTradeDays >= 7)
      reasons.push(`Ranged ≥2% on ${multiTradeDays} of last 10 days (multi-trade profile)`);
    if (Math.abs(f.gapPct) >= GAP_THRESHOLD)
      reasons.push(`Gap ${f.gapPct >= 0 ? "+" : ""}${round(f.gapPct)}% vs last close`);
    if (earnings?.has(f.symbol)) reasons.push("Earnings today/next session");
    const grade = gradeMap.get(f.symbol);
    if (grade)
      reasons.push(
        `${grade.action.includes("up") ? "Upgraded" : grade.action.includes("down") ? "Downgraded" : `Rated ${grade.newGrade}`} by ${grade.gradingCompany}`,
      );
    const headline = newsMap.get(f.symbol);
    if (headline) reasons.push(`News: ${headline.slice(0, 80)}`);
    if (atrPct != null && atrPct >= 3) reasons.push(`High daily range (ATR ${atrPct}%)`);
    if (rsiVal != null && rsiVal >= 70) reasons.push(`RSI ${rsiVal} (overbought)`);
    if (rsiVal != null && rsiVal <= 30) reasons.push(`RSI ${rsiVal} (oversold)`);

    // Composite 0-100: "multiple trades today" first — repeatable range (day-in,
    // day-out ≥2% sessions + ATR) and liquidity — then gap + catalysts.
    const repeatability = clamp01((multiTradeDays ?? 3) / 8);
    const rangeSize = clamp01((atrPct ?? 1.5) / 5);
    const volatility = 0.55 * repeatability + 0.45 * rangeSize;
    const liquidity = clamp01(Math.log10(Math.max(f.dollarVol, 1)) / Math.log10(5e9));
    const gapMag = clamp01(Math.abs(f.gapPct) / 5);
    const catalyst = clamp01(
      (earnings?.has(f.symbol) ? 0.5 : 0) + (grade ? 0.3 : 0) + (headline ? 0.2 : 0),
    );
    const score = round(
      100 * (0.4 * volatility + 0.25 * liquidity + 0.15 * gapMag + 0.2 * catalyst),
      1,
    );

    return {
      symbol: f.symbol,
      companyName: u?.companyName ?? null,
      price: round(f.price),
      gapPct: round(f.gapPct),
      avgVolume: u?.volume ?? null,
      atrPct,
      rsi: rsiVal,
      avgDailyRangePct,
      multiTradeDays,
      score,
      reasons,
    };
  });

  const topIntraday = [...candidates].sort((a, b) => b.score - a.score).slice(0, TOP_N);
  const likelyJump = candidates
    .filter((c) => c.gapPct >= GAP_THRESHOLD)
    .sort((a, b) => b.gapPct - a.gapPct)
    .slice(0, TOP_N);
  const likelyFall = candidates
    .filter((c) => c.gapPct <= -GAP_THRESHOLD)
    .sort((a, b) => a.gapPct - b.gapPct)
    .slice(0, TOP_N);

  const result: ScanResult = {
    generatedAt: new Date().toISOString(),
    universeSize: universe.length,
    priceCeiling: PRICE_CEILING,
    note: "Evidence-ranked scan (gap, range, liquidity, catalysts) over a liquid under-$150 universe — research input, not a guarantee of direction.",
    topIntraday,
    likelyJump,
    likelyFall,
  };

  cached = { at: Date.now(), result };
  logger.info(
    { universe: universe.length, snaps: snaps.size, finalists: finalists.length },
    "Pre-market scan complete",
  );
  return result;
}
