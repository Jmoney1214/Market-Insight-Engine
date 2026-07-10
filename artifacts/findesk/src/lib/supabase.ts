import { createClient } from "@supabase/supabase-js";

// The publishable key is public by design (it ships in every browser bundle);
// the database enforces read-only access for it via RLS (anon may SELECT only).
// Override via VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY when pointing
// at another project.
const url =
  import.meta.env.VITE_SUPABASE_URL ?? "https://ganihlwaijdxpigssyab.supabase.co";
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_e3CMkui4gtv668USv2usSw__Mv8RqZz";

export const supabase = createClient(url, publishableKey, {
  auth: { persistSession: false },
});

export interface FindingGradeRow {
  id: number;
  finding_id: number;
  grade: "correct" | "incorrect" | "mixed" | "ungradable";
  realized: string[] | null;
  realized_outcome_window: string | null;
  realized_move_pct: number | null;
  follow_through: number | null;
  adverse_move: number | null;
  calibration_bucket: string | null;
  grader_ref: string;
  grader_version: string;
  score: number | null;
  graded_at: string;
}

export interface AgentFindingRow {
  id: number;
  run_id: string;
  event_id: string | null;
  agent_name: string;
  ticker: string | null;
  strategy_id: string | null;
  verdict: "support" | "reject" | "neutral" | "unavailable";
  confidence: number;
  evidence: string[];
  risks: string[] | null;
  required_followup: string[] | null;
  event_timestamp: string | null;
  provenance: { source: string; gitSha: string; configHash?: string; runRef?: string };
  created_at: string;
  finding_grades: FindingGradeRow[];
}

export async function fetchAgentFindings(limit = 100): Promise<AgentFindingRow[]> {
  const { data, error } = await supabase
    .from("agent_findings")
    .select("*, finding_grades(*)")
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`agent_findings read failed: ${error.message}`);
  return (data ?? []) as AgentFindingRow[];
}
