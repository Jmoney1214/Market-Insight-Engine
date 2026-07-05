// Post-flight attribution: how the market actually played out, which movers
// the 8:30 preflight missed, and WHY — reason codes derived ONLY from the
// scanner's logged gate telemetry, never re-inferred after the fact.

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

export const MOVER_THRESHOLD_PCT = 5;

/** Realized outcomes for one symbol's full-session bars. */
export function outcome(dayBars, prevClose) {
  const rth = dayBars.filter((b) => b.hm >= "09:40" && b.hm < "15:55");
  if (!rth.length || !prevClose) return null;
  const o = rth[0].o, cEnd = rth[rth.length - 1].c;
  const hi = Math.max(...rth.map((b) => b.h)), lo = Math.min(...rth.map((b) => b.l));
  const close = dayBars.filter((b) => b.hm < "16:00").at(-1)?.c ?? cEnd;
  return {
    cc: round(((close - prevClose) / prevClose) * 100),
    ride: round(((cEnd - o) / o) * 100),
    maxUp: round(((hi - o) / o) * 100),
    maxDn: round(((lo - o) / o) * 100),
  };
}

/** Map a telemetry record (+ engine result when eligible) to ONE reason code,
 * reading the logged gates in cascade order. */
export function reasonCode(rec, pick) {
  if (!rec) return { code: "NOT_IN_UNIVERSE", detail: "not in screener universe" };
  const failed = (name) => rec.gates.find((g) => g.gate === name && !g.pass);
  let g;
  if ((g = failed("history_30d"))) return { code: "GATED_HISTORY", detail: `${g.value} sessions of history (<30)` };
  if ((g = failed("price_ceiling"))) return { code: "GATED_PRICE_CAP", detail: `$${g.value} > $150 and not scalper-class` };
  if ((g = failed("prelim_rank_top30"))) {
    return Math.abs(rec.gap) < 1.5
      ? { code: "INVISIBLE_AT_0830", detail: `gap ${rec.gap >= 0 ? "+" : ""}${rec.gap}% at 08:30 — below board thresholds` }
      : { code: "RANK_CUT", detail: `prelim rank ${g.value} (top 30 cut)` };
  }
  if ((g = failed("badge"))) return { code: "BADGE_CUT", detail: `class ${g.value} — no validated engine` };
  if ((g = failed("mtd_min7"))) return { code: "GATED_MTD", detail: `${g.value}/10 multi-trade days (<7)` };
  if ((g = failed("pm_dollar_2m"))) return { code: "GATED_PMVOL", detail: `$${Math.round(g.value / 1e5) / 10}M pre-market (<$2M)` };
  if ((g = failed("top5_score"))) return { code: "TOP5_CUT", detail: `score ${g.value} below the day's top-5` };
  if (pick) {
    if (pick.status.startsWith("declined")) return { code: "DECLINED", detail: pick.status };
    if (pick.trades?.length) return { code: "TRADED", detail: `${pick.trades.length} trade(s)` };
    return { code: "NO_TRIGGER", detail: "qualified; 9-EMA pullback never fired 09:40-11:00" };
  }
  return { code: "UNKNOWN", detail: "eligible but no engine result recorded" };
}

/** Full attribution for one day. */
export function attribute({ day, board, picks, dailies, dayBarsMap }) {
  const outcomes = new Map();
  for (const [sym, bars] of dayBarsMap) {
    const rec = board.telemetry.get(sym);
    // Gate-excluded symbols (e.g. GATED_HISTORY) have no prevClose in telemetry
    // — fall back to the daily bars so their misses are still visible.
    let prevClose = rec?.prevClose;
    if (prevClose == null) {
      const hist = (dailies.get(sym) ?? []).filter((b) => b.t.slice(0, 10) < day);
      prevClose = hist.at(-1)?.c ?? null;
    }
    const o = outcome(bars, prevClose);
    if (o) outcomes.set(sym, o);
  }
  const pickBySym = new Map(picks.map((p) => [p.sym, p]));
  const movers = [];
  for (const [sym, o] of outcomes) {
    if (Math.abs(o.cc) < MOVER_THRESHOLD_PCT && Math.abs(o.ride) < MOVER_THRESHOLD_PCT) continue;
    const rec = board.telemetry.get(sym);
    const { code, detail } = reasonCode(rec, pickBySym.get(sym));
    movers.push({ sym, ...o, gapAt0830: rec?.gap ?? null, cls: rec?.cls ?? null, code, detail });
  }
  movers.sort((a, b) => Math.abs(b.cc) - Math.abs(a.cc));

  const upMovers = movers.filter((m) => m.ride >= MOVER_THRESHOLD_PCT);
  const onBoardCodes = new Set(["TOP5_CUT", "DECLINED", "NO_TRIGGER", "TRADED", "GATED_MTD", "GATED_PMVOL", "BADGE_CUT"]);
  const netPnl = picks.flatMap((p) => p.trades ?? []).reduce((s, t) => s + t.pnl, 0);
  // Opportunity = long-only, standard half-notional ($12.5k) on each >=5% up-ride.
  const opportunity = upMovers.reduce((s, m) => s + (m.ride / 100) * 12500, 0);
  const catchRates = {
    movers: movers.length,
    boardCatch: movers.length ? round(movers.filter((m) => onBoardCodes.has(m.code)).length / movers.length * 100, 1) : 0,
    tradeableCatch: upMovers.length ? round(upMovers.filter((m) => ["TRADED", "NO_TRIGGER", "DECLINED"].includes(m.code)).length / upMovers.length * 100, 1) : 0,
    tradedCatch: upMovers.length ? round(upMovers.filter((m) => m.code === "TRADED").length / upMovers.length * 100, 1) : 0,
    netPnl: round(netPnl), opportunity: round(opportunity),
    captureRatio: opportunity > 0 ? round(netPnl / opportunity * 100, 1) : null,
  };
  return { day, movers, catchRates };
}
