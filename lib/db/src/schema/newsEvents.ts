import { pgTable, serial, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Market-news event clusters — point-in-time first-seen ledger (append-only).
 * clusterKey = sha256 of the normalized headline; republished stories map to
 * the same cluster and are therefore detectable as stale.
 */
export const newsEventsTable = pgTable(
  "news_events",
  {
    id: serial("id").primaryKey(),
    clusterKey: text("cluster_key").notNull(),
    headline: text("headline").notNull(),
    symbols: jsonb("symbols").notNull().$type<string[]>(),
    source: text("source").notNull(),
    url: text("url"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("news_events_cluster_idx").on(t.clusterKey)],
);
