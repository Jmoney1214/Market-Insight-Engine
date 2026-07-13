/**
 * Runtime configuration for live market-data providers.
 *
 * Keys are read from environment variables only — never hard-coded or committed.
 * Set them as Replit Secrets (deploy) or env vars (dev):
 *   - FMP_API_KEY            Financial Modeling Prep (fundamentals, financials, news)
 *   - ALPACA_API_KEY_ID      Alpaca market-data key id
 *   - ALPACA_API_SECRET_KEY  Alpaca market-data secret
 *
 * Missing required provider data fails closed; no mock provider is substituted.
 */

export const fmpApiKey = process.env["FMP_API_KEY"]?.trim() ?? "";

export const alpacaKeyId = process.env["ALPACA_API_KEY_ID"]?.trim() ?? "";
export const alpacaSecretKey = process.env["ALPACA_API_SECRET_KEY"]?.trim() ?? "";

/** Consolidated SIP is the only permitted Alpaca market-data feed. */
export const alpacaFeed = "sip" as const;

export const hasFmp = fmpApiKey.length > 0;
export const hasAlpaca = alpacaKeyId.length > 0 && alpacaSecretKey.length > 0;

/** True when at least one live provider is configured. */
export const hasLiveData = hasFmp || hasAlpaca;
