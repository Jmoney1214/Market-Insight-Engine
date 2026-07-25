// Generates a self-contained replay-grader dashboard Artifact from pipeline_results.json.
// node build_dashboard.mjs [results.json] [out.html]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { money, pct, bigD, clsN, dLabel, pickPnl, statusInfo, esc, badgeClass, safeJson, NOTE } from "./lib/reportlib.mjs";

// Paths resolve relative to this script (tools/research/), so the tool is portable:
// pipeline_results.json sits alongside it; the dashboard lands in research/reports/.
const SRC = process.argv[2] || fileURLToPath(new URL("./pipeline_results.json", import.meta.url));
const raw = JSON.parse(readFileSync(SRC, "utf8"));
const M = raw.meta || {};
const results = (Array.isArray(raw.results) ? raw.results : []).filter((d) => !d.noSession);
if (!results.length) {
  console.error(`No results in ${SRC} — run pipeline.mjs first.`);
  process.exit(1);
}
const OUT = process.argv[3] || fileURLToPath(new URL(`../../research/reports/${(M.dateRange || "replay").replace("..", "_")}_dashboard.html`, import.meta.url));

const slimMover = (m) => ({
  sym: m.sym, cls: m.cls, ride: m.ride, maxUp: m.maxUp, maxDn: m.maxDn,
  gapAt0830: m.gapAt0830, code: m.code, detail: m.detail, cc: m.cc,
});

const data = {
  meta: {
    gitSha: M.gitSha, configHash: M.configHash, generatedAt: M.generatedAt,
    dataProvider: M.dataProvider, feed: M.feed, adjustment: M.adjustment,
    sessionTemplate: M.sessionTemplate, dateRange: M.dateRange, fillMode: M.fillMode,
    barTimeframe: M.barTimeframe, timezone: M.timezone, caveats: M.caveats || [],
  },
  days: results.map((d) => ({
    day: d.day,
    universeSize: d.universeSize,
    dayPnl: d.dayPnl,
    boardCounts: { top: (d.board?.top || []).length, jump: (d.board?.jump || []).length, fall: (d.board?.fall || []).length },
    catchRates: d.attribution?.catchRates || {},
    picks: d.picks || [],
    movers: (d.attribution?.movers || []).map(slimMover),
  })),
};

