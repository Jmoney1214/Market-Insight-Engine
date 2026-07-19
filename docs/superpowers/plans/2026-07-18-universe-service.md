# Universe Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic Universe Service that maintains a `symbols` master — the eligible tradable set ($1–$50, NYSE/NASDAQ/AMEX, US common stock) plus squeeze-tuned metadata (float buckets, shortability, dilution/IPO flags) — refreshed nightly + pre-open, that every downstream engine reads.

**Architecture:** Pure deterministic logic (security-type classifier, float buckets, eligibility gate, row assembly) lives in `artifacts/api-server/src/lib/universe/` and is fully unit-tested with no I/O. Thin provider clients (a new Alpaca **trading-host** assets client; FMP bulk screener + per-symbol float + IPO calendar) feed a `buildUniverse` orchestrator that composes them, fails closed, and never wipes the universe on a provider outage. Two scheduled jobs (nightly EOD rebuild ~6–8 PM ET, pre-open refresh ~7 AM ET) drive it; downstream code reads via `universeStore`.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` import specifiers), Drizzle ORM (Postgres/Supabase, `drizzle-kit push`), Vitest, Express, Alpaca (data + trading REST), FMP "stable" REST, SEC EDGAR client.

**Spec:** `docs/superpowers/specs/2026-07-17-universe-service-design.md`

**Scope note (deliberate YAGNI):** Bulk fields (tradability, price/volume/mktcap, float, IPO, sector) are computed for the whole universe from a few **bulk** calls. Per-symbol-expensive EDGAR dilution/offering/split enrichment is **not** run for the full universe nightly (thousands of calls); `dilution_risk` defaults to `UNKNOWN` in the master and is enriched on-demand for the small active set by a later sub-project. `is_recent_ipo` (cheap, from the IPO calendar) and the float buckets — the operator's actual edge — are fully in scope now.

---

## File Structure

**Create:**
- `lib/db/src/schema/symbols.ts` — the `symbols` master table.
- `artifacts/api-server/src/lib/universe/types.ts` — shared types (`SecurityType`, `FloatBucket`, `IneligibleReason`, `SymbolMeta`, assemble inputs).
- `artifacts/api-server/src/lib/universe/eligibility.ts` — pure: `classifySecurityType`, `floatBucket`, `isRecentIpo`, `evaluateEligibility`.
- `artifacts/api-server/src/lib/universe/eligibility.test.ts`
- `artifacts/api-server/src/lib/universe/assemble.ts` — pure: `assembleSymbol` (composes the above into a row).
- `artifacts/api-server/src/lib/universe/assemble.test.ts`
- `artifacts/api-server/src/lib/providers/alpacaAssets.ts` — trading-host assets client + pure `mapAsset`.
- `artifacts/api-server/src/lib/providers/alpacaAssets.test.ts`
- `artifacts/api-server/src/lib/universe/universeStore.ts` — DB read/write + pure `rowToMeta`.
- `artifacts/api-server/src/lib/universe/universeStore.test.ts`
- `artifacts/api-server/src/lib/universe/buildUniverse.ts` — orchestration + pure `shouldAbortRebuild`.
- `artifacts/api-server/src/lib/universe/buildUniverse.test.ts`
- `artifacts/api-server/src/lib/universe/schedule.ts` — pure ET window predicates.
- `artifacts/api-server/src/lib/universe/schedule.test.ts`
- `artifacts/api-server/src/routes/universe.ts` — `GET /universe` inspection route.

**Modify:**
- `lib/db/src/schema/index.ts` — export the new table.
- `artifacts/api-server/src/lib/providers/fmp.ts` — add `getUniverseScreener`, `getSharesFloat`, `getRecentIpoSymbols`.
- `artifacts/api-server/src/lib/scan.ts` — call the universe jobs from the existing scheduler tick.
- `artifacts/api-server/src/index.ts` (or the route registrar) — mount `/universe`.

---

## Task 1: `symbols` master table

**Files:**
- Create: `lib/db/src/schema/symbols.ts`
- Modify: `lib/db/src/schema/index.ts`

- [ ] **Step 1: Create the table**

```typescript
// lib/db/src/schema/symbols.ts
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
```

- [ ] **Step 2: Export it from the barrel**

Add to `lib/db/src/schema/index.ts` (match the existing `export * from "./<file>";` lines):

```typescript
export * from "./symbols";
```

- [ ] **Step 3: Verify it typechecks and the barrel resolves**

Run: `pnpm run typecheck:libs`
Expected: PASS (no errors). This confirms the drizzle table + inferred types compile and `@workspace/db` re-exports `symbolsTable`.

- [ ] **Step 4: Commit**

```bash
git add lib/db/src/schema/symbols.ts lib/db/src/schema/index.ts
git commit -m "feat(universe): add symbols master table"
```

---

## Task 2: Security-type classifier (pure)

**Files:**
- Create: `artifacts/api-server/src/lib/universe/types.ts`
- Create: `artifacts/api-server/src/lib/universe/eligibility.ts`
- Test: `artifacts/api-server/src/lib/universe/eligibility.test.ts`

- [ ] **Step 1: Define shared types**

```typescript
// artifacts/api-server/src/lib/universe/types.ts
export type SecurityType =
  | "COMMON" | "ETF" | "FUND" | "WARRANT" | "UNIT" | "PREFERRED" | "ADR" | "UNKNOWN";

export type FloatBucket = "NANO" | "LOW" | "MID" | "HIGH" | "UNKNOWN";

export type IneligibleReason =
  | "NOT_BROKER_TRADABLE" | "NON_COMMON" | "OUT_OF_BAND" | "STALE_QUOTE" | null;

