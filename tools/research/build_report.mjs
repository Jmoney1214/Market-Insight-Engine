// Detailed replay-grader post-mortem in Markdown, generated from pipeline_results.json.
// node build_report.mjs [results.json] [out.md]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { money, pct, bigD, dLabel, pickPnl, statusInfo, noteFor, CODEDESC, esc } from "./lib/reportlib.mjs";

// Paths resolve relative to this script (tools/research/), so the tool is portable:
// pipeline_results.json sits alongside it; the report lands in research/reports/.
const SRC = process.argv[2] || fileURLToPath(new URL("./pipeline_results.json", import.meta.url));
const raw = JSON.parse(readFileSync(SRC, "utf8"));
const M = raw.meta || {};
const days = (Array.isArray(raw.results) ? raw.results : []).filter((d) => !d.noSession);
if (!days.length) {
  console.error(`No results in ${SRC} — run pipeline.mjs first.`);
  process.exit(1);
}
const OUT = process.argv[3] || fileURLToPath(new URL(`../../research/reports/${(M.dateRange || "replay").replace("..", "_")}_detailed.md`, import.meta.url));

const wd = (iso) => dLabel(iso).wd;
const catchOf = (d) => (d.attribution && d.attribution.catchRates) || {};
const moversOf = (d) => (d.attribution && d.attribution.movers) || [];
const picksOf = (d) => d.picks || [];
const statusMd = (s) => { const i = statusInfo(s); return `**${i.label}**${i.why ? " — " + i.why : ""}`; };
const capPct = (v) => (v != null ? `${v}%` : "n/a");
const mdCell = (s) => String(s == null ? "" : s).replace(/\|/g, "\\|"); // markdown table-cell safe

let out = "";
const w = (s = "") => { out += s + "\n"; };

// ---- week-level derived facts (data-driven; reused by synthesis + enhancement) ----
const agg = {}; let totUntraded = 0; // reason codes across movers that were NOT traded
days.forEach((d) => moversOf(d).forEach((m) => { const c = m.code || "—"; if (c === "TRADED") return; agg[c] = (agg[c] || 0) + 1; totUntraded++; }));
const share = (ks) => (totUntraded ? ((ks.reduce((a, c) => a + (agg[c] || 0), 0) / totUntraded) * 100).toFixed(0) : "0");
const validated = days.flatMap(moversOf).filter((m) => m.cls === "rider" || m.cls === "scalper");
const exOf = (codes) => {
  const seen = new Set();
  const a = validated.filter((m) => codes.includes(m.code))
    .sort((x, y) => (y.ride || 0) - (x.ride || 0))
    .filter((m) => (seen.has(m.sym) ? false : (seen.add(m.sym), true)))
    .slice(0, 3);
  return a.length ? a.map((m) => `${m.sym} (${pct(m.ride)})`).join(", ") : "none this week";
};
const rankCutEx = exOf(["RANK_CUT", "TOP5_CUT"]);
const priceCapEx = exOf(["GATED_PRICE_CAP"]);

const net = days.reduce((a, d) => a + (d.dayPnl || 0), 0);
const avgCatch = days.reduce((a, d) => a + (catchOf(d).boardCatch || 0), 0) / days.length;
const greenDays = days.filter((d) => (d.dayPnl || 0) > 0).length;
const oneIn = avgCatch > 0 ? Math.round(100 / avgCatch) : null;

w(`# Replay-Grader — Detailed Post-Mortem`);
w(`### Week of ${wd(days[0].day)} ${days[0].day} → ${wd(days.at(-1).day)} ${days.at(-1).day}`);
w();
w(`_Generated ${M.generatedAt || "—"} · git \`${M.gitSha || "—"}\` · config \`${M.configHash || "—"}\` · ${M.dataProvider || "—"} · fill \`${M.fillMode || "—"}\`_`);
w();
w(`> **How to read this.** For every session: **(1)** what the desk put on its board and *why it chose those names*, **(2)** the day's *actual* best-moving tickers, and **(3)** the honest gap — which real opportunities we missed and the *exact* reason the system passed. Enhancement ideas are at the end. Numbers are point-in-time (08:30 ET cutoff); a single week is an anecdote, not a statistic.`);
w();

