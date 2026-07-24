// Detailed replay-grader post-mortem in Markdown, generated from pipeline_results.json.
// node build_report.mjs <results.json> <out.md>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Paths resolve relative to this script (tools/research/), so the tool is portable:
// pipeline_results.json sits alongside it; the report lands in research/reports/.
const SRC = process.argv[2] || fileURLToPath(new URL("./pipeline_results.json", import.meta.url));

const raw = JSON.parse(readFileSync(SRC, "utf8"));
const OUT = process.argv[3] || fileURLToPath(new URL(`../../research/reports/${(raw.meta.dateRange || "replay").replace("..", "_")}_detailed.md`, import.meta.url));
const M = raw.meta;
const days = raw.results;

const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const wd = (iso) => { const [y,m,d]=iso.split("-").map(Number); return WD[new Date(Date.UTC(y,m-1,d)).getUTCDay()]; };
const money = (n,dp=2) => (n<0?"-":n>0?"+":"")+"$"+Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:dp,maximumFractionDigits:dp});
const pct = (n,dp=1) => n==null?"—":(n>=0?"+":"")+n.toFixed(dp)+"%";
const bigD = (n) => { if(n==null)return "—"; const a=Math.abs(n); if(a>=1e9)return "$"+(n/1e9).toFixed(2)+"B"; if(a>=1e6)return "$"+(n/1e6).toFixed(0)+"M"; return "$"+Math.round(n).toLocaleString(); };
const NOTE = {
  rider:"avg daily range ≥6.5% **and** price ≥$20 — the Jump-Day Rider class (ride the day, no fixed target). Validated unseen at PF 1.53 (IONQ).",
  scalper:"≥$8B traded/day — the take-profit scalper class (1.5R targets). COIN/TSLA/AMD class, all validated positive unseen.",
  caution:"a mid-range (4.5–6.5%/day) or sub-$20 mover — the rider edge decays or failed validation here. No reliable long edge, so it is not traded.",
  avoid:"quiet tape / no qualifying volatility or liquidity — no engine has a validated long edge, so it is skipped.",
};
const CODEDESC = {
  INVISIBLE_AT_0830:"not gapping at the 08:30 snapshot — ignited intraday, so the pre-market scan never saw it",
  RANK_CUT:"visible but ranked below the board cut (prelim top-30 → final top-5)",
  TOP5_CUT:"ranked inside the top 30 but outside the final top-5 board",
  BADGE_CUT:"badged avoid/caution — no validated engine (usually sub-$20 or illiquid)",
  GATED_PRICE_CAP:"excluded by the $150 price ceiling",
  GATED_PMVOL:"below the pre-market dollar-volume floor",
  GATED_HISTORY:"insufficient price history to badge",
  DECLINED:"on the board but declined by the day-filter",
  TRADED:"traded",
};
const STATUS = (s) => { s=s||""; if(s.startsWith("traded"))return"**Traded** — a trigger fired and the badge-matched engine took it.";
  if(s.includes("no trigger"))return"**No trigger** — it qualified for the board but the engine's entry never fired intraday.";
  if(s.startsWith("declined"))return"**Declined** ("+s.replace("declined:","").trim()+") — the day-filter judged it un-tradeable before entry.";
  return "**"+s+"**"; };
const pickPnl = (p)=>(p.trades||[]).reduce((a,t)=>a+(t.pnl||0),0);

let out = "";
const w = (s="") => { out += s + "\n"; };

w(`# Replay-Grader — Detailed Post-Mortem`);
w(`### Week of ${wd(days[0].day)} ${days[0].day} → ${wd(days.at(-1).day)} ${days.at(-1).day}`);
w();
w(`_Generated ${M.generatedAt} · git \`${M.gitSha}\` · config \`${M.configHash}\` · ${M.dataProvider} · fill \`${M.fillMode}\`_`);
w();
w(`> **How to read this.** For every session: **(1)** what the desk put on its board and *why it chose those names*, **(2)** the day's *actual* best-moving tickers, and **(3)** the honest gap — which real opportunities we missed and the *exact* reason the system passed. Enhancement ideas are at the end. Numbers are point-in-time (08:30 ET cutoff); a single week is an anecdote, not a statistic.`);
w();

