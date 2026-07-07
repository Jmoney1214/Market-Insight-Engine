// TradingView MCP adapter — pure, no I/O, no network.
// Turns a `data_get_trades` payload (a flat, alternating entry/exit ORDER list)
// into round-trip trades the parity core can consume. The payload carries NO
// wall-clock time: `time_index` is only a contiguous ORDER-SEQUENCE ordinal, so
// downstream matching is by chronological SEQUENCE, never by time.
//
// Order shape:  { id, type, side:"buy"|"sell", entry:bool, price, qty, time_index }
// Trade shape:  { seq, side:"long", entryPx, exitPx, qty, grossPnl, exitReason }

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

/** Exit reason from the exit order's id/type.
 *   STOP                       -> "stop"   (Long exit / STOP)
 *   LIMIT                      -> "target" (Long exit / LIMIT)
 *   "Close position order"     -> "close"  (strategy.close / EOD flatten)
 */
function exitReasonFor(order) {
  const type = String(order?.type ?? "").toUpperCase();
  if (type === "STOP") return "stop";
  if (type === "LIMIT") return "target";
  return "close";
}

/** Pull the raw order array from either the raw `data_get_trades` object
 * (`{trades:[...]}`) or the captured fixture wrapper (`{trades_sample:{trades:[...]}}`). */
function extractOrders(payload) {
  if (!payload || typeof payload !== "object")
    throw new Error("normalizeMcpTrades: payload must be an object");
  const raw = Array.isArray(payload.trades) ? payload.trades
    : Array.isArray(payload?.trades_sample?.trades) ? payload.trades_sample.trades
    : null;
  if (!raw)
    throw new Error("normalizeMcpTrades: no trades[] found (expected payload.trades or payload.trades_sample.trades)");
  return raw;
}

/** Normalize a data_get_trades payload into chronological round-trip trades.
 * Pairs orders by walking the time_index-sorted list: each entry:true opens a
 * position, the next entry:false closes it. Leading exits with no open are
 * skipped; a dangling entry (no matching exit) or duplicate ordinal throws. */
export function normalizeMcpTrades(payload) {
  const orders = extractOrders(payload).slice().sort((a, b) => a.time_index - b.time_index);
  const trades = [];
  let open = null;
  let prevIdx = -Infinity;
  for (const o of orders) {
    if (o.time_index === prevIdx)
      throw new Error(`normalizeMcpTrades: duplicate time_index ${o.time_index} — ordering is broken`);
    prevIdx = o.time_index;
    if (o.entry === true) {
      if (open)
        throw new Error(`normalizeMcpTrades: dangling entry at time_index ${open.time_index} — no exit before next entry`);
      open = o;
    } else {
      if (!open) continue; // leading exit with no open position — skip
      const entryPx = open.price, exitPx = o.price, qty = open.qty;
      trades.push({
        seq: trades.length,
        side: "long",
        entryPx, exitPx, qty,
        grossPnl: round((exitPx - entryPx) * qty, 2),
        exitReason: exitReasonFor(o),
      });
      open = null;
    }
  }
  if (open)
    throw new Error(`normalizeMcpTrades: dangling entry at time_index ${open.time_index} — no matching exit`);
  return trades;
}
