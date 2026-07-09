export type MdTrade = { symbol: string; cls: string; entryHm: string; reason: string; pnl: number };

// A traded row in the committed .md reports looks like:
//   | MSTR | rider | +6.92% | $132.1M | traded | 10:10→10:25 stop −$239 | −$239 |
// The real files use a unicode arrow (→, U+2192) and unicode minus (−, U+2212);
// accept ASCII variants too.
const ARROW = "(?:->|→)";
const SIGN = "[+\\-−]?";
const ROW = new RegExp(
  `^\\|\\s*([A-Z]{1,6})\\s*\\|\\s*(rider|scalper|caution|avoid)\\s*\\|.*\\btraded\\b.*` +
  `\\|\\s*(\\d{2}:\\d{2})\\s*${ARROW}\\s*\\d{2}:\\d{2}\\s+(stop|target|eod|data-end)\\b[^|]*` +
  `\\|\\s*(${SIGN}\\$?[\\d,]+)\\s*\\|`,
);

function toNumber(raw: string): number {
  const normalized = raw.replace(/−/g, "-").replace(/[$,]/g, "");
  return Number(normalized);
}

export function parseTradedRows(md: string): MdTrade[] {
  const out: MdTrade[] = [];
  for (const line of md.split("\n")) {
    const m = ROW.exec(line.trim());
    if (!m) continue;
    out.push({ symbol: m[1], cls: m[2], entryHm: m[3], reason: m[4], pnl: toNumber(m[5]) });
  }
  return out;
}

export type MdTradeDated = MdTrade & { date: string };
const DATE_HEADER = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;

/** Section-aware parse: attribute each traded row to the `## YYYY-MM-DD`
 * section it falls under. Works for both single-date and multi-date reports. */
export function parseTradedRowsByDate(md: string): MdTradeDated[] {
  const out: MdTradeDated[] = [];
  let date: string | null = null;
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    const h = DATE_HEADER.exec(line);
    if (h) { date = h[1]; continue; }
    const m = ROW.exec(line);
    if (!m || !date) continue;
    out.push({ symbol: m[1], cls: m[2], entryHm: m[3], reason: m[4], pnl: toNumber(m[5]), date });
  }
  return out;
}
