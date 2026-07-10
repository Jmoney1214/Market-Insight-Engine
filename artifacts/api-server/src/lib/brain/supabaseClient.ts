import { createClient } from "@supabase/supabase-js";

/** Minimal shape the evidence builders depend on — a fake satisfies it in tests,
 * and the real Supabase query builder satisfies it at runtime (its select() is a
 * thenable resolving to { data, error }). */
export type ReadClient = {
  from(table: string): { select(cols: string): Promise<{ data: any[] | null; error: unknown }> };
};

// Read-only client. The publishable key + RLS-disabled tables allow SELECTs from
// any environment without DATABASE_URL. The engine only ever reads. Returned as
// ReadClient (the narrow read surface) — the SupabaseClient is a structural
// superset whose builder is thenable, so the cast is sound.
export function getReadClient(): ReadClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set");
  return createClient(url, key, { auth: { persistSession: false } }) as unknown as ReadClient;
}