w(`## Week at a glance`);
w();
w(`| Session | P&L | Eligible | Traded | Real movers | Board-catch | Capture | Verdict |`);
w(`|---|--:|--:|--:|--:|--:|--:|---|`);
for (const d of days) {
  const cr = catchOf(d);
  const traded = picksOf(d).filter((p) => (p.status || "").startsWith("traded")).length;
  const v = d.dayPnl > 0 ? "green day" : d.dayPnl < 0 ? "red day" : (traded === 0 ? "sat out" : "flat");
  w(`| ${wd(d.day)} ${d.day} | ${money(d.dayPnl, 0)} | ${picksOf(d).length} | ${traded} | ${cr.movers ?? "—"} | ${cr.boardCatch ?? "—"}% | ${capPct(cr.captureRatio)} | ${v} |`);
}
w(`| **Week** | **${money(net, 0)}** | | | | **${avgCatch.toFixed(1)}% avg** | | |`);
w();
const greenLine = greenDays === 1 ? "A single green session carried the week." : greenDays > 1 ? `${greenDays} green sessions carried the week.` : "No session finished green.";
w(`**Read:** the desk netted **${money(net, 0)}** over ${days.length} session${days.length === 1 ? "" : "s"} at $25k/pick, but average board-catch is **${avgCatch.toFixed(1)}%** — ${oneIn ? `it sees roughly **1 in ${oneIn}** of each day's real movers` : "it caught none of the movers"}. ${greenLine} The rest of this document explains *why* that catch rate is what it is.`);
w();

for (const d of days) {
  const cr = catchOf(d);
  const picks = picksOf(d);
  const movers = moversOf(d);
  const ourSyms = new Set(picks.map((p) => p.sym));
  w(`---`);
  w();
  w(`## ${wd(d.day)}, ${d.day}  ·  ${money(d.dayPnl)}`);
  w();
  w(`Universe ${(d.universeSize || 0).toLocaleString()} · real movers **${cr.movers ?? "—"}** · board caught **${cr.boardCatch ?? "—"}%** · tradeable caught **${cr.tradeableCatch ?? "—"}%** · traded **${cr.tradedCatch ?? "—"}%** · opportunity on tape **${bigD(cr.opportunity)}** · we captured **${capPct(cr.captureRatio)}** of it.`);
  w();

  w(`### 1 · What the desk traded — and *why these names*`);
  w();
  w(`Every name below cleared the 08:30 screen (gap + pre-market dollar-volume + volatility) and was ranked by score. The **badge** decides which engine, if any, is allowed to act.`);
  w();
  w(`| # | Ticker | Badge | Gap | PM $vol | Avg range | Score | Decision | P&L |`);
  w(`|--:|---|---|--:|--:|--:|--:|---|--:|`);
  picks.forEach((p, i) => {
    const pl = pickPnl(p);
    w(`| ${i + 1} | **${p.sym}**${p.companyName ? ` <sub>${mdCell(esc(p.companyName))}</sub>` : ""} | \`${p.cls || "—"}\` | ${pct(p.gap)} | ${bigD(p.pmDollar)} | ${pct(p.avgRange)} | ${p.score ?? "—"} | ${(p.status || "").split(":")[0]} | ${p.trades && p.trades.length ? money(pl) : "—"} |`);
  });
  w();
  picks.forEach((p) => {
    const pl = pickPnl(p);
    w(`- **${p.sym}** was chosen because it gapped **${pct(p.gap)}** on **${bigD(p.pmDollar)}** of pre-market volume (avg daily range ${pct(p.avgRange)}, score ${p.score ?? "—"}). Badged \`${p.cls || "—"}\` — ${noteFor(p.cls)} ${statusMd(p.status)}`);
    if (p.trades && p.trades.length) {
      const legs = p.trades.map((t) => `${t.entryHm}→${t.exitHm} ${money(t.pnl)} (${t.reason})`).join("; ");
      w(`  - Fills: ${legs}. **Net ${money(pl)}.**`);
    } else {
      const mv = movers.find((m) => m.sym === p.sym);
      if (mv) w(`  - Sat out. Actual 09:40→15:50: ride ${pct(mv.ride)}, max up ${pct(mv.maxUp)}, max down ${pct(mv.maxDn)} — ${mv.detail || mv.code}.`);
    }
  });
  w();

  const gainers = [...movers].sort((a, b) => (b.cc || 0) - (a.cc || 0)).slice(0, 10);
  const tradeable = [...movers].sort((a, b) => (b.ride || 0) - (a.ride || 0)).slice(0, 10);
  w(`### 2 · The day's *actual* best tickers`);
  w();
  w(`Two different questions. **(a)** What moved most on the day — impressive, but most of it happens overnight and is gone by the 08:30 bell. **(b)** What was actually *capturable intraday* (the 09:40→15:50 "ride") — the real opportunity a morning desk can trade.`);
  w();
  w(`**(a) Biggest headline movers (full-day % change):**`);
  w();
  w(`| Ticker | Day move | Gapped by 08:30 | Intraday ride | Badge | On board? |`);
  w(`|---|--:|--:|--:|---|:--:|`);
  gainers.forEach((m) => {
    const g = m.gapAt0830 || 0;
    const sameDir = m.cc ? (g === 0 || (g > 0) === (m.cc > 0)) : false;
    const ovn = !m.cc ? "—" : sameDir ? `${Math.min(100, Math.abs(g / m.cc) * 100).toFixed(0)}% of move` : "gapped counter to the move";
    w(`| **${m.sym}** | ${pct(m.cc)} | ${pct(m.gapAt0830)} (${ovn}) | ${pct(m.ride)} | \`${m.cls || "—"}\` | ${ourSyms.has(m.sym) ? "✅" : "—"} |`);
  });
  w();
  w(`**(b) Biggest *intraday-tradeable* movers (09:40→15:50 ride — what we could actually have caught):**`);
  w();
  w(`| Ticker | Ride | Max↑ | Max↓ | Gap@0830 | Badge | On board? | Why not traded |`);
  w(`|---|--:|--:|--:|--:|---|:--:|---|`);
  tradeable.forEach((m) => {
    const onBoard = ourSyms.has(m.sym);
    const why = onBoard ? "on board — " + ((picks.find((p) => p.sym === m.sym) || {}).status || "") : (m.detail || m.code || "");
    w(`| **${m.sym}** | ${pct(m.ride)} | ${pct(m.maxUp)} | ${pct(m.maxDn)} | ${pct(m.gapAt0830)} | \`${m.cls || "—"}\` | ${onBoard ? "✅" : "—"} | ${mdCell(why)} |`);
  });
  w();

  w(`### 3 · Why the system missed the best`);
  w();
  const untraded = movers.filter((m) => (m.code || "") !== "TRADED");
  const counts = {};
  untraded.forEach((m) => { counts[m.code || "—"] = (counts[m.code || "—"] || 0) + 1; });
  const codeRows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  w(`**Reason codes across the ${untraded.length} un-traded movers:**`);
  w();
  codeRows.forEach(([c, n]) => w(`- \`${c}\` — **${n}** (${untraded.length ? (n / untraded.length * 100).toFixed(0) : 0}%)`));
  w();
  w(`**Why the top-10 intraday movers weren't traded** (by actual reason code):`);
  w();
  const grp = {}; tradeable.forEach((m) => { const k = ourSyms.has(m.sym) ? "ON_BOARD" : (m.code || "OTHER"); (grp[k] = grp[k] || []).push(m); });
  Object.entries(grp).sort((a, b) => b[1].length - a[1].length).forEach(([k, ms]) => {
    const desc = k === "ON_BOARD" ? "on the board — see section 1" : (CODEDESC[k] || k);
    w(`- **${ms.length}** — ${desc}: ${ms.map((m) => m.sym).join(", ")}`);
  });
  w();
  const validatedMissed = tradeable.filter((m) => !ourSyms.has(m.sym) && (m.cls === "rider" || m.cls === "scalper"));
  if (validatedMissed.length) {
    w(`> **Actionable:** **${validatedMissed.length} of the top-10 were validated-class** (\`rider\`/\`scalper\`) names the board still cut — ${validatedMissed.map((m) => `${m.sym} (${pct(m.ride)}, \`${m.code}\`)`).join("; ")}. Unlike the sub-$20 \`caution\`/\`avoid\` names, these are misses the current thresholds *could* recover.`);
    w();
  }
  const costliest = tradeable.filter((m) => !ourSyms.has(m.sym))[0];
  if (costliest && (costliest.ride || 0) > 1) {
    w(`- **Costliest genuine miss:** \`${costliest.sym}\` rode **${pct(costliest.ride)}** intraday (max up ${pct(costliest.maxUp)}), badged \`${costliest.cls || "—"}\` — cut by \`${costliest.code}\`: ${costliest.detail || ""}.`);
    w();
  }
}

