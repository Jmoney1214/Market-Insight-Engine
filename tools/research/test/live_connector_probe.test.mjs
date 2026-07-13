import assert from "node:assert/strict";
import test from "node:test";
import { probeLiveConnectors } from "../verify_live_connectors.mjs";

const env = {
  ALPACA_API_KEY_ID: "test-key-id",
  ALPACA_API_SECRET_KEY: "test-secret",
  FMP_API_KEY: "test-fmp-key",
};

const alpacaPayload = {
  bars: [{ t: "2026-07-12T14:30:00Z", o: 100, h: 101, l: 99, c: 100.5, v: 1200 }],
};

test("always probes Alpaca with feed=sip and returns a redacted schema summary", async () => {
  const calls = [];
  const result = await probeLiveConnectors({
    alpacaSip: true,
    env,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(alpacaPayload), { status: 200 });
    },
    now: () => new Date("2026-07-12T15:00:00.000Z"),
  });

  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get("feed"), "sip");
  assert.equal(result.alpaca.status, "ok");
  assert.equal(result.alpaca.schema, "alpaca_bars_v2");
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
});

test("does not call FMP unless an endpoint-family task is explicit", async () => {
  const urls = [];
  await probeLiveConnectors({
    alpacaSip: true,
    env,
    fetchImpl: async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify(alpacaPayload), { status: 200 });
    },
  });
  assert.equal(urls.some((url) => url.includes("financialmodelingprep.com")), false);
});

test("calls only the declared FMP profile task and validates its schema", async () => {
  const urls = [];
  const result = await probeLiveConnectors({
    alpacaSip: true,
    fmpTask: { family: "profile", symbol: "AAPL" },
    env,
    fetchImpl: async (url) => {
      urls.push(String(url));
      return url.toString().includes("financialmodelingprep.com")
        ? new Response(JSON.stringify([{ symbol: "AAPL", companyName: "Apple Inc." }]), { status: 200 })
        : new Response(JSON.stringify(alpacaPayload), { status: 200 });
    },
  });
  assert.equal(urls.length, 2);
  assert.equal(result.fmp.task, "profile:AAPL");
  assert.equal(result.fmp.schema, "fmp_profile");
});

test("fails without fallback on SIP authorization, throttle, server, or schema errors", async () => {
  for (const response of [
    new Response("forbidden", { status: 403 }),
    new Response("limited", { status: 429 }),
    new Response("broken", { status: 503 }),
    new Response(JSON.stringify({ bars: [{ bad: true }] }), { status: 200 }),
  ]) {
    let calls = 0;
    await assert.rejects(
      probeLiveConnectors({
        alpacaSip: true,
        fmpTask: { family: "profile", symbol: "AAPL" },
        env,
        fetchImpl: async () => {
          calls += 1;
          return response;
        },
      }),
      /ALPACA_SIP_/,
    );
    assert.equal(calls, 1);
  }
});

test("reports missing credential names without reading a dotenv file", async () => {
  await assert.rejects(
    probeLiveConnectors({ alpacaSip: true, env: {}, fetchImpl: async () => new Response() }),
    /MISSING_ENV: ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY/,
  );
});

test("reports every credential name required by an explicit combined probe", async () => {
  await assert.rejects(
    probeLiveConnectors({
      alpacaSip: true,
      fmpTask: { family: "profile", symbol: "AAPL" },
      env: {},
      fetchImpl: async () => new Response(),
    }),
    /MISSING_ENV: ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY, FMP_API_KEY/,
  );
});