const STYLE = `
:root{
  --ground:#EEF2F7; --surface:#FFFFFF; --surface-2:#F4F7FB; --line:#DBE3EC;
  --ink:#16202B; --muted:#5A6B7E; --faint:#8595A6;
  --accent:#B5791A; --accent-soft:#f3e6cb;
  --up:#1E9E63; --down:#D23B41; --flat:#6B7C90;
  --rider:#12897A; --scalper:#4C5FD0; --caution:#C26A22; --avoid:#64748B;
  --shadow:0 1px 2px rgba(16,32,48,.06),0 8px 24px rgba(16,32,48,.06);
  --mono:"JetBrains Mono","SFMono-Regular",ui-monospace,Menlo,Consolas,monospace;
  --sans:ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --ground:#0E141B; --surface:#151E28; --surface-2:#1C2833; --line:#2A3745;
    --ink:#E6EDF5; --muted:#8A9BB0; --faint:#647689;
    --accent:#E8B24A; --accent-soft:#33291255;
    --up:#37B87D; --down:#E5565B; --flat:#6B7C90;
    --rider:#2FBFA8; --scalper:#8393F5; --caution:#E0904A; --avoid:#748699;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);
  }
}
:root[data-theme="light"]{
  --ground:#EEF2F7; --surface:#FFFFFF; --surface-2:#F4F7FB; --line:#DBE3EC;
  --ink:#16202B; --muted:#5A6B7E; --faint:#8595A6; --accent:#B5791A; --accent-soft:#f3e6cb;
  --up:#1E9E63; --down:#D23B41; --flat:#6B7C90; --rider:#12897A; --scalper:#4C5FD0; --caution:#C26A22; --avoid:#64748B;
  --shadow:0 1px 2px rgba(16,32,48,.06),0 8px 24px rgba(16,32,48,.06);
}
:root[data-theme="dark"]{
  --ground:#0E141B; --surface:#151E28; --surface-2:#1C2833; --line:#2A3745;
  --ink:#E6EDF5; --muted:#8A9BB0; --faint:#647689; --accent:#E8B24A; --accent-soft:#33291255;
  --up:#37B87D; --down:#E5565B; --flat:#6B7C90; --rider:#2FBFA8; --scalper:#8393F5; --caution:#E0904A; --avoid:#748699;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;}
.wrap{max-width:1120px;margin:0 auto;padding:28px 20px 80px;}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums;}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);}
h1{font-size:26px;line-height:1.15;margin:.1em 0 .1em;text-wrap:balance;letter-spacing:-.01em;}
a{color:var(--accent);}
.up{color:var(--up)} .down{color:var(--down)} .flat{color:var(--flat)}

.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:22px;}
.head .sub{color:var(--muted);font-size:13.5px;margin-top:2px;max-width:62ch;}
.prov{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border:1px solid var(--line);
  border-radius:999px;font-size:11.5px;color:var(--muted);background:var(--surface);}
.chip b{color:var(--ink);font-weight:600;font-family:var(--mono);}
.tgl{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:9px;
  padding:8px 12px;font:inherit;font-size:13px;cursor:pointer;display:inline-flex;gap:8px;align-items:center;white-space:nowrap;}
.tgl:hover{border-color:var(--accent);} .tgl:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}

.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:8px 0 26px;}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 15px;box-shadow:var(--shadow);}
.kpi .k{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);}
.kpi .v{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:23px;font-weight:600;margin-top:6px;letter-spacing:-.02em;}
.kpi .n{font-size:12px;color:var(--muted);margin-top:2px;}

.sec-label{display:flex;align-items:baseline;gap:12px;margin:30px 0 12px;}
.sec-label h2{font-size:14px;margin:0;letter-spacing:.03em;text-transform:uppercase;color:var(--muted);font-weight:600;}
.rule{flex:1;height:1px;background:var(--line);}

.nav{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:8px;}
.tile{text-align:left;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:13px 14px;
  cursor:pointer;color:inherit;font:inherit;box-shadow:var(--shadow);transition:border-color .15s,transform .15s;}
.tile:hover{border-color:var(--accent);transform:translateY(-2px);}
.tile:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
.tile .d{font-size:12px;color:var(--muted);}
.tile .p{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:20px;font-weight:600;margin:4px 0 2px;}
.tile .m{font-size:11.5px;color:var(--faint);}
.tile .bar{height:4px;border-radius:3px;background:var(--line);margin-top:9px;overflow:hidden;}
.tile .bar>i{display:block;height:100%;border-radius:3px;}

.day{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:0;margin-bottom:18px;
  overflow:hidden;box-shadow:var(--shadow);scroll-margin-top:14px;}
.day-h{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;
  padding:16px 18px;border-bottom:1px solid var(--line);background:var(--surface-2);}
.day-h .dt{font-weight:600;font-size:16px;}
.day-h .dt small{color:var(--muted);font-weight:500;margin-left:8px;font-size:12.5px;font-family:var(--mono);}
.day-h .pnl{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:20px;font-weight:700;}
.dstats{display:flex;gap:16px;flex-wrap:wrap;padding:11px 18px;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--muted);}
.dstats b{color:var(--ink);font-family:var(--mono);font-weight:600;}

.board{width:100%;}
.brow{display:grid;grid-template-columns:1.6fr .9fr .7fr .85fr .6fr .5fr 1.1fr .85fr 22px;gap:10px;align-items:center;
  padding:11px 18px;border-bottom:1px solid var(--line);font-size:13px;}
.brow.hdr{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);background:transparent;padding-top:12px;padding-bottom:8px;}
.brow.pick{cursor:pointer;}
.brow.pick:hover{background:var(--surface-2);}
.brow.pick:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;}
.brow .sym{font-family:var(--mono);font-weight:600;font-size:14px;}
.brow .co{color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.brow .num{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;}
.brow .caret{color:var(--faint);transition:transform .18s;justify-self:center;}
.brow.open .caret{transform:rotate(90deg);color:var(--accent);}
.badge{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;
  letter-spacing:.02em;border:1px solid transparent;text-transform:capitalize;}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none;}
.b-rider{color:var(--rider);background:color-mix(in srgb,var(--rider) 14%,transparent);border-color:color-mix(in srgb,var(--rider) 30%,transparent);}
.b-scalper{color:var(--scalper);background:color-mix(in srgb,var(--scalper) 14%,transparent);border-color:color-mix(in srgb,var(--scalper) 30%,transparent);}
.b-caution{color:var(--caution);background:color-mix(in srgb,var(--caution) 14%,transparent);border-color:color-mix(in srgb,var(--caution) 30%,transparent);}
.b-avoid{color:var(--avoid);background:color-mix(in srgb,var(--avoid) 14%,transparent);border-color:color-mix(in srgb,var(--avoid) 30%,transparent);}
.stat{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;}
.s-traded{color:var(--up);background:color-mix(in srgb,var(--up) 13%,transparent);}
.s-notrig{color:var(--caution);background:color-mix(in srgb,var(--caution) 13%,transparent);}
.s-declined{color:var(--avoid);background:color-mix(in srgb,var(--avoid) 15%,transparent);}

.drawer{display:none;padding:2px 18px 20px;border-bottom:1px solid var(--line);background:var(--surface-2);}
.drawer.open{display:block;animation:fade .2s ease;}
@keyframes fade{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
.chain{display:flex;flex-direction:column;gap:0;margin:10px 0 4px;}
.step{display:grid;grid-template-columns:26px 1fr;gap:12px;padding:9px 0;border-left:2px solid var(--line);margin-left:8px;padding-left:16px;position:relative;}
.step::before{content:"";position:absolute;left:-6px;top:14px;width:10px;height:10px;border-radius:50%;background:var(--surface);border:2px solid var(--accent);}
.step .n{font-size:10px;color:var(--faint);font-weight:700;letter-spacing:.08em;font-family:var(--mono);}
.step .t{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:3px;}
.step .body{font-size:13.5px;}
.step .body .mut{color:var(--muted);}
.kvs{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:6px;font-family:var(--mono);font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;}
.kvs b{color:var(--ink);font-weight:600;}
.trades{width:100%;border-collapse:collapse;margin-top:8px;font-family:var(--mono);font-size:12px;}
.trades th{text-align:right;font-weight:600;color:var(--faint);font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:4px 8px;border-bottom:1px solid var(--line);}
.trades th:first-child,.trades td:first-child{text-align:left;}
.trades td{text-align:right;padding:5px 8px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums;}
.rsn{display:inline-block;padding:1px 6px;border-radius:5px;font-size:10px;font-weight:600;text-transform:uppercase;}
.rsn.target{color:var(--up);background:color-mix(in srgb,var(--up) 14%,transparent);}
.rsn.stop{color:var(--down);background:color-mix(in srgb,var(--down) 14%,transparent);}
.rsn.flat,.rsn.eod,.rsn.timeout{color:var(--flat);background:color-mix(in srgb,var(--flat) 16%,transparent);}
.verdict{margin-top:8px;padding:9px 12px;border-radius:9px;font-size:12.5px;border:1px dashed var(--line);color:var(--muted);}

.movers{padding:14px 18px 18px;}
.mov-head{display:flex;justify-content:space-between;align-items:center;cursor:pointer;gap:10px;}
.mov-head:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
.codes{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;}
.code{display:flex;flex-direction:column;gap:5px;min-width:130px;flex:1;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 11px;}
.code .cn{font-family:var(--mono);font-size:11px;color:var(--muted);display:flex;justify-content:space-between;gap:8px;}
.code .cn b{color:var(--ink);}
.code .cbar{height:5px;border-radius:3px;background:var(--line);overflow:hidden;}
.code .cbar>i{display:block;height:100%;background:var(--accent);opacity:.75;}
.mvtbl{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px;}
.mvtbl th{text-align:right;color:var(--faint);font-size:10px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;padding:6px 8px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--surface);}
.mvtbl th:first-child,.mvtbl td:first-child{text-align:left}
.mvtbl td{text-align:right;padding:5px 8px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums;color:var(--muted);}
.mvtbl td .sym{color:var(--ink);font-weight:600;}
.mvscroll{max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:10px;margin-top:8px;}
.morebtn{margin-top:10px;border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:8px;padding:6px 12px;font:inherit;font-size:12px;cursor:pointer;}
.morebtn:hover{border-color:var(--accent);color:var(--ink);}

.foot{margin-top:34px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px;}
.foot ul{margin:8px 0 0;padding-left:18px;} .foot li{margin:4px 0;}
.foot .meta-grid{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;}

@media (max-width:820px){
  .kpis{grid-template-columns:repeat(2,1fr);} .nav{grid-template-columns:repeat(2,1fr);}
  .brow{grid-template-columns:1.4fr .8fr .6fr 1fr .7fr 18px;}
  .brow .col-pm,.brow .col-range,.brow .col-score{display:none;}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important;}}
`;

