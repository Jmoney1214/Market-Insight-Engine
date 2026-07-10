import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "./diagnose.ts";

const db = { from() { return { select: async () => ({ data: [
  { mode: "RESEARCH", manual_outcome: { strategyName: "JUMPDAY_RIDER", outcomeConfidence: "MANUAL_CONFIRMED", rMultiple: -1, action: "stop_hit", timeWindow: "morning" } },
], error: null }) }; } };

test("diagnose routes a strategy question through evidence -> synthesize", async () => {
  const seen: string[] = [];
  const complete = async (_s: string, user: string) => { seen.push(user); return JSON.stringify({ answer: "ok", citations: ["scoreboard:JUMPDAY_RIDER"] }); };
  const out = await diagnose({ db, complete }, "why did JUMPDAY_RIDER go no_edge?");
  assert.equal(out.answer, "ok");
  assert.equal(out.evidencePack.subject.kind, "strategy");
  assert.match(seen[0], /EVIDENCE/); // the evidence pack was handed to the model
});

test("diagnose routes a bare date to a session subject", async () => {
  const complete = async () => JSON.stringify({ answer: "session ok", citations: [] });
  const out = await diagnose({ db, complete }, "what happened on 2026-07-06?");
  assert.equal(out.evidencePack.subject.kind, "session");
});

test("diagnose defaults an unmatched question to a system subject", async () => {
  const complete = async () => JSON.stringify({ answer: "system ok", citations: [] });
  const out = await diagnose({ db, complete }, "what's going on");
  assert.equal(out.evidencePack.subject.kind, "system");
});
