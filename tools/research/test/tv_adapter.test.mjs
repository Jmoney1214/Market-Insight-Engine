import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeMcpTrades } from "../lib/tradingview_mcp_adapter.mjs";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/tv_trades_hims_rider.json", import.meta.url), "utf8"),
);

test("normalizeMcpTrades: 20 orders pair into 10 round-trip trades", () => {
  const trades = normalizeMcpTrades(fixture);
  assert.equal(trades.length, 10);
  assert.ok(trades.every((t) => t.side === "long"));
});

test("normalizeMcpTrades: first trade fields + grossPnl math", () => {
  const [t0] = normalizeMcpTrades(fixture);
  assert.equal(t0.seq, 0);
  assert.equal(t0.entryPx, 16.45);
  assert.equal(t0.exitPx, 16.39);
  assert.equal(t0.qty, 555);
  assert.equal(t0.grossPnl, -33.3); // (16.39 - 16.45) * 555
  assert.equal(t0.exitReason, "close"); // "Close position order"
});

test("normalizeMcpTrades: STOP exit derives reason 'stop'", () => {
  const trades = normalizeMcpTrades(fixture);
  const t1 = trades[1]; // entry 24.84 -> STOP 24.05, qty 348
  assert.equal(t1.exitReason, "stop");
  assert.equal(t1.entryPx, 24.84);
  assert.equal(t1.exitPx, 24.05);
  assert.equal(t1.qty, 348);
  assert.equal(t1.grossPnl, -274.92); // (24.05 - 24.84) * 348
});

test("normalizeMcpTrades: trades are chronological (seq ascending)", () => {
  const trades = normalizeMcpTrades(fixture);
  for (let i = 0; i < trades.length; i++) assert.equal(trades[i].seq, i);
});

test("normalizeMcpTrades: accepts the raw {trades:[...]} shape too", () => {
  const raw = { trades: fixture.trades_sample.trades };
  assert.equal(normalizeMcpTrades(raw).length, 10);
});

test("normalizeMcpTrades: unsorted input is sorted by time_index", () => {
  const shuffled = { trades: [...fixture.trades_sample.trades].reverse() };
  const trades = normalizeMcpTrades(shuffled);
  assert.equal(trades.length, 10);
  assert.equal(trades[0].entryPx, 16.45); // time_index 36 still first
});

test("normalizeMcpTrades: throws on a dangling entry (no matching exit)", () => {
  const dangling = {
    trades: [
      { id: "Long", type: "MARKET", side: "buy", entry: true, price: 10, qty: 100, time_index: 0 },
      { id: "Close position order", type: "MARKET", side: "sell", entry: false, price: 11, qty: 100, time_index: 1 },
      { id: "Long", type: "MARKET", side: "buy", entry: true, price: 12, qty: 100, time_index: 2 }, // never closed
    ],
  };
  assert.throws(() => normalizeMcpTrades(dangling), /dangling entry/);
});

test("normalizeMcpTrades: throws when an entry has no exit before the next entry", () => {
  const doubled = {
    trades: [
      { id: "Long", type: "MARKET", side: "buy", entry: true, price: 10, qty: 100, time_index: 0 },
      { id: "Long", type: "MARKET", side: "buy", entry: true, price: 12, qty: 100, time_index: 1 },
    ],
  };
  assert.throws(() => normalizeMcpTrades(doubled), /dangling entry/);
});

test("normalizeMcpTrades: skips a leading exit with no open position", () => {
  const leadingExit = {
    trades: [
      { id: "Close position order", type: "MARKET", side: "sell", entry: false, price: 9, qty: 100, time_index: 0 },
      { id: "Long", type: "MARKET", side: "buy", entry: true, price: 10, qty: 100, time_index: 1 },
      { id: "Close position order", type: "MARKET", side: "sell", entry: false, price: 11, qty: 100, time_index: 2 },
    ],
  };
  const trades = normalizeMcpTrades(leadingExit);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].entryPx, 10);
});
