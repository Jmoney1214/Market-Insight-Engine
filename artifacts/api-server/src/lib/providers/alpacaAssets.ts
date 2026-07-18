// artifacts/api-server/src/lib/providers/alpacaAssets.ts
/**
 * Alpaca TRADING API assets client (host distinct from the data client).
 * The asset list is the broker's own truth for tradability, security class,
 * exchange, and borrow status — the eligibility spine of the Universe Service.
 */
import { alpacaKeyId, alpacaSecretKey, hasAlpaca } from "./config.js";
import { logger } from "../logger.js";

// The /v2/assets reference list is identical on the paper and live hosts, so we
// default to the paper host (the desk runs on paper keys; live keys 401 the
// paper host and vice-versa). Override with ALPACA_TRADING_BASE for live keys.
const TRADING_BASE = process.env["ALPACA_TRADING_BASE"] ?? "https://paper-api.alpaca.markets";
const TIMEOUT_MS = 20000;

export interface AlpacaAsset {
  symbol: string;
  name: string | null;
  exchange: string;
  class: string;
  status: string;
  tradable: boolean;
  shortable: boolean;
  easyToBorrow: boolean;
  marginable: boolean;
  fractionable: boolean;
}

/** Pure: normalize one raw asset row; null when it has no symbol. */
export function mapAsset(raw: Record<string, unknown>): AlpacaAsset | null {
  const symbol = typeof raw["symbol"] === "string" ? (raw["symbol"] as string) : "";
  if (!symbol) return null;
  return {
    symbol,
    name: typeof raw["name"] === "string" ? (raw["name"] as string) : null,
    exchange: String(raw["exchange"] ?? ""),
    class: String(raw["class"] ?? ""),
    status: String(raw["status"] ?? ""),
    tradable: raw["tradable"] === true,
    shortable: raw["shortable"] === true,
    easyToBorrow: raw["easy_to_borrow"] === true,
    marginable: raw["marginable"] === true,
    fractionable: raw["fractionable"] === true,
  };
}

/** Fetch all active US-equity assets. Returns null on failure (degrade). */
export async function getAssets(): Promise<AlpacaAsset[] | null> {
  if (!hasAlpaca) return null;
  const url = new URL(`${TRADING_BASE}/v2/assets`);
  url.searchParams.set("status", "active");
  url.searchParams.set("asset_class", "us_equity");
  try {
    const res = await fetch(url, {
      headers: { "APCA-API-KEY-ID": alpacaKeyId, "APCA-API-SECRET-KEY": alpacaSecretKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Alpaca assets request failed");
      return null;
    }
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return null;
    return rows.map(mapAsset).filter((a): a is AlpacaAsset => a !== null);
  } catch (err) {
    logger.warn({ err: String(err) }, "Alpaca assets request errored");
    return null;
  }
}
