import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Read-only client. The publishable key + RLS-disabled tables allow SELECTs from
// any environment without DATABASE_URL. The engine only ever reads.
export function getReadClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Minimal shape the evidence builders depend on — satisfied by SupabaseClient and by test fakes. */
export type ReadClient = {
  from(table: string): { select(cols: string): Promise<{ data: any[] | null; error: unknown }> };
};
