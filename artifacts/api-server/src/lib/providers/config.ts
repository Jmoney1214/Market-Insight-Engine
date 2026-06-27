/**
 * Runtime configuration for live market-data providers.
 *
 * Keys are read from environment variables only — never hard-coded or committed.
 * Set them as Replit Secrets (deploy) or env vars (dev):
 *   - FMP_API_KEY            Financial Modeling Prep (fundamentals, financials, news)
 *   - ALPACA_API_KEY_ID      Alpaca market-data key id
 *   - ALPACA_API_SECRET_KEY  Alpaca market-data secret
 *   - ALPACA_FEED            optional, "sip" (default) or "iex"
 *
 * When a provider's keys are absent the report assembler degrades gracefully
 * to mock data for that provider's sections, so the app still runs.
 */

export const fmpApiKey = process.env["FMP_API_KEY"]?.trim() ?? "";

export const alpacaKeyId = process.env["ALPACA_API_KEY_ID"]?.trim() ?? "";
export const alpacaSecretKey = process.env["ALPACA_API_SECRET_KEY"]?.trim() ?? "";

/** Alpaca data feed: "sip" (consolidated, paid) or "iex" (free). Defaults to sip. */
export const alpacaFeed = (process.env["ALPACA_FEED"]?.trim() || "sip").toLowerCase();

export const hasFmp = fmpApiKey.length > 0;
export const hasAlpaca = alpacaKeyId.length > 0 && alpacaSecretKey.length > 0;

/** True when at least one live provider is configured. */
export const hasLiveData = hasFmp || hasAlpaca;
