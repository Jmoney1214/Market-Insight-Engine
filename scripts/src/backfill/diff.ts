type Trade = { symbol: string; date: string; entryHm: string };
const key = (t: Trade) => `${t.symbol}|${t.date}|${t.entryHm}`;

/** Compare the re-run trade set against the committed .md set on (symbol, date,
 * entryHm). Same trades = all matched. A trade that appears (in re-run, not .md)
 * or vanishes (in .md, not re-run) is a reportable divergence — the caller halts
 * on any add/remove rather than staging silently. */
export function diffTradeSets(rerun: Trade[], reference: Trade[]) {
  const rerunKeys = new Set(rerun.map(key));
  const refKeys = new Set(reference.map(key));
  const matched = [...rerunKeys].filter((k) => refKeys.has(k)).sort();
  const added = [...rerunKeys].filter((k) => !refKeys.has(k)).sort();
  const removed = [...refKeys].filter((k) => !rerunKeys.has(k)).sort();
  return { matched, added, removed };
}