w(`---`);
w();
w(`## Week synthesis — the structural story (data-driven)`);
w();
w(`Across the **${totUntraded}** un-traded movers this week, this is *why* each fell outside a trade — the honest anatomy of the catch rate:`);
w();
w(`| Reason code | Count | Share | Meaning |`);
w(`|---|--:|--:|---|`);
Object.entries(agg).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => w(`| \`${c}\` | ${n} | ${totUntraded ? (n / totUntraded * 100).toFixed(0) : 0}% | ${CODEDESC[c] || "—"} |`));
w();
w(`Three buckets, in order of size — note which are *structural* vs *tunable*:`);
w();
w(`1. **Invisible at 08:30 (~${share(["INVISIBLE_AT_0830"])}%) — structural.** The largest bucket by far: names that *weren't gapping at the 08:30 snapshot* and only ignited after the open. A pre-market-only scan cannot see these by construction. Recovering them needs an **intraday re-scan**, not a threshold change — this, not the sub-$20 rule, is the real ceiling on catch rate.`);
w(`2. **Rank / board-size cut (~${share(["RANK_CUT", "TOP5_CUT"])}%) — tunable.** Names that *were* visible but ranked below the board's cut (prelim top-30 → final top-5). This bucket includes **validated \`rider\`-class movers that missed by a handful of ranks** (e.g. ${rankCutEx}). Widening the board or improving the score recovers these directly.`);
w(`3. **Deliberate class + hard gates (~${share(["BADGE_CUT", "GATED_PRICE_CAP", "GATED_PMVOL", "GATED_HISTORY"])}%).** The \`caution\`/\`avoid\` badge cut (sub-$20, failed validation — *correctly* skipped) **plus two hard gates**: the **$150 price ceiling**, which cut validated riders (${priceCapEx}), and the pre-market dollar-volume floor. The price cap in particular is discarding validated-class opportunity.`);
w(`4. **On-board holds (~${share(["DECLINED", "NO_TRIGGER"])}%).** The small tail — \`DECLINED\` / \`NO_TRIGGER\` — names that reached the board but the day-filter or an unfired trigger held them back.`);
w();
w(`**Correction to the intuitive story:** the low catch rate is *not* mainly the sub-$20 exclusion — \`BADGE_CUT\` is only ~${share(["BADGE_CUT"])}% of movers. It is dominated by **invisible-at-0830** (can't be tuned away without an intraday pass) and **rank / price-cap cuts of validated names** (which can). Spend enhancement effort on the tunable buckets.`);
w();
w(`**The number worth optimizing:** not headline board-catch, but **"of the validated-class names with a real intraday ride, how many did we catch?"** — which the rank-widening and price-cap fixes move directly.`);
w();
w(`## Enhancement ideas (ranked by leverage, straight from the reason-code data)`);
w();
w(`1. **Widen the board / fix the ranking — attacks the ~${share(["RANK_CUT", "TOP5_CUT"])}% \`RANK_CUT\` bucket, the biggest *tunable* one.** Validated \`rider\`-class movers are cut for ranking just outside the top-5/top-30 (${rankCutEx}). Take more than 5 picks, or re-weight the score so real intraday riders rank higher. Most direct catch-rate lift.`);
w(`2. **Raise or class-scope the $150 price ceiling — ~${share(["GATED_PRICE_CAP"])}% \`GATED_PRICE_CAP\`.** It discards *validated* riders purely on price (${priceCapEx}). If the rider edge holds above $150, the cap leaves money on the table; if it doesn't, prove it and keep it. Cheap to test.`);
w(`3. **Add an intraday re-scan — attacks the ~${share(["INVISIBLE_AT_0830"])}% \`INVISIBLE_AT_0830\` bucket, the structural ceiling.** The single largest miss bucket is names not gapping at 08:30 that ignited later. A pre-market-only snapshot can't see them; a rolling intraday re-scan (every 15–30 min) is the only way to catch this class. Biggest ceiling, biggest build.`);
w(`4. **Split "catch rate" into headline-catch vs tradeable-catch.** \`tradeableCatch\` already exists in the data — promote it. A 15% board-catch that is 80% of the *tradeable* movers is a good desk; conflating the two hides the real story.`);
w(`5. **Instrument the "no trigger" bucket.** For qualified names that never triggered, log *which* entry condition failed and what the name then did — isolates whether the entry logic is too strict.`);
w(`6. **Re-validate sub-$20 low-float runners as their own archetype (research, not a knob).** The \`caution\`/\`avoid\` cut is *correct* on current evidence (they failed validation), but it is where the biggest headline % lives. Per "match the tool to the move," they may need their own engine — a research question.`);
w(`7. **Per-name "opportunity cost" column** = ride we could have captured × size, so the board ranks misses by dollars, not %.`);
w();
w(`_Caveats: ${(M.caveats || []).join(" · ") || "none recorded"}._`);

writeFileSync(OUT, out);
console.log("wrote", OUT, "(" + out.length + " chars, " + out.split("\n").length + " lines)");
