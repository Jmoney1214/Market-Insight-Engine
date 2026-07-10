import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTradedRows, parseTradedRowsByDate } from "./parseReports.js";

// Uses the REAL unicode arrow (→) and unicode minus (−) exactly as the reports do.
const MD = [
  "| Sym | Class | Gap 8:30 | PM $ | Outcome | Trades | P&L |",
  "| MSTR | rider | +6.92% | $132.1M | traded | 10:10→10:25 stop −$239 | −$239 |",
  "| AMAT | scalper | +0.93% | $163.4M | declined: gap +0.93% < 1.5% | — | — |",
  "| ABVX | rider | +4.76% | $20.9M | traded | 09:50→15:50 eod +$230 | +$230 |",
].join("\n");

test("parses only traded rows; unicode arrow + minus handled", () => {
  const rows = parseTradedRows(MD);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { symbol: "MSTR", cls: "rider", entryHm: "10:10", reason: "stop", pnl: -239 });
  assert.deepEqual(rows[1], { symbol: "ABVX", cls: "rider", entryHm: "09:50", reason: "eod", pnl: 230 });
});

test("parses the actual committed July 2 report (real-file integration)", () => {
  const md = readFileSync(resolve(import.meta.dirname, "../../../research/reports/2026-07-02_2026-07-02.md"), "utf8");
  const rows = parseTradedRows(md);
  const mstr = rows.find((r) => r.symbol === "MSTR");
  const abvx = rows.find((r) => r.symbol === "ABVX");
  assert.ok(mstr && mstr.entryHm === "10:10" && mstr.reason === "stop" && mstr.pnl === -239);
  assert.ok(abvx && abvx.entryHm === "09:50" && abvx.reason === "eod" && abvx.pnl === 230);
});

test("section-aware parse attributes trades to their ## date across a multi-date report", () => {
  const md = readFileSync(resolve(import.meta.dirname, "../../../research/reports/2026-04-13_2026-04-17.md"), "utf8");
  const rows = parseTradedRowsByDate(md);
  // From the report: CRWV/OKLO/CRCL/IREN traded on 2026-04-14; IONQ/AVGO on 2026-04-15.
  const iren = rows.find((r) => r.symbol === "IREN");
  const ionq = rows.find((r) => r.symbol === "IONQ");
  assert.ok(iren && iren.date === "2026-04-14", `IREN date ${iren?.date}`);
  assert.ok(ionq && ionq.date === "2026-04-15", `IONQ date ${ionq?.date}`);
  assert.ok(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date)), "every row has a date");
});
