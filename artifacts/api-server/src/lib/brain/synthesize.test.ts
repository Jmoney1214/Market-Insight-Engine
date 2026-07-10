import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesize } from "./synthesize.js";
import type { EvidencePack } from "./types.js";

const pack: EvidencePack = { subject: { kind: "strategy", id: "JUMPDAY_RIDER" }, facts: [
  { source: "scoreboard", id: "JUMPDAY_RIDER", data: { status: "no_edge", sampleCount: 31, expectancyR: -0.29 } },
] };

test("synthesize returns the model's JSON answer + citations", async () => {
  const fake = async () => JSON.stringify({ answer: "no_edge because expectancy is -0.29R over 31 trades", citations: ["scoreboard:JUMPDAY_RIDER"] });
  const out = await synthesize(fake, "why no_edge?", pack);
  assert.match(out.answer, /-0.29R/);
  assert.deepEqual(out.citations, ["scoreboard:JUMPDAY_RIDER"]);
  assert.equal(out.evidencePack, pack);
});

test("non-JSON model output degrades to the raw text as the answer, empty citations", async () => {
  const fake = async () => "the rider just isn't working";
  const out = await synthesize(fake, "why?", pack);
  assert.match(out.answer, /isn.t working/);
  assert.deepEqual(out.citations, []);
});

test("synthesize hands the evidence pack to the model in the user message", async () => {
  let seenUser = "";
  const fake = async (_s: string, user: string) => { seenUser = user; return '{"answer":"ok","citations":[]}'; };
  await synthesize(fake, "why no_edge?", pack);
  assert.match(seenUser, /EVIDENCE/);
  assert.match(seenUser, /JUMPDAY_RIDER/);
});
