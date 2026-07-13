#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const ALPACA_DATA_BASE = "https://data.alpaca.markets";
const FMP_DATA_BASE = "https://financialmodelingprep.com/stable";
const FMP_FAMILIES = new Set(["profile", "news", "quote"]);

function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`MISSING_ENV: ${missing.join(", ")}`);
}

async function readJson(response, prefix) {
  if ([401, 403, 429].includes(response.status) || response.status >= 500 || !response.ok) {
    throw new Error(`${prefix}_HTTP_${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${prefix}_SCHEMA_ERROR: response is not JSON`);
  }
}

function assertAlpacaBars(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.bars) || payload.bars.length === 0) {
    throw new Error("ALPACA_SIP_SCHEMA_ERROR: bars must be a non-empty array");
  }
  for (const bar of payload.bars) {
    if (
      !bar ||
      typeof bar.t !== "string" ||
      ![bar.o, bar.h, bar.l, bar.c, bar.v].every((value) => typeof value === "number" && Number.isFinite(value))
    ) {
      throw new Error("ALPACA_SIP_SCHEMA_ERROR: invalid bar shape");
    }
  }
  return payload.bars.length;
}

function assertFmpPayload(family, symbol, payload) {
  const rows = Array.isArray(payload) ? payload : [];
  const first = rows[0];
  if (!first || typeof first !== "object" || String(first.symbol ?? "").toUpperCase() !== symbol) {
    throw new Error(`FMP_${family.toUpperCase()}_SCHEMA_ERROR: symbol row missing`);
  }
  if (family === "profile" && typeof first.companyName !== "string") {
    throw new Error("FMP_PROFILE_SCHEMA_ERROR: companyName missing");
  }
  if (family === "quote" && (typeof first.price !== "number" || !Number.isFinite(first.price))) {
    throw new Error("FMP_QUOTE_SCHEMA_ERROR: price missing");
  }
  if (family === "news" && typeof first.title !== "string") {
    throw new Error("FMP_NEWS_SCHEMA_ERROR: title missing");
  }
  return rows.length;
}

function fmpPath({ family, symbol }) {
  if (family === "profile") return [`${FMP_DATA_BASE}/profile`, { symbol }];
  if (family === "quote") return [`${FMP_DATA_BASE}/quote`, { symbol }];
  return [`${FMP_DATA_BASE}/news/stock`, { symbols: symbol, limit: "1" }];
}

export async function probeLiveConnectors({
  alpacaSip,
  fmpTask,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  if (alpacaSip !== true) throw new Error("ALPACA_SIP_PROBE_REQUIRED");
  if (typeof fetchImpl !== "function") throw new Error("FETCH_NOT_AVAILABLE");
  if (
    fmpTask &&
    (!FMP_FAMILIES.has(fmpTask.family) || !/^[A-Z0-9.\-=^]{1,12}$/.test(fmpTask.symbol))
  ) {
    throw new Error("INVALID_FMP_TASK: expected profile|news|quote:TICKER");
  }
  requireEnv(env, [
    "ALPACA_API_KEY_ID",
    "ALPACA_API_SECRET_KEY",
    ...(fmpTask ? ["FMP_API_KEY"] : []),
  ]);

  const alpacaUrl = new URL(`${ALPACA_DATA_BASE}/v2/stocks/AAPL/bars`);
  alpacaUrl.searchParams.set("timeframe", "1Min");
  alpacaUrl.searchParams.set("limit", "1");
  alpacaUrl.searchParams.set("adjustment", "split");
  alpacaUrl.searchParams.set("feed", "sip");
  const alpacaResponse = await fetchImpl(alpacaUrl, {
    headers: {
      "APCA-API-KEY-ID": env.ALPACA_API_KEY_ID,
      "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET_KEY,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  const alpacaPayload = await readJson(alpacaResponse, "ALPACA_SIP");
  const alpacaRecords = assertAlpacaBars(alpacaPayload);

  const summary = {
    checkedAt: now().toISOString(),
    alpaca: {
      status: "ok",
      feed: "sip",
      httpStatus: alpacaResponse.status,
      schema: "alpaca_bars_v2",
      records: alpacaRecords,
    },
  };

  if (!fmpTask) return summary;
  const [endpoint, params] = fmpPath(fmpTask);
  const fmpUrl = new URL(endpoint);
  for (const [name, value] of Object.entries(params)) fmpUrl.searchParams.set(name, value);
  fmpUrl.searchParams.set("apikey", env.FMP_API_KEY);
  const fmpResponse = await fetchImpl(fmpUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  const fmpPayload = await readJson(fmpResponse, `FMP_${fmpTask.family.toUpperCase()}`);
  const fmpRecords = assertFmpPayload(fmpTask.family, fmpTask.symbol, fmpPayload);
  return {
    ...summary,
    fmp: {
      status: "ok",
      task: `${fmpTask.family}:${fmpTask.symbol}`,
      httpStatus: fmpResponse.status,
      schema: `fmp_${fmpTask.family}`,
      records: fmpRecords,
    },
  };
}

function parseArgs(argv) {
  let alpacaSip = false;
  let fmpTask;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--alpaca-sip") {
      alpacaSip = true;
    } else if (arg === "--fmp") {
      const value = argv[index + 1] ?? "";
      index += 1;
      const [family, rawSymbol, ...extra] = value.split(":");
      if (!family || !rawSymbol || extra.length > 0) {
        throw new Error("INVALID_FMP_TASK: expected profile|news|quote:TICKER");
      }
      fmpTask = { family, symbol: rawSymbol.toUpperCase() };
    } else {
      throw new Error(`UNKNOWN_ARGUMENT: ${arg}`);
    }
  }
  return { alpacaSip, fmpTask };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const summary = await probeLiveConnectors(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
