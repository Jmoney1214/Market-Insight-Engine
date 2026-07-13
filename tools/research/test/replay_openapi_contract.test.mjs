import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("../../..", import.meta.url).pathname);

function pathSection(document, route) {
  const marker = `  ${route}:`;
  const start = document.indexOf(marker);
  assert.notEqual(start, -1, `missing OpenAPI route ${route}`);
  const remainder = document.slice(start + marker.length);
  const nextPath = remainder.match(/\n  \/[^\n]+:/);
  return nextPath ? remainder.slice(0, nextPath.index) : remainder;
}

test("replay 503 responses declare the JSON ApiError contract", async () => {
  const document = await readFile(
    path.join(root, "lib/api-spec/openapi.yaml"),
    "utf8",
  );

  for (const route of [
    "/copilot/replay/session",
    "/copilot/replay/event",
    "/copilot/replay/explain",
  ]) {
    const section = pathSection(document, route);
    const response503 = section.slice(section.indexOf('        "503":'));
    assert.match(
      response503,
      /content:\s+application\/json:\s+schema:\s+\$ref: "#\/components\/schemas\/ApiError"/,
      route,
    );
  }
});

test("generated replay query error types never include void", async () => {
  const generated = await readFile(
    path.join(root, "lib/api-client-react/src/generated/api.ts"),
    "utf8",
  );
  const replayVoidLines = generated
    .split("\n")
    .filter(
      (line) =>
        /ReplaySession|ReplayEvent/.test(line) &&
        line.includes("ApiError | void"),
    );

  assert.deepEqual(replayVoidLines, []);
  assert.match(generated, /GetReplaySessionQueryError = ErrorType<ApiError>/);
  assert.match(generated, /GetReplayEventQueryError = ErrorType<ApiError>/);
  assert.match(generated, /ExplainReplayEventQueryError = ErrorType<ApiError>/);
});
