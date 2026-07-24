// Shared, canonical helpers for the replay-grader generators (build_report.mjs +
// build_dashboard.mjs). ONE source of truth so the two artifacts never disagree
// on a formatted number (prior drift: $1.53B vs $1.5B, +4.7% vs 4.7%).
//
// The pure formatters are written self-contained (no cross-references, no module
// scope) so build_dashboard.mjs can inject them verbatim into the browser APP via
// Function.prototype.toString() — the client code then runs the exact same logic.

export function dLabel(iso) {
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const p = String(iso || "").split("-").map(Number);
  const y = p[0], m = p[1], d = p[2];
  const wd = (y && m && d) ? WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] : "?";
  return { wd, short: (m && d) ? (m + "/" + d) : String(iso || "?"), iso: iso || "?" };
}
export function money(n, dp) {
  if (dp == null) dp = 2; n = Number(n) || 0;
  return (n < 0 ? "−" : n > 0 ? "+" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
export function pct(n, dp) {
  if (dp == null) dp = 1;
  if (n == null || isNaN(Number(n))) return "—";
  n = Number(n);
  return (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(dp) + "%";
}
export function bigD(n) {
  if (n == null || isNaN(Number(n))) return "—";
  n = Number(n); const a = Math.abs(n);
  if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(0) + "M";
  return "$" + Math.round(n).toLocaleString();
}
export function clsN(n) { return n > 0 ? "up" : n < 0 ? "down" : "flat"; }
export function pickPnl(p) { return (((p && p.trades) || [])).reduce(function (a, t) { return a + (Number(t && t.pnl) || 0); }, 0); }
export function statusInfo(s) {
  s = String(s || "");
  if (s.indexOf("traded") === 0) return { k: "s-traded", label: "Traded", why: "A trigger fired and the badge-matched engine took it." };
  if (s.indexOf("no trigger") >= 0) return { k: "s-notrig", label: "No trigger", why: "Qualified for the board but the engine's entry never fired intraday." };
  if (s.indexOf("declined") === 0) return { k: "s-declined", label: "Declined", why: "Filtered out before entry (" + s.replace("declined:", "").trim() + ") — the day-filter judged it un-tradeable." };
  return { k: "s-declined", label: s || "—", why: "" };
}

export const CLASSES = ["rider", "scalper", "caution", "avoid"];
export const NOTE = {
  rider: "avg daily range ≥6.5% and price ≥$20 — the Jump-Day Rider class (ride the day, no fixed target).",
  scalper: "≥$8B traded/day — the take-profit scalper class (1.5R targets).",
  caution: "a mid-range (4.5–6.5%/day) or sub-$20 mover — the rider edge decays or failed validation here; not traded.",
  avoid: "quiet tape / no qualifying volatility or liquidity — no validated engine, so it is skipped.",
  _unknown: "unclassified — no validated engine mapping.",
};
export const CODEDESC = {
  INVISIBLE_AT_0830: "not gapping at the 08:30 snapshot — ignited intraday, so the pre-market scan never saw it",
  RANK_CUT: "visible but ranked below the board cut (prelim top-30 → final top-5)",
  TOP5_CUT: "ranked inside the top 30 but outside the final top-5 board",
  NO_TRIGGER: "on the board but the entry trigger never fired intraday",
  BADGE_CUT: "badged avoid/caution — no validated engine (usually sub-$20 or illiquid)",
  GATED_PRICE_CAP: "excluded by the $150 price ceiling",
  GATED_PMVOL: "below the pre-market dollar-volume floor",
  GATED_HISTORY: "insufficient price history to badge",
  DECLINED: "on the board but declined by the day-filter",
  TRADED: "traded",
};
export const noteFor = (cls) => NOTE[cls] || NOTE._unknown;
export const badgeClass = (cls) => ["rider", "scalper", "caution", "avoid"].indexOf(cls) >= 0 ? cls : "avoid";
export const badgeLabel = (cls) => cls || "—";

// HTML-escape text before concatenating into innerHTML.
export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// JSON safe to embed inside a <script> block: escape `<` (so `</script>` can't break
// out) and U+2028/U+2029 (invalid raw in JS string literals). Code points given as
// numeric literals so no invisible characters can live in this source file.
const SCRIPT_UNSAFE = new Set([0x3c, 0x2028, 0x2029]);
export const safeJson = (o) => Array.from(JSON.stringify(o), (ch) =>
  SCRIPT_UNSAFE.has(ch.charCodeAt(0)) ? "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0") : ch).join("");
