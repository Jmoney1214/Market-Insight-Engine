// artifacts/api-server/src/lib/universe/universeStore.ts
import { db, symbolsTable, type SymbolRow, type SymbolInsert } from "@workspace/db";
import { eq, isNull, sql, getTableColumns } from "drizzle-orm";
import type { EligibilityResult } from "./types.js";

/** Pure: derive the eligibility verdict from a stored row (or its absence). */
export function isEligibleFromRow(row: SymbolRow | undefined): EligibilityResult {
  if (!row) return { eligible: false, reason: "NOT_BROKER_TRADABLE" };
  return { eligible: row.eligible, reason: (row.ineligibleReason ?? null) as EligibilityResult["reason"] };
}

/** SET clause overwriting every column except `pk` with the incoming (excluded) value. */
export function conflictUpdateAllExcept(pk: string): Record<string, ReturnType<typeof sql>> {
  const cols = getTableColumns(symbolsTable);
  return Object.fromEntries(
    Object.entries(cols)
      .filter(([k]) => k !== pk)
      .map(([k, col]) => [k, sql`excluded.${sql.identifier(col.name)}`]),
  );
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
      set: conflictUpdateAllExcept("symbol"),
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
