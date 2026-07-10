import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntent } from "./intent.js";

test("routes a registered strategy name to a strategy subject", () => {
  assert.deepEqual(parseIntent("why did JUMPDAY_RIDER go no_edge?"), { kind: "strategy", id: "JUMPDAY_RIDER" });
  assert.deepEqual(parseIntent("how is largecap_scalper doing"), { kind: "strategy", id: "LARGECAP_SCALPER" });
});

test("routes a date to a session subject", () => {
  assert.deepEqual(parseIntent("what happened on 2026-07-06?"), { kind: "session", date: "2026-07-06" });
});

test("routes error/failure words to a system subject with a default window", () => {
  assert.deepEqual(parseIntent("why did the scan fail last night"), { kind: "system", sinceHours: 24 });
  assert.deepEqual(parseIntent("any errors today"), { kind: "system", sinceHours: 24 });
});

test("defaults an unmatched question to system (broadest, safest)", () => {
  assert.equal(parseIntent("what's going on").kind, "system");
});