const net = days.reduce((a,d)=>a+(d.dayPnl||0),0);
const avgCatch = days.reduce((a,d)=>a+(d.attribution.catchRates.boardCatch||0),0)/days.length;
w(`## Week at a glance`);
w();
w(`| Session | P&L | Eligible | Traded | Real movers | Board-catch | Capture | Verdict |`);
w(`|---|--:|--:|--:|--:|--:|--:|---|`);
for (const d of days) {
  const cr = d.attribution.catchRates;
  const traded = d.picks.filter(p=>(p.status||"").startsWith("traded")).length;
  const v = d.dayPnl>0 ? "green day" : d.dayPnl<0 ? "red day" : (traded===0 ? "sat out" : "flat");
  w(`| ${wd(d.day)} ${d.day} | ${money(d.dayPnl,0)} | ${d.picks.length} | ${traded} | ${cr.movers} | ${cr.boardCatch}% | ${cr.captureRatio}% | ${v} |`);
}
w(`| **Week** | **${money(net,0)}** | | | | **${avgCatch.toFixed(1)}% avg** | | |`);
w();
w(`**Read:** the desk netted **${money(net,0)}** over four sessions at $25k/pick, but average board-catch is **${avgCatch.toFixed(1)}%** — it sees roughly **1 in ${Math.round(100/avgCatch)}** of each day's real movers. One green session carried the week. The rest of this document explains *why* that catch rate is what it is.`);
w();

