// Report generator: stamped markdown (always) + optional standalone HTML.
// Reports are the durable, diffable record — research/reports/<range>.md.
import { mkdirSync, writeFileSync } from "node:fs";

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const money = (n) => `${n < 0 ? "−" : "+"}$${Math.abs(Math.round(n))}`;
const pct = (n) => `${n >= 0 ? "+" : ""}${n}%`;

export function renderMarkdown(results, meta) {
  const L = [];
  const allTrades = results.flatMap((d) => d.picks.flatMap((p) => (p.trades ?? []).map((t) => ({ ...t, sym: p.sym, day: d.day }))));
  const net = allTrades.reduce((s, t) => s + t.pnl, 0);
  const wins = allTrades.filter((t) => t.pnl > 0);
  const allMovers = results.flatMap((d) => d.attribution?.movers ?? []);

  L.push(`# FinDesk pipeline backtest — ${meta.dateRange}`);
  L.push("", "## Run metadata", "");
  for (const [k, v] of Object.entries(meta))
    L.push(Array.isArray(v) ? `- **${k}**:\n${v.map((c) => `  - ${c}`).join("\n")}` : `- **${k}**: ${v}`);
  L.push("", "## Summary", "",
    `| Net P&L | Trades | Wins/Losses | Movers (≥5%) | Board catch | Traded catch |`,
    `|---|---|---|---|---|---|`);
  const cr = results.map((d) => d.attribution?.catchRates).filter(Boolean);
  const avg = (k) => cr.length ? round(cr.reduce((s, c) => s + (c[k] ?? 0), 0) / cr.length, 1) : "—";
  L.push(`| ${money(net)} | ${allTrades.length} | ${wins.length}/${allTrades.length - wins.length} | ${allMovers.length} | ${avg("boardCatch")}% | ${avg("tradedCatch")}% |`);

  for (const d of results) {
    L.push("", `## ${d.day}${d.noSession ? " — no session (holiday/no data)" : ""}`);
    if (d.noSession) continue;
    L.push("", `Universe ${d.universeSize} · eligible ${d.picks.length} · day P&L ${money(d.dayPnl)}`);
    if (d.picks.length) {
      L.push("", "### Picks (badge-matched engine)", "",
        "| Sym | Class | Gap 8:30 | PM $ | Outcome | Trades | P&L |", "|---|---|---|---|---|---|---|");
      for (const p of d.picks) {
        const pnl = (p.trades ?? []).reduce((s, t) => s + t.pnl, 0);
        const tr = (p.trades ?? []).map((t) => `${t.entryHm}→${t.exitHm} ${t.reason} ${money(t.pnl)}`).join("; ") || "—";
        L.push(`| ${p.sym} | ${p.cls} | ${pct(p.gap)} | $${round(p.pmDollar / 1e6, 1)}M | ${p.status} | ${tr} | ${p.trades?.length ? money(pnl) : "—"} |`);
      }
    }
    const a = d.attribution;
    if (a?.movers.length) {
      L.push("", `### Movers ≥5% and why we caught/missed them (${a.movers.length})`, "",
        "| Sym | c/c | 9:40 ride | Max up/dn | Gap 8:30 | Class | Reason | Detail |", "|---|---|---|---|---|---|---|---|");
      for (const m of a.movers.slice(0, 25))
        L.push(`| ${m.sym} | ${pct(m.cc)} | ${pct(m.ride)} | ${pct(m.maxUp)}/${pct(m.maxDn)} | ${m.gapAt0830 != null ? pct(m.gapAt0830) : "—"} | ${m.cls ?? "—"} | \`${m.code}\` | ${m.detail} |`);
      if (a.movers.length > 25) L.push("", `_…and ${a.movers.length - 25} more (see results JSON)._`);
      const c = a.catchRates;
      L.push("", `Catch rates: board ${c.boardCatch}% · tradeable ${c.tradeableCatch}% · traded ${c.tradedCatch}% · capture ${c.captureRatio != null ? c.captureRatio + "%" : "n/a"} (P&L ${money(c.netPnl)} vs opportunity ~$${c.opportunity})`);
    }
  }
  L.push("", "---", `_Reason codes come from logged gate telemetry (deterministic), not post-hoc inference. Capture ratio = net P&L ÷ Σ(up-rides ≥5% × $12.5k half-notional)._`);
  return L.join("\n");
}

export function renderHtml(md, meta) {
  // Minimal, dependency-free md→html good enough for tables/headers/lists.
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const lines = md.split("\n");
  const out = [];
  let inTable = false;
  for (const raw of lines) {
    const l = esc(raw);
    if (/^\|/.test(raw)) {
      if (/^\|[\s-|]+\|$/.test(raw)) continue;
      const cells = l.split("|").slice(1, -1).map((c) => c.trim());
      if (!inTable) { out.push("<table><tr>" + cells.map((c) => `<th>${c}</th>`).join("") + "</tr>"); inTable = true; }
      else out.push("<tr>" + cells.map((c) => `<td>${c}</td>`).join("") + "</tr>");
      continue;
    }
    if (inTable) { out.push("</table>"); inTable = false; }
    if (/^# /.test(raw)) out.push(`<h1>${l.slice(2)}</h1>`);
    else if (/^## /.test(raw)) out.push(`<h2>${l.slice(3)}</h2>`);
    else if (/^### /.test(raw)) out.push(`<h3>${l.slice(4)}</h3>`);
    else if (/^- /.test(raw)) out.push(`<li>${l.slice(2)}</li>`);
    else if (raw === "---") out.push("<hr>");
    else if (raw.trim()) out.push(`<p>${l}</p>`);
  }
  if (inTable) out.push("</table>");
  const body = out.join("\n")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>").replace(/_(.+?)_/g, "<i>$1</i>");
  return `<title>Backtest ${meta.dateRange}</title><style>
body{font:14px/1.5 system-ui;max-width:1000px;margin:24px auto;padding:0 16px;color:#1a1d21;background:#fafbfc}
@media(prefers-color-scheme:dark){body{color:#e6e8eb;background:#16181c}table,th,td{border-color:#333!important}}
table{border-collapse:collapse;margin:10px 0;font-size:13px;display:block;overflow-x:auto}
th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;font-variant-numeric:tabular-nums}
code{background:rgba(127,127,127,.15);padding:1px 4px;border-radius:3px}h2{margin-top:28px}</style>
<body>${body}</body>`;
}

export function writeReports(results, meta, repoRoot, html = false) {
  const dir = `${repoRoot}/research/reports`;
  mkdirSync(dir, { recursive: true });
  const name = meta.dateRange.replace("..", "_");
  const md = renderMarkdown(results, meta);
  writeFileSync(`${dir}/${name}.md`, md);
  const files = [`research/reports/${name}.md`];
  if (html) { writeFileSync(`${dir}/${name}.html`, renderHtml(md, meta)); files.push(`research/reports/${name}.html`); }
  return files;
}
