// PAPER-LOG: replay the Momentum Buy/Sell strategy on a symbol's real 5-min SIP bars
// for a given day, record every trade (entry/exit/reason/R/PnL), and upsert the day's
// result into a JSONL log. Mirrors the Pine: BUY = new 10-bar high + close>VWAP +
// RVOL>=1.5, flat, price<=$20, RTH 9:35-15:55; SELL = close<EMA9, ATR(14)*1.5 hard stop,
// or 15:55 flatten. Long-only, next-bar fills, net of cost. NO validated edge — forward-test.
//   node --env-file=.env tools/router/avtr_paperlog.mjs [SYM] [YYYY-MM-DD]
import { alpacaBars } from "../research/lib/data.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SYM = (process.argv[2] || "AVTR").toUpperCase();
const DAY = process.argv[3] || new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const TF = process.argv[4] || "5Min";
const COST = Number(process.argv[5] || 0.0007), BRK = 10, RVOL_MIN = 1.5, EMA_LEN = 9, ATR_LEN = 14, STOP_MULT = 1.5, MAXP = 20;

const intr = await alpacaBars([SYM], TF, DAY, "2026-08-01", `paperlog_${TF}`, 0.02);
const daily = await alpacaBars([SYM], "1Day", "2026-06-01", "2026-08-01", "paperlog_1d", 6);
const sortB = (r) => [...r].sort((a, b) => (a.t < b.t ? -1 : 1));
const raw = intr.get(SYM);
if (!raw) { console.log(`${SYM} ${DAY}: no intraday data`); process.exit(0); }
// RTH bars 13:30-20:00Z (9:30-16:00 ET, EDT); ET minutes-of-day for the session window
const day = sortB(raw).filter((b) => b.t.slice(0, 10) === DAY && b.t.slice(11, 19) >= "13:30:00" && b.t.slice(11, 19) <= "20:00:00");
if (day.length < 5) { console.log(`${SYM} ${DAY}: thin/no session bars (${day.length})`); process.exit(0); }
const etMin = (b) => { const h = +b.t.slice(11, 13), m = +b.t.slice(14, 16); return (h - 4) * 60 + m; };  // EDT

const n = day.length;
const vwap = new Array(n); { let pv = 0, vv = 0; for (let i = 0; i < n; i++) { pv += (day[i].h + day[i].l + day[i].c) / 3 * day[i].v; vv += day[i].v; vwap[i] = vv > 0 ? pv / vv : day[i].c; } }
const ema = new Array(n); { const k = 2 / (EMA_LEN + 1); let e = day[0].c; for (let i = 0; i < n; i++) { e = i === 0 ? day[0].c : day[i].c * k + e * (1 - k); ema[i] = e; } }
const atr = new Array(n).fill(null); { let pr; for (let i = 0; i < n; i++) { const tr = i === 0 ? day[0].h - day[0].l : Math.max(day[i].h - day[i].l, Math.abs(day[i].h - day[i - 1].c), Math.abs(day[i].l - day[i - 1].c)); pr = i < ATR_LEN ? (i === 0 ? tr : (pr * i + tr) / (i + 1)) : (pr * (ATR_LEN - 1) + tr) / ATR_LEN; atr[i] = pr; } }
const rvolAt = (i) => { const lo = Math.max(0, i - 20); let s = 0, c = 0; for (let k = lo; k < i; k++) { s += day[k].v; c++; } const a = c ? s / c : 0; return a > 0 ? day[i].v / a : 0; };
const priorHigh = (i) => { let h = -Infinity; for (let k = Math.max(0, i - BRK); k < i; k++) h = Math.max(h, day[k].h); return h; };

const trades = [];
let pos = null;
for (let i = BRK; i < n; i++) {
  const et = etMin(day[i]), inWin = et >= 575 && et < 955;      // 9:35 - 15:55 ET
  if (!pos) {
    if (inWin && day[i].c > priorHigh(i) && day[i].c > vwap[i] && rvolAt(i) >= RVOL_MIN && day[i].c <= MAXP && i + 1 < n) {
      pos = { ei: i + 1, entry: day[i + 1].o, stop: day[i].c - STOP_MULT * (atr[i] || 0), et: day[i + 1].t.slice(11, 16) };
    }
  } else {
    const flatten = etMin(day[i]) >= 955;
    if (day[i].l <= pos.stop) { const ex = pos.stop; trades.push({ ...pos, exit: ex, xt: day[i].t.slice(11, 16), why: "stop" }); pos = null; }
    else if (day[i].c < ema[i] || flatten) { const ex = i + 1 < n ? day[i + 1].o : day[i].c; trades.push({ ...pos, exit: ex, xt: (i + 1 < n ? day[i + 1] : day[i]).t.slice(11, 16), why: flatten ? "EOD" : "EMA9" }); pos = null; }
  }
}
if (pos) { const last = day[n - 1]; trades.push({ ...pos, exit: last.c, xt: last.t.slice(11, 16), why: "open/mark" }); }

const rows = trades.map((t) => { const ret = (t.exit - t.entry) / t.entry - COST; const risk = (t.entry - t.stop) / t.entry; return { ...t, retPct: ret, R: risk > 0 ? (ret) / risk : null }; });
const dayRet = rows.reduce((s, t) => s + t.retPct, 0);
const wins = rows.filter((t) => t.retPct > 0).length;

const rec = { date: DAY, sym: SYM, trades: rows.length, wins, dayRetPct: +(dayRet * 100).toFixed(3), rows: rows.map((t) => ({ in: t.et, entry: +t.entry.toFixed(2), out: t.xt, exit: +t.exit.toFixed(2), why: t.why, retPct: +(t.retPct * 100).toFixed(2), R: t.R == null ? null : +t.R.toFixed(2) })), asOf: new Date().toISOString(), note: "paper forward-test of Momentum Buy/Sell; not a validated edge" };

const f = fileURLToPath(new URL("./scans/paperlog_momentum.jsonl", import.meta.url));
let lines = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
lines = lines.filter((l) => { try { const o = JSON.parse(l); return !(o.date === DAY && o.sym === SYM); } catch { return false; } });
lines.push(JSON.stringify(rec));
writeFileSync(f, lines.join("\n") + "\n");

console.log(`\n=== PAPER-LOG · ${SYM} · ${DAY} ===`);
if (!rows.length) console.log("  no BUY signal fired today (stood aside).");
for (const t of rec.rows) console.log(`  BUY ${t.in} $${t.entry} -> SELL ${t.out} $${t.exit} (${t.why})  ${t.retPct >= 0 ? "+" : ""}${t.retPct}%  ${t.R != null ? t.R + "R" : ""}`);
console.log(`  DAY: ${rows.length} trade(s), ${wins} win, ${dayRet >= 0 ? "+" : ""}${(dayRet * 100).toFixed(2)}%`);
console.log(`  logged -> ${f}\n`);