export interface ClassifyInput {
  symbol: string;
  fmpIsEtf: boolean;
  fmpIsFund: boolean;
  fmpIsAdr: boolean;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// artifacts/api-server/src/lib/universe/eligibility.test.ts
import { describe, it, expect } from "vitest";
import { classifySecurityType } from "./eligibility.js";

describe("classifySecurityType", () => {
  const base = { fmpIsEtf: false, fmpIsFund: false, fmpIsAdr: false };

  it("plain common stock is COMMON", () => {
    expect(classifySecurityType({ symbol: "AAPL", ...base })).toBe("COMMON");
  });
  it("dual-class common (BRK.B) is COMMON, not preferred", () => {
    expect(classifySecurityType({ symbol: "BRK.B", ...base })).toBe("COMMON");
  });
  it("FMP ETF flag wins", () => {
    expect(classifySecurityType({ symbol: "SPY", ...base, fmpIsEtf: true })).toBe("ETF");
  });
  it("FMP fund flag wins", () => {
    expect(classifySecurityType({ symbol: "PHK", ...base, fmpIsFund: true })).toBe("FUND");
  });
  it("warrant suffix .WS is WARRANT", () => {
    expect(classifySecurityType({ symbol: "ABCD.WS", ...base })).toBe("WARRANT");
  });
  it("unit suffix .U is UNIT", () => {
    expect(classifySecurityType({ symbol: "ABCD.U", ...base })).toBe("UNIT");
  });
  it("preferred suffix -PA is PREFERRED", () => {
    expect(classifySecurityType({ symbol: "ABC-PA", ...base })).toBe("PREFERRED");
  });
  it("rights suffix .R is WARRANT-family (non-common)", () => {
    expect(classifySecurityType({ symbol: "ABCD.R", ...base })).toBe("WARRANT");
  });
  it("ADR flag when no disqualifying suffix is ADR", () => {
    expect(classifySecurityType({ symbol: "BABA", ...base, fmpIsAdr: true })).toBe("ADR");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @workspace/api-server test -- eligibility`
Expected: FAIL — `classifySecurityType` is not exported / file missing.

- [ ] **Step 4: Implement**

```typescript
// artifacts/api-server/src/lib/universe/eligibility.ts
import type { ClassifyInput, SecurityType, FloatBucket, IneligibleReason } from "./types.js";

/** Suffix after the class separator (".", "-") that marks a non-common form. */
const NON_COMMON_SUFFIX = /[.\-](WS|WT|W|R|U|RT|P[A-Z]?)$/;

/**
 * Deterministic security-type classification. FMP flags are authoritative for
 * ETF/fund/ADR; symbol-suffix heuristics catch warrants/units/rights/preferred.
 * Single-letter share-class suffixes (A/B/C — e.g. BRK.B) are COMMON.
 */
export function classifySecurityType(input: ClassifyInput): SecurityType {
  if (input.fmpIsEtf) return "ETF";
  if (input.fmpIsFund) return "FUND";
  const m = input.symbol.toUpperCase().match(NON_COMMON_SUFFIX);
  if (m) {
    const suf = m[1]!;
    if (suf.startsWith("P")) return "PREFERRED";
    if (suf === "U") return "UNIT";
    return "WARRANT"; // W/WS/WT/R/RT — warrant/rights family
  }
  if (input.fmpIsAdr) return "ADR";
  return "COMMON";
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @workspace/api-server test -- eligibility`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/universe/types.ts artifacts/api-server/src/lib/universe/eligibility.ts artifacts/api-server/src/lib/universe/eligibility.test.ts
git commit -m "feat(universe): security-type classifier"
```

---

## Task 3: Float bucket + recent-IPO helpers (pure)

**Files:**
- Modify: `artifacts/api-server/src/lib/universe/eligibility.ts`
- Test: `artifacts/api-server/src/lib/universe/eligibility.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `eligibility.test.ts`:

```typescript
import { floatBucket, isRecentIpo } from "./eligibility.js";

describe("floatBucket", () => {
  it("null float is UNKNOWN", () => expect(floatBucket(null)).toBe("UNKNOWN"));
  it("3M is NANO", () => expect(floatBucket(3_000_000)).toBe("NANO"));
  it("5M is LOW (boundary, not NANO)", () => expect(floatBucket(5_000_000)).toBe("LOW"));
  it("19M is LOW", () => expect(floatBucket(19_000_000)).toBe("LOW"));
  it("20M is MID (boundary)", () => expect(floatBucket(20_000_000)).toBe("MID"));
  it("74M is MID", () => expect(floatBucket(74_000_000)).toBe("MID"));
  it("75M is HIGH (boundary)", () => expect(floatBucket(75_000_000)).toBe("HIGH"));
});

describe("isRecentIpo", () => {
  const now = "2026-07-18T12:00:00Z";
  it("null ipoDate is false", () => expect(isRecentIpo(null, now)).toBe(false));
  it("IPO 10 days ago is recent", () => expect(isRecentIpo("2026-07-08", now)).toBe(true));
  it("IPO 100 days ago is not recent", () => expect(isRecentIpo("2026-04-09", now)).toBe(false));
  it("IPO exactly 90 days ago is recent (inclusive)", () => expect(isRecentIpo("2026-04-19", now)).toBe(true));
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @workspace/api-server test -- eligibility`
Expected: FAIL — `floatBucket` / `isRecentIpo` not exported.

- [ ] **Step 3: Implement**

Append to `eligibility.ts`:

```typescript
/** Float buckets tuned to low-float momentum trading. */
export function floatBucket(floatShares: number | null): FloatBucket {
  if (floatShares == null || !Number.isFinite(floatShares)) return "UNKNOWN";
  if (floatShares < 5_000_000) return "NANO";
  if (floatShares < 20_000_000) return "LOW";
  if (floatShares < 75_000_000) return "MID";
  return "HIGH";
}

/** True when the IPO date is within `windowDays` (inclusive) of `nowIso`. */
export function isRecentIpo(ipoDate: string | null, nowIso: string, windowDays = 90): boolean {
  if (!ipoDate) return false;
  const ipo = Date.parse(ipoDate);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(ipo) || !Number.isFinite(now)) return false;
  const days = (now - ipo) / 86_400_000;
  return days >= 0 && days <= windowDays;
}
```

- [ ] **Step 4: Run and watch pass**

Run: `pnpm --filter @workspace/api-server test -- eligibility`
Expected: PASS (all eligibility tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/universe/eligibility.ts artifacts/api-server/src/lib/universe/eligibility.test.ts
git commit -m "feat(universe): float bucket + recent-IPO helpers"
```

---

## Task 4: Eligibility gate (pure)

**Files:**
- Modify: `artifacts/api-server/src/lib/universe/eligibility.ts`, `types.ts`
- Test: `artifacts/api-server/src/lib/universe/eligibility.test.ts`

- [ ] **Step 1: Add the gate input type**

Append to `types.ts`:

```typescript
export interface EligibilityInput {
  brokerTradable: boolean; // asset present, status active, class us_equity
  exchange: string | null; // normalized NYSE | NASDAQ | AMEX | other
  securityType: SecurityType;
  price: number | null;
  priceIsFresh: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: IneligibleReason;
}

export const ALLOWED_EXCHANGES = ["NYSE", "NASDAQ", "AMEX"] as const;
export const PRICE_MIN = 1;
export const PRICE_MAX = 50;
```

- [ ] **Step 2: Add the failing tests**

Append to `eligibility.test.ts`:

```typescript
import { evaluateEligibility } from "./eligibility.js";
import type { EligibilityInput } from "./types.js";

const ok: EligibilityInput = {
  brokerTradable: true, exchange: "NASDAQ", securityType: "COMMON", price: 4.5, priceIsFresh: true,
};

describe("evaluateEligibility", () => {
  it("all gates pass -> eligible", () => {
    expect(evaluateEligibility(ok)).toEqual({ eligible: true, reason: null });
  });
  it("not broker tradable -> NOT_BROKER_TRADABLE", () => {
    expect(evaluateEligibility({ ...ok, brokerTradable: false })).toEqual({ eligible: false, reason: "NOT_BROKER_TRADABLE" });
  });
  it("wrong exchange -> NOT_BROKER_TRADABLE", () => {
    expect(evaluateEligibility({ ...ok, exchange: "ARCA" })).toEqual({ eligible: false, reason: "NOT_BROKER_TRADABLE" });
  });
  it("AMEX is allowed", () => {
    expect(evaluateEligibility({ ...ok, exchange: "AMEX" }).eligible).toBe(true);
  });
  it("non-common -> NON_COMMON", () => {
    expect(evaluateEligibility({ ...ok, securityType: "WARRANT" })).toEqual({ eligible: false, reason: "NON_COMMON" });
  });
  it("below band -> OUT_OF_BAND", () => {
    expect(evaluateEligibility({ ...ok, price: 0.9 })).toEqual({ eligible: false, reason: "OUT_OF_BAND" });
  });
  it("above band -> OUT_OF_BAND", () => {
    expect(evaluateEligibility({ ...ok, price: 60 })).toEqual({ eligible: false, reason: "OUT_OF_BAND" });
  });
  it("band is inclusive at $1 and $50", () => {
    expect(evaluateEligibility({ ...ok, price: 1 }).eligible).toBe(true);
    expect(evaluateEligibility({ ...ok, price: 50 }).eligible).toBe(true);
  });
  it("null or stale price -> STALE_QUOTE", () => {
    expect(evaluateEligibility({ ...ok, price: null })).toEqual({ eligible: false, reason: "STALE_QUOTE" });
    expect(evaluateEligibility({ ...ok, priceIsFresh: false })).toEqual({ eligible: false, reason: "STALE_QUOTE" });
  });
});
```

- [ ] **Step 3: Run and watch fail**

Run: `pnpm --filter @workspace/api-server test -- eligibility`
Expected: FAIL — `evaluateEligibility` not exported.

- [ ] **Step 4: Implement**

Append to `eligibility.ts`:

```typescript
import { ALLOWED_EXCHANGES, PRICE_MIN, PRICE_MAX } from "./types.js";
import type { EligibilityInput, EligibilityResult } from "./types.js";

/**
 * Deterministic eligibility gate, ordered so the first failure names the
 * reason. Fail-closed: any unconfirmable gate → ineligible.
 */
export function evaluateEligibility(i: EligibilityInput): EligibilityResult {
  const exchangeOk = i.exchange != null && (ALLOWED_EXCHANGES as readonly string[]).includes(i.exchange);
  if (!i.brokerTradable || !exchangeOk) return { eligible: false, reason: "NOT_BROKER_TRADABLE" };
  if (i.securityType !== "COMMON") return { eligible: false, reason: "NON_COMMON" };
  if (i.price == null || !i.priceIsFresh || !Number.isFinite(i.price)) return { eligible: false, reason: "STALE_QUOTE" };
  if (i.price < PRICE_MIN || i.price > PRICE_MAX) return { eligible: false, reason: "OUT_OF_BAND" };
  return { eligible: true, reason: null };
}
```

Note: the price-null/stale check precedes the band check so a missing price reports `STALE_QUOTE`, not `OUT_OF_BAND`.

- [ ] **Step 5: Run and watch pass**

Run: `pnpm --filter @workspace/api-server test -- eligibility`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/universe/eligibility.ts artifacts/api-server/src/lib/universe/types.ts artifacts/api-server/src/lib/universe/eligibility.test.ts
git commit -m "feat(universe): eligibility gate"
```

---

## Task 5: Symbol row assembly (pure) — the heart

**Files:**
- Create: `artifacts/api-server/src/lib/universe/assemble.ts`
- Modify: `artifacts/api-server/src/lib/universe/types.ts`
- Test: `artifacts/api-server/src/lib/universe/assemble.test.ts`

- [ ] **Step 1: Add the assemble input type**

Append to `types.ts`:

```typescript
/** Raw per-symbol inputs from the three bulk sources, pre-joined by symbol. */
export interface AssembleInput {
  symbol: string;
  now: string; // ISO
  // FMP screener row (in-band, priced) — null if the symbol wasn't in the screener.
  screener: {
    name: string; price: number; volume: number; marketCap: number;
    sector: string | null; industry: string | null; exchange: string | null;
    isEtf: boolean; isFund: boolean; isAdr: boolean;
  } | null;
  // Alpaca asset (broker truth) — null if not a tradable us_equity.
  asset: {
    tradable: boolean; status: string; class: string; exchange: string;
    shortable: boolean; easyToBorrow: boolean; marginable: boolean; fractionable: boolean;
  } | null;
  // FMP shares-float — null if unavailable.
  float: { floatShares: number; sharesOutstanding: number } | null;
  isRecentIpo: boolean;
  ipoDate: string | null;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// artifacts/api-server/src/lib/universe/assemble.test.ts
import { describe, it, expect } from "vitest";
import { assembleSymbol } from "./assemble.js";
import type { AssembleInput } from "./types.js";

const now = "2026-07-18T23:00:00Z";
const screener = {
  name: "Runner Inc", price: 4.25, volume: 8_000_000, marketCap: 120_000_000,
  sector: "Healthcare", industry: "Biotech", exchange: "NASDAQ",
  isEtf: false, isFund: false, isAdr: false,
};
const asset = {
  tradable: true, status: "active", class: "us_equity", exchange: "NASDAQ",
  shortable: false, easyToBorrow: false, marginable: true, fractionable: true,
};
const base: AssembleInput = {
  symbol: "RUNR", now, screener, asset,
  float: { floatShares: 3_000_000, sharesOutstanding: 10_000_000 },
  isRecentIpo: false, ipoDate: "2020-01-01",
};

describe("assembleSymbol", () => {
  it("eligible low-float runner", () => {
    const r = assembleSymbol(base);
    expect(r.symbol).toBe("RUNR");
    expect(r.eligible).toBe(true);
    expect(r.ineligibleReason).toBeNull();
    expect(r.floatBucket).toBe("NANO");
    expect(r.lowFloat).toBe(true);
    expect(r.floatPct).toBeCloseTo(0.3, 5);
    expect(r.avgDollarVolume).toBeCloseTo(4.25 * 8_000_000, 0);
    expect(r.exchange).toBe("NASDAQ");
    expect(r.securityType).toBe("COMMON");
    expect(r.metadataIncomplete).toBe(false);
  });

  it("hard-to-borrow is retained (squeeze signal), still eligible", () => {
    const r = assembleSymbol(base); // easyToBorrow=false above
    expect(r.eligible).toBe(true);
    expect(r.easyToBorrow).toBe(false);
  });

  it("ETF is excluded NON_COMMON", () => {
    const r = assembleSymbol({ ...base, screener: { ...screener, isEtf: true } });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe("NON_COMMON");
    expect(r.securityType).toBe("ETF");
  });

  it("not broker-tradable (no asset) is NOT_BROKER_TRADABLE", () => {
    const r = assembleSymbol({ ...base, asset: null });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe("NOT_BROKER_TRADABLE");
  });

  it("out-of-band price excluded", () => {
    const r = assembleSymbol({ ...base, screener: { ...screener, price: 62 } });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe("OUT_OF_BAND");
  });

  it("missing float => UNKNOWN bucket, metadataIncomplete, still eligible", () => {
    const r = assembleSymbol({ ...base, float: null });
    expect(r.floatBucket).toBe("UNKNOWN");
    expect(r.floatShares).toBeNull();
    expect(r.metadataIncomplete).toBe(true);
    expect(r.eligible).toBe(true); // float is metadata, never a gate
  });

  it("missing screener (no price) => STALE_QUOTE, metadataIncomplete", () => {
    const r = assembleSymbol({ ...base, screener: null });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe("STALE_QUOTE");
    expect(r.metadataIncomplete).toBe(true);
  });

  it("recent IPO flag flows through", () => {
    const r = assembleSymbol({ ...base, isRecentIpo: true });
    expect(r.isRecentIpo).toBe(true);
  });
});
```

- [ ] **Step 3: Run and watch fail**

Run: `pnpm --filter @workspace/api-server test -- assemble`
Expected: FAIL — `assembleSymbol` missing.

- [ ] **Step 4: Implement**

```typescript
// artifacts/api-server/src/lib/universe/assemble.ts
import type { SymbolInsert } from "@workspace/db";
import type { AssembleInput } from "./types.js";
import { classifySecurityType, floatBucket, evaluateEligibility } from "./eligibility.js";

/** Compose the three bulk sources into one deterministic symbols row. */
export function assembleSymbol(i: AssembleInput): SymbolInsert {
  const securityType = i.screener
    ? classifySecurityType({ symbol: i.symbol, fmpIsEtf: i.screener.isEtf, fmpIsFund: i.screener.isFund, fmpIsAdr: i.screener.isAdr })
    : "UNKNOWN";

  const price = i.screener?.price ?? null;
  const exchange = i.asset?.exchange ?? i.screener?.exchange ?? null;

  const { eligible, reason } = evaluateEligibility({
    brokerTradable: !!i.asset && i.asset.tradable && i.asset.status === "active" && i.asset.class === "us_equity",
    exchange,
    securityType,
    price,
    priceIsFresh: i.screener != null,
  });

  const floatShares = i.float?.floatShares ?? null;
  const sharesOut = i.float?.sharesOutstanding ?? null;
  const floatPct = floatShares != null && sharesOut ? floatShares / sharesOut : null;
  const avgVolume = i.screener?.volume ?? null;
  const avgDollarVolume = avgVolume != null && price != null ? avgVolume * price : null;

  const metadataIncomplete = i.screener == null || i.float == null;

  return {
    symbol: i.symbol,
    name: i.screener?.name ?? null,
    exchange,
    securityType,
    eligible,
    ineligibleReason: reason,
    lastPrice: price,
    prevClose: null,
    floatShares,
    sharesOutstanding: sharesOut,
    floatPct,
    floatBucket: floatBucket(floatShares),
    lowFloat: floatShares != null ? floatShares < 20_000_000 : null,
    avgVolume,
    avgDollarVolume,
    marketCap: i.screener?.marketCap ?? null,
    tradable: i.asset?.tradable ?? null,
    shortable: i.asset?.shortable ?? null,
    easyToBorrow: i.asset?.easyToBorrow ?? null,
    marginable: i.asset?.marginable ?? null,
    fractionable: i.asset?.fractionable ?? null,
    ssrFlag: null, // set by the real-time layer, not here
    dilutionRisk: "UNKNOWN", // enriched on-demand by a later sub-project
    recentOffering: null,
    recentSplit: null,
    isRecentIpo: i.isRecentIpo,
    ipoDate: i.ipoDate,
    earningsDate: null,
    sector: i.screener?.sector ?? null,
    industry: i.screener?.industry ?? null,
    sympathyTickers: null,
    lastFullRefresh: new Date(i.now),
    lastDailyRefresh: new Date(i.now),
    staleSince: null,
    metadataIncomplete,
  };
}
```

- [ ] **Step 5: Run and watch pass**

Run: `pnpm --filter @workspace/api-server test -- assemble`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/universe/assemble.ts artifacts/api-server/src/lib/universe/types.ts artifacts/api-server/src/lib/universe/assemble.test.ts
git commit -m "feat(universe): symbol row assembly"
```

---

## Task 6: Alpaca trading-host assets client

**Files:**
- Create: `artifacts/api-server/src/lib/providers/alpacaAssets.ts`
- Test: `artifacts/api-server/src/lib/providers/alpacaAssets.test.ts`

- [ ] **Step 1: Write the failing test for the pure mapper**

```typescript
// artifacts/api-server/src/lib/providers/alpacaAssets.test.ts
import { describe, it, expect } from "vitest";
import { mapAsset } from "./alpacaAssets.js";

describe("mapAsset", () => {
  it("maps a tradable us_equity asset", () => {
    const raw = {
      symbol: "RUNR", name: "Runner Inc", exchange: "NASDAQ", class: "us_equity",
      status: "active", tradable: true, shortable: false, easy_to_borrow: false,
      marginable: true, fractionable: true,
    };
    expect(mapAsset(raw)).toEqual({
      symbol: "RUNR", name: "Runner Inc", exchange: "NASDAQ", class: "us_equity",
      status: "active", tradable: true, shortable: false, easyToBorrow: false,
      marginable: true, fractionable: true,
    });
  });
  it("returns null for a row without a symbol", () => {
    expect(mapAsset({ name: "x" } as Record<string, unknown>)).toBeNull();
  });
  it("coerces missing booleans to false", () => {
    const r = mapAsset({ symbol: "X", class: "us_equity", exchange: "NYSE", status: "active" });
    expect(r).not.toBeNull();
    expect(r!.tradable).toBe(false);
    expect(r!.easyToBorrow).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @workspace/api-server test -- alpacaAssets`
Expected: FAIL — module/`mapAsset` missing.

- [ ] **Step 3: Implement the client + mapper**

```typescript
// artifacts/api-server/src/lib/providers/alpacaAssets.ts
/**
 * Alpaca TRADING API assets client (host distinct from the data client).
 * The asset list is the broker's own truth for tradability, security class,
 * exchange, and borrow status — the eligibility spine of the Universe Service.
 */
import { alpacaKeyId, alpacaSecretKey, hasAlpaca } from "./config.js";
import { logger } from "../logger.js";

const TRADING_BASE = process.env["ALPACA_TRADING_BASE"] ?? "https://api.alpaca.markets";
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
```

- [ ] **Step 4: Run and watch pass**

Run: `pnpm --filter @workspace/api-server test -- alpacaAssets`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/providers/alpacaAssets.ts artifacts/api-server/src/lib/providers/alpacaAssets.test.ts
git commit -m "feat(universe): Alpaca trading-host assets client"
```

---

## Task 7: FMP bulk helpers (screener, float, IPO calendar)

**Files:**
- Modify: `artifacts/api-server/src/lib/providers/fmp.ts`
- Test: `artifacts/api-server/src/lib/providers/fmpUniverse.test.ts` (new)

- [ ] **Step 1: Write the failing test for the pure screener-row mapper**

```typescript
// artifacts/api-server/src/lib/providers/fmpUniverse.test.ts
import { describe, it, expect } from "vitest";
import { mapScreenerRow } from "./fmp.js";

describe("mapScreenerRow", () => {
  it("maps a full row", () => {
    const raw = {
      symbol: "RUNR", companyName: "Runner Inc", price: 4.25, volume: 8_000_000,
      marketCap: 120_000_000, sector: "Healthcare", industry: "Biotech",
      exchangeShortName: "NASDAQ", isEtf: false, isFund: false, isAdr: false,
    };
    expect(mapScreenerRow(raw)).toEqual({
      symbol: "RUNR", name: "Runner Inc", price: 4.25, volume: 8_000_000,
      marketCap: 120_000_000, sector: "Healthcare", industry: "Biotech",
      exchange: "NASDAQ", isEtf: false, isFund: false, isAdr: false,
    });
  });
  it("returns null without a symbol or price", () => {
    expect(mapScreenerRow({ price: 5 })).toBeNull();
    expect(mapScreenerRow({ symbol: "X" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @workspace/api-server test -- fmpUniverse`
Expected: FAIL — `mapScreenerRow` not exported.

- [ ] **Step 3: Implement — append to `fmp.ts`**

```typescript
export type UniverseScreenerRow = {
  symbol: string; name: string; price: number; volume: number; marketCap: number;
  sector: string | null; industry: string | null; exchange: string | null;
  isEtf: boolean; isFund: boolean; isAdr: boolean;
};

/** Pure: normalize one FMP company-screener row; null if unusable. */
export function mapScreenerRow(r: Record<string, unknown>): UniverseScreenerRow | null {
  const symbol = String(r["symbol"] ?? "");
  const price = Number(r["price"] ?? NaN);
  if (!symbol || !Number.isFinite(price)) return null;
  return {
    symbol,
    name: String(r["companyName"] ?? ""),
    price,
    volume: Number(r["volume"] ?? 0),
    marketCap: Number(r["marketCap"] ?? 0),
    sector: (r["sector"] as string) ?? null,
    industry: (r["industry"] as string) ?? null,
    exchange: (r["exchangeShortName"] as string) ?? (r["exchange"] as string) ?? null,
    isEtf: r["isEtf"] === true,
    isFund: r["isFund"] === true,
    isAdr: r["isAdr"] === true,
  };
}

/** Full in-band universe from the company-screener (one bulk call). */
export async function getUniverseScreener(
  minPrice: number, maxPrice: number, exchanges = "NASDAQ,NYSE,AMEX", limit = 8000,
): Promise<UniverseScreenerRow[] | null> {
  const rows = await fmpGet<Array<Record<string, unknown>>>("company-screener", {
    priceMoreThan: minPrice, priceLowerThan: maxPrice,
    isActivelyTrading: "true", exchange: exchanges, limit,
  });
  if (!Array.isArray(rows)) return null;
  if (rows.length >= limit) logger.warn({ limit, rows: rows.length }, "FMP universe screener hit the safety limit");
  return rows.map(mapScreenerRow).filter((r): r is UniverseScreenerRow => r !== null);
}

/** Per-symbol free float / shares outstanding. Null on failure. */
export async function getSharesFloat(
  symbol: string,
): Promise<{ floatShares: number; sharesOutstanding: number } | null> {
  const row = await fmpGet<Array<Record<string, unknown>>>("shares-float", { symbol }).then(first);
  if (!row) return null;
  const floatShares = Number(row["floatShares"] ?? NaN);
  const sharesOutstanding = Number(row["outstandingShares"] ?? NaN);
  if (!Number.isFinite(floatShares) || !Number.isFinite(sharesOutstanding)) return null;
  return { floatShares, sharesOutstanding };
}

/** Symbols with an IPO in [from, to] (YYYY-MM-DD). Bulk. Null on failure. */
export async function getRecentIpoSymbols(from: string, to: string): Promise<Set<string> | null> {
  const rows = await fmpGet<Array<Record<string, unknown>>>("ipos-calendar", { from, to });
  if (!Array.isArray(rows)) return null;
  return new Set(rows.map((r) => String(r["symbol"] ?? "")).filter(Boolean));
}
```

- [ ] **Step 4: Run and watch pass**

Run: `pnpm --filter @workspace/api-server test -- fmpUniverse`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/providers/fmp.ts artifacts/api-server/src/lib/providers/fmpUniverse.test.ts
git commit -m "feat(universe): FMP bulk screener + float + IPO helpers"
```

---

## Task 8: Universe store (DB read/write)

**Files:**
- Create: `artifacts/api-server/src/lib/universe/universeStore.ts`
- Test: `artifacts/api-server/src/lib/universe/universeStore.test.ts`

- [ ] **Step 1: Write the failing test for the pure `isEligibleFromRow` helper**

```typescript
// artifacts/api-server/src/lib/universe/universeStore.test.ts
import { describe, it, expect } from "vitest";
import { isEligibleFromRow } from "./universeStore.js";
import type { SymbolRow } from "@workspace/db";

const row = (over: Partial<SymbolRow>): SymbolRow => ({
  symbol: "RUNR", name: null, exchange: "NASDAQ", securityType: "COMMON",
  eligible: true, ineligibleReason: null, lastPrice: 4, prevClose: null,
  floatShares: null, sharesOutstanding: null, floatPct: null, floatBucket: "UNKNOWN",
  lowFloat: null, avgVolume: null, avgDollarVolume: null, marketCap: null,
  tradable: true, shortable: null, easyToBorrow: null, marginable: null, fractionable: null,
  ssrFlag: null, dilutionRisk: "UNKNOWN", recentOffering: null, recentSplit: null,
  isRecentIpo: false, ipoDate: null, earningsDate: null, sector: null, industry: null,
  sympathyTickers: null, lastFullRefresh: null, lastDailyRefresh: null, staleSince: null,
  metadataIncomplete: false, ...over,
});

describe("isEligibleFromRow", () => {
  it("eligible row", () => {
    expect(isEligibleFromRow(row({ eligible: true }))).toEqual({ eligible: true, reason: null });
  });
  it("ineligible row carries the reason", () => {
    expect(isEligibleFromRow(row({ eligible: false, ineligibleReason: "OUT_OF_BAND" })))
      .toEqual({ eligible: false, reason: "OUT_OF_BAND" });
  });
  it("missing row (undefined) is ineligible NOT_BROKER_TRADABLE", () => {
    expect(isEligibleFromRow(undefined)).toEqual({ eligible: false, reason: "NOT_BROKER_TRADABLE" });
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @workspace/api-server test -- universeStore`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// artifacts/api-server/src/lib/universe/universeStore.ts
import { db, symbolsTable, type SymbolRow, type SymbolInsert } from "@workspace/db";
import { eq, and, isNull, or, gt } from "drizzle-orm";
import type { EligibilityResult } from "./types.js";

/** Pure: derive the eligibility verdict from a stored row (or its absence). */
export function isEligibleFromRow(row: SymbolRow | undefined): EligibilityResult {
  if (!row) return { eligible: false, reason: "NOT_BROKER_TRADABLE" };
  return { eligible: row.eligible, reason: (row.ineligibleReason ?? null) as EligibilityResult["reason"] };
}

/** Upsert a batch of assembled rows (conflict on the symbol PK → overwrite). */
export async function upsertSymbols(rows: SymbolInsert[]): Promise<number> {
  if (rows.length === 0) return 0;
  const CHUNK = 500;
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await db.insert(symbolsTable).values(batch).onConflictDoUpdate({
      target: symbolsTable.symbol,
      set: Object.fromEntries(
        Object.keys(batch[0]!).filter((k) => k !== "symbol").map((k) => [k, (symbolsTable as any)[k]]),
      ),
    });
    n += batch.length;
  }
  return n;
}

/** All currently-eligible symbols with metadata. */
export function getEligibleUniverse(): Promise<SymbolRow[]> {
  return db.select().from(symbolsTable).where(eq(symbolsTable.eligible, true));
}

/** One symbol's full record, or null. */
export async function getSymbolMeta(symbol: string): Promise<SymbolRow | null> {
  const rows = await db.select().from(symbolsTable).where(eq(symbolsTable.symbol, symbol)).limit(1);
  return rows[0] ?? null;
}

/** Eligibility verdict for one symbol. */
export async function isEligible(symbol: string): Promise<EligibilityResult> {
  return isEligibleFromRow((await getSymbolMeta(symbol)) ?? undefined);
}

/** Mark every row stale (used when a refresh can't confirm freshness). */
export async function markAllStale(at: Date): Promise<void> {
  await db.update(symbolsTable).set({ staleSince: at }).where(isNull(symbolsTable.staleSince));
}
```

- [ ] **Step 4: Run and watch pass**

Run: `pnpm --filter @workspace/api-server test -- universeStore`
Expected: PASS (3 tests). (The DB functions are not exercised by unit tests — the pool is lazy; they run in the Task 11 smoke.)

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/universe/universeStore.ts artifacts/api-server/src/lib/universe/universeStore.test.ts
git commit -m "feat(universe): universe store read/write"
```

---

## Task 9: Build orchestration (nightly + daily refresh)

**Files:**
- Create: `artifacts/api-server/src/lib/universe/buildUniverse.ts`
- Test: `artifacts/api-server/src/lib/universe/buildUniverse.test.ts`

- [ ] **Step 1: Write the failing test for the pure degrade-guard + join**

```typescript
// artifacts/api-server/src/lib/universe/buildUniverse.test.ts
import { describe, it, expect } from "vitest";
import { shouldAbortRebuild, joinRows } from "./buildUniverse.js";
import type { UniverseScreenerRow } from "../providers/fmp.js";
import type { AlpacaAsset } from "../providers/alpacaAssets.js";

describe("shouldAbortRebuild", () => {
  it("aborts when the broker asset list is missing (can't confirm tradability)", () => {
    expect(shouldAbortRebuild(null, [])).toBe(true);
  });
  it("aborts when the screener is missing (no prices)", () => {
    expect(shouldAbortRebuild([], null)).toBe(true);
  });
  it("proceeds when both sources are present (even if empty arrays)", () => {
    expect(shouldAbortRebuild([], [])).toBe(false);
  });
});

describe("joinRows", () => {
  const asset: AlpacaAsset = {
    symbol: "RUNR", name: "Runner", exchange: "NASDAQ", class: "us_equity", status: "active",
    tradable: true, shortable: false, easyToBorrow: false, marginable: true, fractionable: true,
  };
  const screen: UniverseScreenerRow = {
    symbol: "RUNR", name: "Runner Inc", price: 4.25, volume: 8_000_000, marketCap: 1.2e8,
    sector: "Healthcare", industry: "Biotech", exchange: "NASDAQ", isEtf: false, isFund: false, isAdr: false,
  };
  it("drives off the screener set and joins the matching asset", () => {
    const out = joinRows([screen], [asset], new Set(), "2026-07-18T23:00:00Z");
    expect(out).toHaveLength(1);
    expect(out[0]!.symbol).toBe("RUNR");
    expect(out[0]!.eligible).toBe(true);
  });
  it("screener symbol with no matching asset is NOT_BROKER_TRADABLE", () => {
    const out = joinRows([screen], [], new Set(), "2026-07-18T23:00:00Z");
    expect(out[0]!.eligible).toBe(false);
    expect(out[0]!.ineligibleReason).toBe("NOT_BROKER_TRADABLE");
  });
  it("applies the recent-IPO set", () => {
    const out = joinRows([screen], [asset], new Set(["RUNR"]), "2026-07-18T23:00:00Z");
    expect(out[0]!.isRecentIpo).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @workspace/api-server test -- buildUniverse`
Expected: FAIL — module/functions missing.

- [ ] **Step 3: Implement**

```typescript
// artifacts/api-server/src/lib/universe/buildUniverse.ts
import type { SymbolInsert } from "@workspace/db";
import { logger } from "../logger.js";
import * as fmp from "../providers/fmp.js";
import type { UniverseScreenerRow } from "../providers/fmp.js";
import { getAssets, type AlpacaAsset } from "../providers/alpacaAssets.js";
import { assembleSymbol } from "./assemble.js";
import { floatBucket } from "./eligibility.js";
import { upsertSymbols, markAllStale } from "./universeStore.js";
import { PRICE_MIN, PRICE_MAX } from "./types.js";

/**
 * Fail-closed degrade guard: if either bulk source is missing we cannot
 * recompute eligibility safely, so we do NOT touch the master (never wipe).
 */
export function shouldAbortRebuild(
  screener: UniverseScreenerRow[] | null, assets: AlpacaAsset[] | null,
): boolean {
  return screener == null || assets == null;
}

/** Pure join: drive off the in-band screener set, attach the broker asset + IPO flag. */
export function joinRows(
  screener: UniverseScreenerRow[], assets: AlpacaAsset[], recentIpo: Set<string>, now: string,
): SymbolInsert[] {
  const assetBySymbol = new Map(assets.map((a) => [a.symbol, a]));
  return screener.map((s) =>
    assembleSymbol({
      symbol: s.symbol,
      now,
      screener: { name: s.name, price: s.price, volume: s.volume, marketCap: s.marketCap, sector: s.sector, industry: s.industry, exchange: s.exchange, isEtf: s.isEtf, isFund: s.isFund, isAdr: s.isAdr },
      asset: assetBySymbol.get(s.symbol) ?? null,
      float: null, // enriched below for the eligible subset
      isRecentIpo: recentIpo.has(s.symbol),
      ipoDate: null,
    }),
  );
}

/** Enrich the eligible subset with per-symbol float (bounded, concurrency-limited). */
async function enrichFloat(rows: SymbolInsert[]): Promise<void> {
  const eligible = rows.filter((r) => r.eligible);
  const LIMIT = 8;
  for (let i = 0; i < eligible.length; i += LIMIT) {
    const batch = eligible.slice(i, i + LIMIT);
    await Promise.all(
      batch.map(async (r) => {
        const f = await fmp.getSharesFloat(r.symbol);
        if (f) {
          r.floatShares = f.floatShares;
          r.sharesOutstanding = f.sharesOutstanding;
          r.floatPct = f.sharesOutstanding ? f.floatShares / f.sharesOutstanding : null;
          r.floatBucket = floatBucket(f.floatShares);
          r.lowFloat = f.floatShares < 20_000_000;
          r.metadataIncomplete = false; // float resolved; every row here came from a screener row
        }
      }),
    );
  }
}

/** Nightly full rebuild (~6–8 PM ET). Fail-closed: never wipe on a source outage. */
export async function runFullRebuild(now = new Date()): Promise<{ upserted: number; aborted: boolean }> {
  const nowIso = now.toISOString();
  const day = (ms: number) => new Date(now.getTime() + ms).toISOString().slice(0, 10);
  const [screener, assets, recentIpo] = await Promise.all([
    fmp.getUniverseScreener(PRICE_MIN, PRICE_MAX),
    getAssets(),
    fmp.getRecentIpoSymbols(day(-90 * 86_400_000), day(0)),
  ]);

  if (shouldAbortRebuild(screener, assets)) {
    logger.warn("Universe rebuild aborted: a bulk source was unavailable; keeping last-good");
    await markAllStale(now);
    return { upserted: 0, aborted: true };
  }

  const rows = joinRows(screener!, assets!, recentIpo ?? new Set(), nowIso);
  await enrichFloat(rows);
  const upserted = await upsertSymbols(rows);
  logger.info({ upserted, eligible: rows.filter((r) => r.eligible).length }, "Universe full rebuild complete");
  return { upserted, aborted: false };
}

/** Pre-open daily refresh (~7 AM ET): re-run the rebuild to refresh daily-mutable fields. */
export async function runDailyRefresh(now = new Date()): Promise<{ upserted: number; aborted: boolean }> {
  return runFullRebuild(now);
}
```

Note: `runDailyRefresh` re-uses the rebuild path for v1 (same bulk sources; the pre-open call simply refreshes tradability/price/float). A lighter incremental refresh is a future optimization, not needed to ship.

- [ ] **Step 4: Run and watch pass**

Run: `pnpm --filter @workspace/api-server test -- buildUniverse`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck the new module**

Run: `pnpm --filter @workspace/api-server exec tsc --noEmit`
Expected: PASS — `buildUniverse.ts` reuses `floatBucket()` from `eligibility.ts` (no duplicated thresholds) and every provider/store import resolves.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/universe/buildUniverse.ts artifacts/api-server/src/lib/universe/buildUniverse.test.ts
git commit -m "feat(universe): build orchestration with fail-closed degrade"
```

---

## Task 10: Schedule windows + wiring + inspection route

**Files:**
- Create: `artifacts/api-server/src/lib/universe/schedule.ts`
- Test: `artifacts/api-server/src/lib/universe/schedule.test.ts`
- Create: `artifacts/api-server/src/routes/universe.ts`
- Modify: `artifacts/api-server/src/lib/scan.ts`, the route registrar

- [ ] **Step 1: Write the failing test for the ET window predicates**

```typescript
// artifacts/api-server/src/lib/universe/schedule.test.ts
import { describe, it, expect } from "vitest";
import { isFullRebuildWindowET, isPreOpenWindowET } from "./schedule.js";

// helper: build a Date at a given America/New_York wall-clock hour on a weekday.
// 2026-07-20 is a Monday. EDT = UTC-4 in July.
const at = (hourET: number, min = 0) => new Date(Date.UTC(2026, 6, 20, hourET + 4, min));

describe("isFullRebuildWindowET", () => {
  it("true at 18:30 ET on a weekday", () => expect(isFullRebuildWindowET(at(18, 30))).toBe(true));
  it("false at 15:00 ET", () => expect(isFullRebuildWindowET(at(15))).toBe(false));
  it("false on a weekend", () => {
    const sun = new Date(Date.UTC(2026, 6, 19, 22, 30)); // 18:30 ET Sunday
    expect(isFullRebuildWindowET(sun)).toBe(false);
  });
});

describe("isPreOpenWindowET", () => {
  it("true at 07:00 ET on a weekday", () => expect(isPreOpenWindowET(at(7, 0))).toBe(true));
  it("false at 09:45 ET", () => expect(isPreOpenWindowET(at(9, 45))).toBe(false));
});
```

- [ ] **Step 2: Run and watch fail**

Run: `pnpm --filter @workspace/api-server test -- schedule`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the predicates**

```typescript
// artifacts/api-server/src/lib/universe/schedule.ts
/** America/New_York wall-clock parts for a Date (DST-correct via Intl). */
function etParts(now: Date): { hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: Number(parts["hour"] === "24" ? "0" : parts["hour"]),
    minute: Number(parts["minute"]),
    weekday: days[parts["weekday"] as string] ?? 0,
  };
}

const isWeekday = (wd: number) => wd >= 1 && wd <= 5;

/** Nightly EOD rebuild window: weekdays 18:00–20:00 ET. */
export function isFullRebuildWindowET(now: Date): boolean {
  const { hour, weekday } = etParts(now);
  return isWeekday(weekday) && hour >= 18 && hour < 20;
}

/** Pre-open refresh window: weekdays 07:00–07:59 ET. */
export function isPreOpenWindowET(now: Date): boolean {
  const { hour, weekday } = etParts(now);
  return isWeekday(weekday) && hour === 7;
}
```

- [ ] **Step 4: Run and watch pass**

Run: `pnpm --filter @workspace/api-server test -- schedule`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the jobs into the existing scan scheduler (once-per-window guard)**

In `artifacts/api-server/src/lib/scan.ts`, inside the existing `tick` function body (see the scheduler around `scan.ts:112–156`), add — after the existing scan logic — a universe driver guarded so it fires at most once per window per day:

```typescript
// --- Universe Service jobs (idempotent per window/day) ---
import { isFullRebuildWindowET, isPreOpenWindowET } from "./universe/schedule.js";
import { runFullRebuild, runDailyRefresh } from "./universe/buildUniverse.js";

let lastUniverseRebuildDay = "";
let lastUniverseRefreshDay = "";

async function tickUniverse(now: Date): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  if (isFullRebuildWindowET(now) && lastUniverseRebuildDay !== day) {
    lastUniverseRebuildDay = day;
    await runFullRebuild(now).catch((err) => logger.warn({ err: String(err) }, "universe rebuild failed"));
  }
  if (isPreOpenWindowET(now) && lastUniverseRefreshDay !== day) {
    lastUniverseRefreshDay = day;
    await runDailyRefresh(now).catch((err) => logger.warn({ err: String(err) }, "universe refresh failed"));
  }
}
```

Then call `void tickUniverse(new Date());` from inside the existing `tick()` (fire-and-forget, next to the existing scan work). Place the two new `import` lines at the top of `scan.ts` with the other imports (not mid-file — the mid-file placement above is illustrative).

- [ ] **Step 6: Add the inspection route**

```typescript
// artifacts/api-server/src/routes/universe.ts
import { Router, type IRouter } from "express";
import { getEligibleUniverse, getSymbolMeta } from "../lib/universe/universeStore.js";

const router: IRouter = Router();

/** Eligible-universe summary + a sample (inspection / health). */
router.get("/universe", async (_req, res) => {
  const rows = await getEligibleUniverse();
  res.json({
    eligibleCount: rows.length,
    lowFloatCount: rows.filter((r) => r.lowFloat).length,
    sample: rows.slice(0, 25).map((r) => ({ symbol: r.symbol, price: r.lastPrice, floatBucket: r.floatBucket, exchange: r.exchange })),
  });
});

/** One symbol's full metadata + eligibility. */
router.get("/universe/:symbol", async (req, res) => {
  const meta = await getSymbolMeta(String(req.params.symbol ?? "").toUpperCase());
  if (!meta) { res.status(404).json({ error: "unknown symbol" }); return; }
  res.json(meta);
});

export default router;
```

Register it where the other routers mount (mirror how `routes/scan.ts` / `routes/research.ts` are wired in the app bootstrap — `app.use(universeRouter)` alongside them).

- [ ] **Step 7: Run the full suite + typecheck**

Run: `pnpm -w test && pnpm run typecheck`
Expected: PASS — all universe tests green, the whole workspace typechecks.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/lib/universe/schedule.ts artifacts/api-server/src/lib/universe/schedule.test.ts artifacts/api-server/src/routes/universe.ts artifacts/api-server/src/lib/scan.ts artifacts/api-server/src/index.ts
git commit -m "feat(universe): schedule jobs + inspection route"
```

---

## Task 11: Migrate the schema + live smoke + review

**Files:** none new — this pushes the table and verifies end-to-end.

- [ ] **Step 1: Push the `symbols` table to the database**

Run: `pnpm --filter @workspace/db push`
Expected: drizzle-kit reports creating table `symbols`. (This targets the DATABASE_URL in `.env` — the shared Supabase instance. Additive only; no existing table is altered.)

- [ ] **Step 2: Run a one-shot rebuild against live providers**

Create a throwaway script `artifacts/api-server/scripts/universe-smoke.ts`:

```typescript
import "dotenv/config";
import { runFullRebuild } from "../src/lib/universe/buildUniverse.js";
import { getEligibleUniverse } from "../src/lib/universe/universeStore.js";

const r = await runFullRebuild();
const elig = await getEligibleUniverse();
console.log("rebuild:", r, "eligible:", elig.length, "lowFloat:", elig.filter((x) => x.lowFloat).length);
console.log("sample:", elig.slice(0, 10).map((x) => `${x.symbol} $${x.lastPrice} ${x.floatBucket}`));
process.exit(0);
```

Run: `pnpm --filter @workspace/api-server exec tsx scripts/universe-smoke.ts`
Expected: prints a non-zero `eligible` count (a few thousand), a non-zero `lowFloat` count, and a sample where every price is within $1–$50. If `aborted:true`, a provider key is missing — check `ALPACA_API_KEY_ID`/`ALPACA_API_SECRET_KEY`/`FMP_API_KEY`.

- [ ] **Step 3: Spot-check the eligibility rules against live data**

Run: `pnpm --filter @workspace/api-server exec tsx -e "import {getSymbolMeta} from './src/lib/universe/universeStore.js'; console.log(await getSymbolMeta('SPY'), await getSymbolMeta('BRK.B'))"`
Expected: `SPY` is present but `eligible:false` (ETF → NON_COMMON if it was screened, else absent); `BRK.B` if in-band shows `securityType:'COMMON'`. Confirms ETFs excluded, dual-class classified as common.

- [ ] **Step 4: Delete the throwaway smoke script**

```bash
rm artifacts/api-server/scripts/universe-smoke.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(universe): push symbols schema, verified live rebuild"
```

---

## Self-Review Checklist (run after implementing)

- [ ] **Spec coverage:** every spec section maps to a task — schema (T1), eligibility gate (T4), security-type classifier (T2), float buckets (T3), assembly + fail-closed metadata (T5), Alpaca assets client (T6), FMP sourcing (T7), store + read interface (T8), refresh jobs + degrade (T9), cadence windows (T10), migration + smoke (T11).
- [ ] **Fail-closed verified:** T5 tests prove missing float → eligible-with-UNKNOWN; missing broker asset → ineligible; T9 tests prove a null source aborts without wiping.
- [ ] **Type consistency:** `SymbolInsert`/`SymbolRow` from `@workspace/db` used throughout; `SecurityType`/`FloatBucket`/`IneligibleReason` from `types.ts`; float-bucket boundaries live in exactly one place — `floatBucket()` (T3), reused by `enrichFloat()` (T9). No duplicated thresholds.
- [ ] **No placeholders:** every step has runnable code + an exact command + expected output.
```
