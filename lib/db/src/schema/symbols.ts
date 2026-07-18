import { pgTable, text, real, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Symbol master — the eligible tradable universe ($1–$50, NYSE/NASDAQ/AMEX,
 * US common stock) plus metadata every downstream engine reads. Pure
 * structural eligibility; liquidity/size/float are metadata, never gates.
 */
export const symbolsTable = pgTable("symbols", {
  symbol: text("symbol").primaryKey(),
  name: text("name"),
  exchange: text("exchange"), // NYSE | NASDAQ | AMEX
  securityType: text("security_type"), // COMMON | ETF | FUND | WARRANT | UNIT | PREFERRED | ADR | UNKNOWN

  eligible: boolean("eligible").notNull().default(false),
  ineligibleReason: text("ineligible_reason"), // NOT_BROKER_TRADABLE | NON_COMMON | OUT_OF_BAND | STALE_QUOTE | null

  lastPrice: real("last_price"),
  prevClose: real("prev_close"),

  floatShares: real("float_shares"),
  sharesOutstanding: real("shares_outstanding"),
  floatPct: real("float_pct"),
  floatBucket: text("float_bucket"), // NANO | LOW | MID | HIGH | UNKNOWN
  lowFloat: boolean("low_float"),

  avgVolume: real("avg_volume"),
  avgDollarVolume: real("avg_dollar_volume"),
  marketCap: real("market_cap"),

  tradable: boolean("tradable"),
  shortable: boolean("shortable"),
  easyToBorrow: boolean("easy_to_borrow"),
  marginable: boolean("marginable"),
  fractionable: boolean("fractionable"),

  ssrFlag: boolean("ssr_flag"),
  dilutionRisk: text("dilution_risk"), // NONE | LOW | HIGH | UNKNOWN
  recentOffering: boolean("recent_offering"),
  recentSplit: boolean("recent_split"),
  isRecentIpo: boolean("is_recent_ipo"),
  ipoDate: text("ipo_date"),
  earningsDate: text("earnings_date"),

  sector: text("sector"),
  industry: text("industry"),
  sympathyTickers: text("sympathy_tickers").array(),

  lastFullRefresh: timestamp("last_full_refresh", { withTimezone: true }),
  lastDailyRefresh: timestamp("last_daily_refresh", { withTimezone: true }),
  staleSince: timestamp("stale_since", { withTimezone: true }),
  metadataIncomplete: boolean("metadata_incomplete").notNull().default(false),
});

export type SymbolRow = typeof symbolsTable.$inferSelect;
export type SymbolInsert = typeof symbolsTable.$inferInsert;
