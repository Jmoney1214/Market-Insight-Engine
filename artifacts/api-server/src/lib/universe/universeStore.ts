// artifacts/api-server/src/lib/universe/universeStore.ts
import { db, symbolsTable, type SymbolRow, type SymbolInsert } from "@workspace/db";
import { eq, isNull, sql, getTableColumns } from "drizzle-orm";
import type { EligibilityResult } from "./types.js";

/** Pure: derive the eligibility verdict from a stored row (or its absence). */
export function isEligibleFromRow(row: SymbolRow | undefined): EligibilityResult {
  if (!row) return { eligible: false, reason: "NOT_BROKER_TRADABLE" };
  return { eligible: row.eligible, reason: (row.ineligibleReason ?? null) as EligibilityResult["reason"] };
}

/**
 * SET clause overwriting every column except `pk` with the incoming (excluded)
 * value. Any JS key in `preserve` is ALSO excluded from the SET, so on conflict
 * those columns keep their existing DB value (fail-closed: never wipe last-good
 * on a partial refresh).
 */
export function conflictUpdateAllExcept(
  pk: string,
  preserve: string[] = [],
): Record<string, ReturnType<typeof sql>> {
  const skip = new Set([pk, ...preserve]);
  const cols = getTableColumns(symbolsTable);
  return Object.fromEntries(
    Object.entries(cols)
      .filter(([k]) => !skip.has(k))
      .map(([k, col]) => [k, sql`excluded.${sql.identifier(col.name)}`]),
  );
}

/**
 * Upsert a batch of assembled rows (conflict on the symbol PK → overwrite).
 * `opts.preserveCols` names JS columns whose existing DB value must survive the
 * conflict update (e.g. keep last-good float during a provider outage). New
 * symbols still INSERT their incoming value — preserve only affects ON CONFLICT.
 */
export async function upsertSymbols(
  rows: SymbolInsert[],
  opts?: { preserveCols?: string[] },
): Promise<number> {
  if (rows.length === 0) return 0;
  const set = conflictUpdateAllExcept("symbol", opts?.preserveCols ?? []);
  const CHUNK = 500;
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await db.insert(symbolsTable).values(batch).onConflictDoUpdate({
      target: symbolsTable.symbol,
      set,
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