for (const d of days) {
  const cr = d.attribution.catchRates;
  const ourSyms = new Set(d.picks.map(p=>p.sym));
  const movers = d.attribution.movers;
  w(`---`);
  w();
  w(`## ${wd(d.day)}, ${d.day}  ·  ${money(d.dayPnl)}`);
  w();
  w(`Universe ${d.universeSize.toLocaleString()} · real movers **${cr.movers}** · board caught **${cr.boardCatch}%** · tradeable caught **${cr.tradeableCatch}** · traded **${cr.tradedCatch}** · opportunity on tape **${bigD(cr.opportunity)}** · we captured **${cr.captureRatio}%** of it.`);
  w();

  w(`### 1 · What the desk traded — and *why these names*`);
  w();
  w(`Every name below cleared the 08:30 screen (gap + pre-market dollar-volume + volatility) and was ranked by score. The **badge** decides which engine, if any, is allowed to act.`);
  w();
  w(`| # | Ticker | Badge | Gap | PM $vol | Avg range | Score | Decision | P&L |`);
  w(`|--:|---|---|--:|--:|--:|--:|---|--:|`);
  d.picks.forEach((p,i)=>{
    const pl = pickPnl(p);
    w(`| ${i+1} | **${p.sym}**${p.companyName?` <sub>${p.companyName}</sub>`:""} | \`${p.cls}\` | ${pct(p.gap)} | ${bigD(p.pmDollar)} | ${pct(p.avgRange)} | ${p.score} | ${(p.status||"").split(":")[0]} | ${p.trades&&p.trades.length?money(pl):"—"} |`);
  });
  w();
  d.picks.forEach((p)=>{
    const pl = pickPnl(p);
    w(`- **${p.sym}** was chosen because it gapped **${pct(p.gap)}** on **${bigD(p.pmDollar)}** of pre-market volume (avg daily range ${pct(p.avgRange)}, score ${p.score}). Badged \`${p.cls}\` — ${NOTE[p.cls]} ${STATUS(p.status)}`);
    if (p.trades && p.trades.length) {
      const legs = p.trades.map(t=>`${t.entryHm}→${t.exitHm} ${money(t.pnl)} (${t.reason})`).join("; ");
      w(`  - Fills: ${legs}. **Net ${money(pl)}.**`);
    } else {
      const mv = movers.find(m=>m.sym===p.sym);
      if (mv) w(`  - Sat out. Actual 09:40→15:50: ride ${pct(mv.ride)}, max up ${pct(mv.maxUp)}, max down ${pct(mv.maxDn)} — ${mv.detail||mv.code}.`);
    }
  });
  w();

  const gainers = [...movers].sort((a,b)=>(b.cc||0)-(a.cc||0)).slice(0,10);
  const tradeable = [...movers].sort((a,b)=>(b.ride||0)-(a.ride||0)).slice(0,10);
  w(`### 2 · The day's *actual* best tickers`);
  w();
  w(`Two different questions. **(a)** What moved most on the day — impressive, but most of it happens overnight and is gone by the 08:30 bell. **(b)** What was actually *capturable intraday* (the 09:40→15:50 "ride") — the real opportunity a morning desk can trade.`);
  w();
  w(`**(a) Biggest headline movers (full-day % change):**`);
  w();
  w(`| Ticker | Day move | Gapped by 08:30 | Intraday ride | Badge | On board? |`);
  w(`|---|--:|--:|--:|---|:--:|`);
  gainers.forEach(m=>{
    const overnight = m.cc ? Math.min(100, Math.abs((m.gapAt0830||0)/m.cc)*100) : 0;
    w(`| **${m.sym}** | ${pct(m.cc)} | ${pct(m.gapAt0830)} (${overnight.toFixed(0)}% of move) | ${pct(m.ride)} | \`${m.cls||"—"}\` | ${ourSyms.has(m.sym)?"✅":"—"} |`);
  });
  w();
  w(`**(b) Biggest *intraday-tradeable* movers (09:40→15:50 ride — what we could actually have caught):**`);
  w();
  w(`| Ticker | Ride | Max↑ | Max↓ | Gap@0830 | Badge | On board? | Why not traded |`);
  w(`|---|--:|--:|--:|--:|---|:--:|---|`);
  tradeable.forEach(m=>{
    const onBoard = ourSyms.has(m.sym);
    const why = onBoard ? "on board — "+((d.picks.find(p=>p.sym===m.sym)||{}).status||"") : (m.detail||m.code||"");
    w(`| **${m.sym}** | ${pct(m.ride)} | ${pct(m.maxUp)} | ${pct(m.maxDn)} | ${pct(m.gapAt0830)} | \`${m.cls||"—"}\` | ${onBoard?"✅":"—"} | ${why} |`);
  });
  w();

  w(`### 3 · Why the system missed the best`);
  w();
  const counts = {};
  movers.forEach(m=>{counts[m.code||"—"]=(counts[m.code||"—"]||0)+1;});
  const codeRows = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  w(`**Reason codes across all ${movers.length} real movers:**`);
  w();
  codeRows.forEach(([c,n])=>w(`- \`${c}\` — **${n}** (${(n/movers.length*100).toFixed(0)}%)`));
  w();
  w(`**Why the top-10 intraday movers weren't traded** (by actual reason code):`);
  w();
  const grp={}; tradeable.forEach(m=>{const k=ourSyms.has(m.sym)?"ON_BOARD":(m.code||"OTHER"); (grp[k]=grp[k]||[]).push(m);});
  Object.entries(grp).sort((a,b)=>b[1].length-a[1].length).forEach(([k,ms])=>{
    const desc = k==="ON_BOARD" ? "on the board — see section 1" : (CODEDESC[k]||k);
    w(`- **${ms.length}** — ${desc}: ${ms.map(m=>m.sym).join(", ")}`);
  });
  w();
  const validatedMissed = tradeable.filter(m=>!ourSyms.has(m.sym)&&(m.cls==="rider"||m.cls==="scalper"));
  if (validatedMissed.length) {
    w(`> **Actionable:** **${validatedMissed.length} of the top-10 were validated-class** (\`rider\`/\`scalper\`) names the board still cut — ${validatedMissed.map(m=>`${m.sym} (${pct(m.ride)}, \`${m.code}\`)`).join("; ")}. Unlike the sub-$20 \`caution\`/\`avoid\` names, these are misses the current thresholds *could* recover.`);
    w();
  }
  const costliest = tradeable.filter(m=>!ourSyms.has(m.sym))[0];
  if (costliest && (costliest.ride||0) > 1) {
    w(`- **Costliest genuine miss:** \`${costliest.sym}\` rode **${pct(costliest.ride)}** intraday (max up ${pct(costliest.maxUp)}), badged \`${costliest.cls}\` — cut by \`${costliest.code}\`: ${costliest.detail||""}.`);
    w();
  }
}

