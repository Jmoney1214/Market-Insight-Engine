// Pine <-> Node parity core — the shared verdict logic used by BOTH paths:
//   parity_check.mjs     (CSV export, matched by TIME: ±5min entry / ±10min exit)
//   tv_parity_check.mjs  (MCP trades, matched by chronological SEQUENCE: no time)
// Verdicts: MATCH | FILL_DIFF | EXIT_DIFF | SIGNAL_MISMATCH.

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

/** Default price tolerance: max($0.05, 0.2% of price). Fills inside this are a
 * feed/fill-model difference, not drift. */
export const defaultPriceTol = (px) => Math.max(0.05, px * 0.002);

// ---- time helpers (CSV path) --------------------------------------------------
const hmMinutes = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
const near = (a, b, mins = 5) => Math.abs(hmMinutes(a) - hmMinutes(b)) <= mins;

/** Classify one matched pair by PRICE (sequence mode has no time, so EXIT_DIFF
 * is decided by exit-price tolerance rather than exit time). tvTrade carries
 * {entryPx, exitPx}; nodeTrade carries {entry, exit}. A missing side -> mismatch. */
export function classifyPair(tvTrade, nodeTrade, { priceTol = defaultPriceTol } = {}) {
  if (!tvTrade || !nodeTrade) return "SIGNAL_MISMATCH";
  const exitDelta = Math.abs(nodeTrade.exit - tvTrade.exitPx);
  const entryDelta = Math.abs(nodeTrade.entry - tvTrade.entryPx);
  if (exitDelta > priceTol(tvTrade.exitPx)) return "EXIT_DIFF";
  if (entryDelta > priceTol(tvTrade.entryPx)) return "FILL_DIFF";
  return "MATCH";
}

/** CSV path: the EXISTING ±5min-entry / ±10min-exit greedy matcher, moved here
 * verbatim. Operates on one day's trades; caller stamps {day, status}. */
export function matchByTime(tvDay, nodeTrades, { day, status } = {}) {
  const results = [];
  const usedNode = new Set();
  for (const t of tvDay) {
    const m = nodeTrades.find((n, i) => !usedNode.has(i) && near(n.entryHm, t.entryHm) && usedNode.add(i) !== false);
    if (!m) { results.push({ day, verdict: "SIGNAL_MISMATCH", side: "tv-only", tv: t }); continue; }
    const exitOk = near(m.exitHm, t.exitHm, 10);
    const pxDelta = Math.abs(m.entry - t.entryPx);
    if (!exitOk) results.push({ day, verdict: "EXIT_DIFF", tv: t, node: m });
    else if (pxDelta > Math.max(0.05, t.entryPx * 0.002)) results.push({ day, verdict: "FILL_DIFF", pxDelta: +pxDelta.toFixed(3), tv: t, node: m });
    else results.push({ day, verdict: "MATCH", tv: t, node: m });
  }
  nodeTrades.forEach((n, i) => {
    if (!usedNode.has(i)) results.push({ day, verdict: "SIGNAL_MISMATCH", side: "node-only", node: n, status });
  });
  if (!tvDay.length && !nodeTrades.length)
    results.push({ day, verdict: "MATCH", note: `both flat (${status})` });
  return results;
}

/** Sequence path (MCP): zip trade N of each chronological list and compare
 * price/qty/side/pnl. Extra trades on either side -> SIGNAL_MISMATCH.
 * tvTrade: {seq, side, entryPx, exitPx, qty, grossPnl, exitReason}
 * nodeTrade: engine trade {entry, exit, qty, reason} (+ optional side). */
