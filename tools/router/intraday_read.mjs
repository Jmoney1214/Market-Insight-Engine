// Live intraday read for timing entries: VWAP, opening range, session hi/lo, RVOL,
// and the key long triggers/stop levels. Off Alpaca SIP 5-min. Read-only.
//   node --env-file=.env tools/router/intraday_read.mjs AVTR VRRM SOFI PLUG
import { alpacaBars } from "../research/lib/data.mjs";
const syms = process.argv.slice(2).filter((a) => /^[A-Z.]{1,6}$/.test(a));
if (!syms.length) syms.push("AVTR", "VRRM", "SOFI", "PLUG");
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const OPEN = `${DAY}T13:30:00Z`, NOW = new Date().toISOString();     // 9:30 ET (EDT)
const intr = await alpacaBars(syms, "5Min", DAY, "2026-07-30", "intraday_read", 0.02);
const daily = await alpacaBars(syms, "1Day", "2026-06-01", "2026-07-30", "intraday_read_d", 6);
const sortB = (r) => [...r].sort((a, b) => (a.t < b.t ? -1 : 1));
const p = (x) => (x == null ? "  -  " : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`);

console.log(`\n=== INTRADAY READ · ${DAY} @ ${NOW.slice(11, 16)}Z ===`);
for (const s of syms) {
  const raw = intr.get(s), draw = daily.get(s);
  if (!raw) { console.log(`\n${s}: no intraday data`); continue; }
  const day = sortB(raw).filter((x) => x.t >= OPEN && x.t <= NOW);
  if (day.length < 2) { console.log(`\n${s}: thin/no session bars yet`); continue; }
  const d = draw ? sortB(draw) : [];
  const di = d.findIndex((x) => x.t.slice(0, 10) === DAY);
  const prior = di > 0 ? d[di - 1].c : (d.length ? d[d.length - 1].c : null);
  const vol20 = di >= 20 ? d.slice(di - 20, di).reduce((a, b) => a + (b.v || 0), 0) / 20 : null;
  let pv = 0, vv = 0; for (const x of day) { pv += (x.h + x.l + x.c) / 3 * x.v; vv += x.v; }
  const vwap = vv > 0 ? pv / vv : null;
  const open = day[0].o, now = day[day.length - 1].c;
  const hi = Math.max(...day.map((x) => x.h)), lo = Math.min(...day.map((x) => x.l));
  const orb = day.slice(0, 3);                                       // first 15 min
  const orbHi = Math.max(...orb.map((x) => x.h)), orbLo = Math.min(...orb.map((x) => x.l));
  const cumVol = day.reduce((a, b) => a + (b.v || 0), 0);
  const rvol = vol20 ? cumVol / (0.55 * vol20) : null;              // ~55% of daily done by ~1pm
  const last6 = day.slice(-6), t6 = (now - last6[0].o) / last6[0].o;
  const pos = hi > lo ? (now - lo) / (hi - lo) : 0.5;
  const above = vwap != null && now > vwap;
  console.log(`\n${s}  $${now.toFixed(2)}  ${prior ? "day " + p((now - prior) / prior) : ""}  ${above ? "ABOVE" : "BELOW"} VWAP ${p((now - vwap) / vwap)}`);
  console.log(`   VWAP $${(vwap ?? 0).toFixed(2)}   ORB(9:30-45) hi $${orbHi.toFixed(2)} / lo $${orbLo.toFixed(2)}   session hi $${hi.toFixed(2)} / lo $${lo.toFixed(2)}`);
  console.log(`   now ${(pos * 100).toFixed(0)}% of range · RVOL ${(rvol ?? 0).toFixed(1)}x · last-30 ${p(t6)} ${t6 >= 0 ? "(holding/up)" : "(fading)"}`);
  const trig = Math.max(orbHi, hi * 0.999);
  console.log(`   >> LONG bias while > VWAP $${(vwap ?? 0).toFixed(2)}; breakout trigger ~ $${trig.toFixed(2)} (ORB/session hi); stop back under VWAP`);
}
console.log("");
