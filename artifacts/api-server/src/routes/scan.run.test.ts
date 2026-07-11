import { test } from "vitest";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";

// No FMP/Alpaca keys locally -> scanAvailable() is false -> the guard returns 503.
test("POST /scan/scorecard/run returns 503 when providers are unconfigured", async () => {
  const res = await request(app).post("/api/scan/scorecard/run").send({});
  assert.equal(res.status, 503);
  assert.match(res.body.error ?? "", /providers not configured/i);
});