export function matchBySequence(tvTrades, nodeTrades, { priceTol = defaultPriceTol } = {}) {
  const results = [];
  const n = Math.max(tvTrades.length, nodeTrades.length);
  for (let i = 0; i < n; i++) {
    const tv = tvTrades[i], node = nodeTrades[i];
    if (tv && !node) {
      results.push({
        seq: i, verdict: "SIGNAL_MISMATCH", side: "tv-only",
        tvEntry: tv.entryPx, tvExit: tv.exitPx, nodeEntry: null, nodeExit: null,
        qtyTv: tv.qty, qtyNode: null, pnlTv: tv.grossPnl, pnlNode: null,
        exitReason: tv.exitReason, deltas: {},
      });
      continue;
    }
    if (!tv && node) {
      const nodeGross = round((node.exit - node.entry) * node.qty, 2);
      results.push({
        seq: i, verdict: "SIGNAL_MISMATCH", side: "node-only",
        tvEntry: null, tvExit: null, nodeEntry: node.entry, nodeExit: node.exit,
        qtyTv: null, qtyNode: node.qty, pnlTv: null, pnlNode: nodeGross,
        exitReason: node.reason, deltas: {},
      });
      continue;
    }
    const nodeGross = round((node.exit - node.entry) * node.qty, 2);
    const nodeSide = node.side ?? "long";
    const verdict = classifyPair(tv, node, { priceTol });
    const deltas = {
      entry: round(node.entry - tv.entryPx, 4),
      exit: round(node.exit - tv.exitPx, 4),
      qty: (node.qty ?? 0) - (tv.qty ?? 0),
      pnl: round(nodeGross - tv.grossPnl, 2),
      sideMatch: nodeSide === tv.side,
    };
    results.push({
      seq: i, verdict, side: null,
      tvEntry: tv.entryPx, tvExit: tv.exitPx, nodeEntry: node.entry, nodeExit: node.exit,
      qtyTv: tv.qty, qtyNode: node.qty, pnlTv: tv.grossPnl, pnlNode: nodeGross,
      exitReason: tv.exitReason, deltas,
    });
  }
  return results;
}

/** counts by verdict + drift (SIGNAL_MISMATCH + EXIT_DIFF), matching parity_check. */
export function tally(results) {
  const counts = {};
  for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  const drift = (counts.SIGNAL_MISMATCH ?? 0) + (counts.EXIT_DIFF ?? 0);
  return { counts, drift };
}

/** Hard-fail gate (user's thresholds). FAILS on: count mismatch, any side
 * mismatch, any entry/exit price beyond tolerance, any pnl beyond tolerance
 * (abs pnl delta > max($1, 1% of |pnlTv|)). Returns {failed, reasons[]}. */
export function hardFail(results, { tvCount, nodeCount, priceTol = defaultPriceTol } = {}) {
  const reasons = [];
  const pnlTol = (pnl) => Math.max(1.0, Math.abs(pnl) * 0.01);
  if (tvCount != null && nodeCount != null && tvCount !== nodeCount)
    reasons.push(`count mismatch: tv=${tvCount} vs node=${nodeCount}`);
  for (const r of results) {
    if (r.verdict === "SIGNAL_MISMATCH") {
      reasons.push(`seq ${r.seq}: ${r.side} signal mismatch`);
      continue;
    }
    if (r.deltas && r.deltas.sideMatch === false)
      reasons.push(`seq ${r.seq}: side mismatch`);
    if (r.tvEntry != null && r.nodeEntry != null &&
        Math.abs(r.nodeEntry - r.tvEntry) > priceTol(r.tvEntry))
      reasons.push(`seq ${r.seq}: entry px beyond tol (tv ${r.tvEntry} vs node ${r.nodeEntry})`);
    if (r.tvExit != null && r.nodeExit != null &&
        Math.abs(r.nodeExit - r.tvExit) > priceTol(r.tvExit))
      reasons.push(`seq ${r.seq}: exit px beyond tol (tv ${r.tvExit} vs node ${r.nodeExit})`);
    if (r.pnlTv != null && r.pnlNode != null &&
        Math.abs(r.pnlNode - r.pnlTv) > pnlTol(r.pnlTv))
      reasons.push(`seq ${r.seq}: pnl beyond tol (tv ${r.pnlTv} vs node ${r.pnlNode})`);
  }
  return { failed: reasons.length > 0, reasons };
}