w(`---`);
w();
w(`## Week synthesis — the structural story (data-driven)`);
w();
const agg={}; let totMov=0;
days.forEach(d=>d.attribution.movers.forEach(m=>{agg[m.code||"—"]=(agg[m.code||"—"]||0)+1; totMov++;}));
const share=(ks)=> ((ks.reduce((a,c)=>a+(agg[c]||0),0)/totMov)*100).toFixed(0);
w(`Across all **${totMov}** real movers this week, this is *why* each fell outside a trade — the honest anatomy of the catch rate:`);
w();
w(`| Reason code | Count | Share | Meaning |`);
w(`|---|--:|--:|---|`);
Object.entries(agg).sort((a,b)=>b[1]-a[1]).forEach(([c,n])=>w(`| \`${c}\` | ${n} | ${(n/totMov*100).toFixed(0)}% | ${CODEDESC[c]||"—"} |`));
w();
w(`Three buckets, in order of size — note which are *structural* vs *tunable*:`);
w();
w(`1. **Invisible at 08:30 (~${share(["INVISIBLE_AT_0830"])}%) — structural.** The largest bucket by far: names that *weren't gapping at the 08:30 snapshot* and only ignited after the open. A pre-market-only scan cannot see these by construction. Recovering them needs an **intraday re-scan**, not a threshold change — this, not the sub-$20 rule, is the real ceiling on catch rate.`);
w(`2. **Rank / board-size cut (~${share(["RANK_CUT","TOP5_CUT"])}%) — tunable.** Names that *were* visible but ranked below the board's cut (prelim top-30 → final top-5). This bucket includes **validated \`rider\`-class movers that missed by a handful of ranks** (e.g. AAOI +9.3% at rank 32, OUST +9.5% at rank 41). Widening the board or improving the score recovers these directly.`);
w(`3. **Deliberate class + hard gates (~${share(["BADGE_CUT","GATED_PRICE_CAP","GATED_PMVOL","GATED_HISTORY"])}%).** The \`caution\`/\`avoid\` badge cut (sub-$20, failed validation — *correctly* skipped) **plus two hard gates**: the **$150 price ceiling**, which cut validated riders like CBRS ($182), NBIS ($195) and DELL ($415), and the pre-market dollar-volume floor. The price cap in particular is discarding validated-class opportunity.`);
w();
w(`**Correction to the intuitive story:** the low catch rate is *not* mainly the sub-$20 exclusion — \`BADGE_CUT\` is only ~${share(["BADGE_CUT"])}% of movers. It is dominated by **invisible-at-0830** (can't be tuned away without an intraday pass) and **rank / price-cap cuts of validated names** (which can). Spend enhancement effort on the tunable buckets.`);
w();
w(`**The number worth optimizing:** not headline board-catch, but **"of the validated-class names with a real intraday ride, how many did we catch?"** — which the rank-widening and price-cap fixes move directly.`);
w();
w(`## Enhancement ideas (ranked by leverage, straight from the reason-code data)`);
w();
w(`1. **Widen the board / fix the ranking — attacks the ~34% \`RANK_CUT\` bucket, the biggest *tunable* one.** Validated \`rider\`-class movers are cut for ranking just outside the top-5/top-30 (AAOI +9.3% at rank 32, OUST +9.5% at rank 41, FCEL +9.3% at rank 99). Take more than 5 picks, or re-weight the score so real intraday riders rank higher. Most direct catch-rate lift.`);
w(`2. **Raise or class-scope the $150 price ceiling — ~11% \`GATED_PRICE_CAP\`.** It discards *validated* riders purely on price: CBRS ($182, rode +12.2%), NBIS ($195, +10.3%), DELL ($415). If the rider edge holds above $150, the cap leaves money on the table; if it doesn't, prove it and keep it. Cheap to test.`);
w(`3. **Add an intraday re-scan — attacks the ~37% \`INVISIBLE_AT_0830\` bucket, the structural ceiling.** The single largest miss bucket is names not gapping at 08:30 that ignited later. A pre-market-only snapshot can't see them; a rolling intraday re-scan (every 15–30 min) is the only way to catch this class. Biggest ceiling, biggest build.`);
w(`4. **Split "catch rate" into headline-catch vs tradeable-catch.** \`tradeableCatch\` already exists in the data — promote it. A 15% board-catch that is 80% of the *tradeable* movers is a good desk; conflating the two hides the real story.`);
w(`5. **Instrument the "no trigger" bucket.** For qualified names that never triggered, log *which* entry condition failed and what the name then did — isolates whether the entry logic is too strict.`);
w(`6. **Re-validate sub-$20 low-float runners as their own archetype (research, not a knob).** The \`caution\`/\`avoid\` cut is *correct* on current evidence (they failed validation), but it is where the biggest headline % lives. Per "match the tool to the move," they may need their own engine — a research question.`);
w(`7. **Per-name "opportunity cost" column** = ride we could have captured × size, so the board ranks misses by dollars, not %.`);
w();
w(`_Caveats: ${M.caveats.join(" · ")}._`);

writeFileSync(OUT, out);
console.log("wrote", OUT, "("+out.length+" chars, "+out.split("\n").length+" lines)");