// Canonical helpers injected into the browser APP verbatim from reportlib.mjs, so
// the dashboard and the Markdown report format every number identically (no drift).
const HELPERS = `
const NOTE = ${safeJson(NOTE)};
const noteFor = (cls) => NOTE[cls] || NOTE._unknown;
const fmtMoney = ${money};
const pct = ${pct};
const bigD = ${bigD};
const clsN = ${clsN};
const dLabel = ${dLabel};
const pickPnl = ${pickPnl};
const STATUS = ${statusInfo};
const esc = ${esc};
const badgeClass = ${badgeClass};
const num2 = (x) => Number.isFinite(Number(x)) ? Number(x).toFixed(2) : "—";
const cap = (v) => v == null ? "n/a" : v + "%";
`;

const APP = String.raw`
const D = DATA;
const $ = (t,c,txt)=>{const e=document.createElement(t); if(c)e.className=c; if(txt!=null)e.textContent=txt; return e;};
const moverFor=(day,sym)=> (day.movers||[]).find(m=>m.sym===sym);
const root=document.getElementById("app");

const head=$("div","head");
const hl=$("div");
hl.appendChild($("div","eyebrow","Morning-Scan Replay · Point-in-time Post-mortem"));
const h1=$("h1"); const L0=dLabel(D.days[0].day); h1.textContent="Replay-Grader — Week of "+L0.wd+" "+L0.short; hl.appendChild(h1);
hl.appendChild($("div","sub","Every eligible pick badged at the 08:30 ET cutoff, run through the badge-matched engine, and graded against what the tape actually did. Click any row for the full decision chain."));
const prov=$("div","prov");
const mk=(k,v)=>{const c=$("span","chip");c.innerHTML="<span>"+esc(k)+"</span> <b>"+esc(v)+"</b>";return c;};
prov.appendChild(mk("range",D.meta.dateRange));
prov.appendChild(mk("git",D.meta.gitSha));
prov.appendChild(mk("config",D.meta.configHash));
prov.appendChild(mk("feed",(D.meta.feed||"")+" · "+(D.meta.adjustment||"")+"-adj"));
prov.appendChild(mk("fill",D.meta.fillMode));
hl.appendChild(prov);
head.appendChild(hl);
const tgl=$("button","tgl"); tgl.type="button"; tgl.setAttribute("aria-label","Toggle color theme");
const isDark=()=>(document.documentElement.getAttribute("data-theme")||(matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"))==="dark";
const setTgl=()=>{tgl.textContent=isDark()?"◑ Light":"◐ Dark";};
tgl.onclick=()=>{document.documentElement.setAttribute("data-theme",isDark()?"light":"dark");setTgl();};
setTgl(); head.appendChild(tgl); root.appendChild(head);

const net=D.days.reduce((a,d)=>a+(d.dayPnl||0),0);
const opp=D.days.reduce((a,d)=>a+(d.catchRates.opportunity||0),0);
const capd=D.days.reduce((a,d)=>a+(d.catchRates.netPnl||0),0);
const avgCatch=D.days.reduce((a,d)=>a+(d.catchRates.boardCatch||0),0)/D.days.length;
const tradedDays=D.days.filter(d=>(d.picks||[]).some(p=>(p.status||"").startsWith("traded"))).length;
const kpis=$("div","kpis");
const kpi=(k,v,n,cl)=>{const e=$("div","kpi");e.appendChild($("div","k",k));const vv=$("div","v"+(cl?" "+cl:""));vv.textContent=v;e.appendChild(vv);if(n)e.appendChild($("div","n",n));return e;};
kpis.appendChild(kpi("Week net P&L",fmtMoney(net,0),"$25k / pick · "+D.days.length+" sessions",clsN(net)));
kpis.appendChild(kpi("Days traded",tradedDays+" / "+D.days.length,"sessions that took a trade"));
kpis.appendChild(kpi("Avg board-catch",avgCatch.toFixed(1)+"%","of the day's real movers"));
kpis.appendChild(kpi("Opportunity captured",(opp>0?(capd/opp*100):0).toFixed(1)+"%","P&L vs. tradeable $ on tape"));
kpis.appendChild(kpi("Universe",(D.days[0].universeSize||0).toLocaleString(),"screened at 08:30 cutoff"));
root.appendChild(kpis);

const navLabel=$("div","sec-label"); navLabel.appendChild($("h2",null,"Sessions")); navLabel.appendChild($("div","rule")); root.appendChild(navLabel);
const nav=$("div","nav");
const maxAbs=Math.max(1,...D.days.map(d=>Math.abs(d.dayPnl||0)));
D.days.forEach((d,i)=>{
  const t=$("button","tile"); t.type="button";
  const L=dLabel(d.day);
  t.appendChild($("div","d",L.wd+" · "+L.short));
  const p=$("div","p "+clsN(d.dayPnl)); p.textContent=fmtMoney(d.dayPnl,0); t.appendChild(p);
  const traded=(d.picks||[]).filter(x=>(x.status||"").startsWith("traded")).length;
  t.appendChild($("div","m",traded+"/"+(d.picks||[]).length+" traded · catch "+(d.catchRates.boardCatch||0)+"%"));
  const bar=$("div","bar");const ib=document.createElement("i");ib.style.width=(Math.abs(d.dayPnl||0)/maxAbs*100)+"%";ib.style.background=d.dayPnl<0?"var(--down)":d.dayPnl>0?"var(--up)":"var(--flat)";bar.appendChild(ib);t.appendChild(bar);
  t.onclick=()=>document.getElementById("day-"+i).scrollIntoView({behavior:matchMedia("(prefers-reduced-motion:reduce)").matches?"auto":"smooth",block:"start"});
  nav.appendChild(t);
});
root.appendChild(nav);

const boardLabel=$("div","sec-label"); boardLabel.appendChild($("h2",null,"The board, decision by decision")); boardLabel.appendChild($("div","rule")); root.appendChild(boardLabel);

function step(n,title,bodyNode){
  const s=$("div","step"); s.appendChild($("div","n",n));
  const b=$("div"); b.appendChild($("div","t",title)); const bd=$("div","body"); if(typeof bodyNode==="string")bd.innerHTML=bodyNode; else bd.appendChild(bodyNode); b.appendChild(bd); s.appendChild(b);
  return s;
}
function buildChain(day,p,st){
  const wrap=$("div"); const chain=$("div","chain");
  const kv=$("div","kvs");
  kv.innerHTML="score <b>"+esc(p.score)+"</b> · gap <b>"+pct(p.gap)+"</b> · PM $vol <b>"+bigD(p.pmDollar)+"</b> · avg range <b>"+pct(p.avgRange)+"</b> · move-to-date <b>"+pct(p.mtd)+"</b>";
  const sel=$("div"); sel.innerHTML="<span class='mut'>"+esc(p.companyName||p.sym)+" cleared the 08:30 screen and ranked into the eligible board on these point-in-time stats:</span>"; sel.appendChild(kv);
  chain.appendChild(step("01","Selected — why it made the board",sel));
  const bd=$("div"); bd.innerHTML="<span class='badge b-"+badgeClass(p.cls)+"'>"+esc(p.cls||"—")+"</span> &nbsp;<span class='mut'>"+esc(noteFor(p.cls))+"</span>";
  chain.appendChild(step("02","Badged — which engine (if any) has an edge",bd));
  chain.appendChild(step("03","Decision — what the engine did","<b>"+esc(st.label)+".</b> <span class='mut'>"+esc(st.why)+"</span>"));
  if(p.trades&&p.trades.length){
    const tb=document.createElement("table"); tb.className="trades";
    tb.innerHTML="<thead><tr><th>In</th><th>Out</th><th>Entry</th><th>Exit</th><th>Qty</th><th>P&L</th><th>Reason</th></tr></thead>";
    const tbody=document.createElement("tbody");
    p.trades.forEach(t=>{const tr=document.createElement("tr"); const rc=(t.reason||"").toLowerCase().replace(/[^a-z]/g,"");
      tr.innerHTML="<td>"+esc(t.entryHm)+"</td><td>"+esc(t.exitHm)+"</td><td>"+num2(t.entry)+"</td><td>"+num2(t.exit)+"</td><td>"+esc(t.qty==null?"—":t.qty)+"</td><td class='"+clsN(t.pnl)+"'>"+fmtMoney(t.pnl)+"</td><td><span class='rsn "+rc+"'>"+esc(t.reason||"—")+"</span></td>";
      tbody.appendChild(tr);});
    tb.appendChild(tbody);
    const tot=pickPnl(p);
    const wrap2=$("div"); wrap2.appendChild(tb);
    wrap2.appendChild($("div","kvs")).innerHTML="net on "+esc(p.sym)+" <b class='"+clsN(tot)+"'>"+fmtMoney(tot)+"</b> across "+p.trades.length+" trade"+(p.trades.length>1?"s":"");
    chain.appendChild(step("04","Execution — the actual fills",wrap2));
  } else {
    const mv=moverFor(day,p.sym); let html;
    if(mv){ html="<span class='mut'>No fill. What "+esc(p.sym)+" actually did 09:40→15:50:</span><div class='kvs'>ride <b class='"+clsN(mv.ride)+"'>"+pct(mv.ride)+"</b> · max up <b class='up'>"+pct(mv.maxUp)+"</b> · max down <b class='down'>"+pct(mv.maxDn)+"</b> · code <b>"+esc(mv.code||"—")+"</b></div><div class='verdict'>"+esc(mv.detail||"")+"</div>";
    } else { html="<span class='mut'>No fill, and not among the day's graded movers — a quiet name; sitting out was costless.</span>"; }
    chain.appendChild(step("04","Counterfactual — what sitting out cost (or saved)",html));
  }
  wrap.appendChild(chain); return wrap;
}
function buildMovers(day){
  const box=$("div","movers");
  const head=$("div","mov-head"); head.tabIndex=0; head.setAttribute("role","button");
  head.innerHTML="<div class='eyebrow'>Selection reality check — the day's real movers &amp; why the board missed them</div><div class='chip'><b>"+day.movers.length+"</b> movers ▾</div>";
  box.appendChild(head);
  const body=$("div"); body.style.display="none";
  const boardSyms=new Set((day.picks||[]).map(p=>p.sym));
  const stOf=(sym)=>{const p=(day.picks||[]).find(x=>x.sym===sym);return p?(p.status||""):"";};
  const counts={}; day.movers.forEach(m=>{ if((m.code||"")==="TRADED")return; counts[m.code||"—"]=(counts[m.code||"—"]||0)+1;});
  const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]); const mx=Math.max(1,...entries.map(e=>e[1]));
  const codes=$("div","codes");
  entries.forEach(([c,n])=>{const el=$("div","code"); el.innerHTML="<div class='cn'><span>"+esc(c)+"</span><b>"+n+"</b></div><div class='cbar'><i style='width:"+(n/mx*100)+"%'></i></div>"; codes.appendChild(el);});
  body.appendChild(codes);
  const sorted=[...day.movers].sort((a,b)=>(b.ride||0)-(a.ride||0));
  const scroll=$("div","mvscroll");
  const tb=document.createElement("table"); tb.className="mvtbl";
  tb.innerHTML="<thead><tr><th>Sym</th><th>Badge</th><th>Ride</th><th>Max↑</th><th>Max↓</th><th>Gap@0830</th><th>Reason not traded</th></tr></thead>";
  const tbody=document.createElement("tbody"); tb.appendChild(tbody);
  let shown=0; const CAP=15;
  const render=(limit)=>{tbody.innerHTML=""; sorted.slice(0,limit).forEach(m=>{const tr=document.createElement("tr");
    const onB=boardSyms.has(m.sym);
    const why=onB?("on board — "+esc(stOf(m.sym)||"—")):esc(m.detail||m.code||"");
    tr.innerHTML="<td><span class='sym'>"+esc(m.sym)+"</span>"+(onB?" ✅":"")+"</td><td><span class='badge b-"+badgeClass(m.cls)+"'>"+esc(m.cls||"—")+"</span></td><td class='"+clsN(m.ride)+"'>"+pct(m.ride)+"</td><td class='up'>"+pct(m.maxUp)+"</td><td class='down'>"+pct(m.maxDn)+"</td><td>"+pct(m.gapAt0830)+"</td><td style='text-align:left'>"+why+"</td>";
    tbody.appendChild(tr);}); shown=Math.min(limit,sorted.length);};
  render(CAP); scroll.appendChild(tb); body.appendChild(scroll);
  if(sorted.length>CAP){const more=$("button","morebtn");more.type="button";more.textContent="Show all "+sorted.length+" movers";
    more.onclick=()=>{if(shown<sorted.length){render(sorted.length);more.textContent="Show top "+CAP;}else{render(CAP);more.textContent="Show all "+sorted.length+" movers";}};
    body.appendChild(more);}
  const t=()=>{const open=body.style.display==="none";body.style.display=open?"block":"none";head.querySelector(".chip").innerHTML="<b>"+day.movers.length+"</b> movers "+(open?"▴":"▾");};
  head.onclick=t; head.onkeydown=(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();t();}};
  box.appendChild(body); return box;
}

D.days.forEach((d,i)=>{
  const sec=$("section","day"); sec.id="day-"+i;
  const L=dLabel(d.day);
  const dh=$("div","day-h");
  const dt=$("div","dt"); dt.innerHTML=esc(L.wd)+", "+esc(L.iso)+" <small>"+d.picks.length+" eligible · board "+d.boardCounts.top+"↑/"+d.boardCounts.fall+"↓</small>";
  dh.appendChild(dt);
  const pnl=$("div","pnl "+clsN(d.dayPnl)); pnl.textContent=fmtMoney(d.dayPnl); dh.appendChild(pnl);
  sec.appendChild(dh);
  const cr=d.catchRates;
  const ds=$("div","dstats");
  ds.innerHTML="Real movers <b>"+(cr.movers??"—")+"</b> · Board caught <b>"+(cr.boardCatch??"—")+"%</b> · Tradeable caught <b>"+cap(cr.tradeableCatch)+"</b> · Traded <b>"+cap(cr.tradedCatch)+"</b> · Opportunity <b>"+bigD(cr.opportunity)+"</b> · Capture <b>"+cap(cr.captureRatio)+"</b>";
  sec.appendChild(ds);
  const board=$("div","board");
  const hdr=$("div","brow hdr");
  [["Symbol",""],["Badge",""],["Gap","num"],["PM $Vol","num col-pm"],["Range","num col-range"],["Score","num col-score"],["Decision",""],["P&L","num"],["",""]].forEach(([h,c])=>{const el=$("div",c);el.textContent=h;hdr.appendChild(el);});
  board.appendChild(hdr);
  d.picks.forEach((p)=>{
    const row=$("div","brow pick"); row.tabIndex=0; row.setAttribute("role","button"); row.setAttribute("aria-expanded","false");
    const symc=$("div"); symc.innerHTML="<div class='sym'>"+esc(p.sym)+"</div><div class='co'>"+esc(p.companyName||"")+"</div>"; row.appendChild(symc);
    const bc=$("div"); const bd=$("span","badge b-"+badgeClass(p.cls)); bd.textContent=p.cls||"—"; bc.appendChild(bd); row.appendChild(bc);
    row.appendChild($("div","num")).textContent=pct(p.gap);
    row.appendChild($("div","num col-pm")).textContent=bigD(p.pmDollar);
    row.appendChild($("div","num col-range")).textContent=pct(p.avgRange);
    row.appendChild($("div","num col-score")).textContent=p.score==null?"—":p.score;
    const st=STATUS(p.status); const stc=$("div"); const sp=$("span","stat "+st.k); sp.textContent=st.label; stc.appendChild(sp); row.appendChild(stc);
    const pl=pickPnl(p); const plc=$("div","num "+clsN(pl)); plc.textContent=(p.trades&&p.trades.length)?fmtMoney(pl):"—"; row.appendChild(plc);
    row.appendChild($("div","caret")).textContent="▸";
    board.appendChild(row);
    const dr=$("div","drawer"); dr.appendChild(buildChain(d,p,st)); board.appendChild(dr);
    const toggle=()=>{const open=dr.classList.toggle("open");row.classList.toggle("open",open);row.setAttribute("aria-expanded",open?"true":"false");};
    row.onclick=toggle;
    row.onkeydown=(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();toggle();}};
  });
  sec.appendChild(board);
  sec.appendChild(buildMovers(d));
  root.appendChild(sec);
});

const foot=$("div","foot");
foot.appendChild($("div","eyebrow","Methodology & honest limits"));
const ul=document.createElement("ul");
(D.meta.caveats||[]).concat([
 "Point-in-time: daily stats from sessions before each date; pre-market bars 04:00–08:30 only. Session: "+(D.meta.sessionTemplate||"—")+".",
 "A single week is an anecdote, not a statistic — no edge is claimed. Badges mark which engine was validated in prior study, not a guarantee.",
 "Grading is three separate layers: selection (did the board contain the movers), day-filter (were declines right), execution (P&L vs. tape)."
]).forEach(c=>{const li=document.createElement("li");li.textContent=c;ul.appendChild(li);});
foot.appendChild(ul);
const mg=$("div","meta-grid");
const gRaw=D.meta.generatedAt; const gd=(gRaw&&!isNaN(new Date(gRaw).getTime()))?new Date(gRaw).toISOString().slice(0,16).replace("T"," ")+" UTC":(gRaw||"—");
[["provider",D.meta.dataProvider],["bars",D.meta.barTimeframe],["tz",D.meta.timezone],["generated",gd]]
 .forEach(([k,v])=>{const c=$("span","chip");c.innerHTML="<span>"+esc(k)+"</span> <b>"+esc(v)+"</b>";mg.appendChild(c);});
foot.appendChild(mg);
root.appendChild(foot);
`;

const html = `<title>Replay-Grader · Week of ${esc(data.days[0].day)}</title>
<div class="wrap"><div id="app"></div></div>
<style>${STYLE}</style>
<script>const DATA=${safeJson(data)};</script>
<script>${HELPERS}
${APP}</script>`;

writeFileSync(OUT, html);
console.log("wrote", OUT, "(" + html.length + " bytes) days=" + data.days.length + " picks=" + data.days.reduce((a, d) => a + d.picks.length, 0) + " movers=" + data.days.reduce((a, d) => a + d.movers.length, 0));
