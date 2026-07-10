import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, Database, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchAgentFindings, type AgentFindingRow } from "@/lib/supabase";

const VERDICT_CLASS: Record<AgentFindingRow["verdict"], string> = {
  support: "bg-bullish/15 text-bullish border-bullish/30",
  reject: "bg-bearish/15 text-bearish border-bearish/30",
  neutral: "bg-muted text-muted-foreground border-border",
  unavailable: "bg-muted/50 text-muted-foreground border-border border-dashed",
};

const GRADE_CLASS: Record<string, string> = {
  correct: "bg-bullish/15 text-bullish border-bullish/30",
  incorrect: "bg-bearish/15 text-bearish border-bearish/30",
  mixed: "bg-caution/15 text-caution border-caution/30",
  ungradable: "bg-muted text-muted-foreground border-border",
};

interface AgentCalibration {
  agent: string;
  findings: number;
  graded: number;
  correct: number;
  mixed: number;
  avgScore: number | null;
}

function computeCalibration(rows: AgentFindingRow[]): AgentCalibration[] {
  const byAgent = new Map<string, AgentCalibration & { scoreSum: number; scoreN: number }>();
  for (const row of rows) {
    let c = byAgent.get(row.agent_name);
    if (!c) {
      c = { agent: row.agent_name, findings: 0, graded: 0, correct: 0, mixed: 0, avgScore: null, scoreSum: 0, scoreN: 0 };
      byAgent.set(row.agent_name, c);
    }
    c.findings += 1;
    for (const g of row.finding_grades) {
      if (g.grade === "ungradable") continue;
      c.graded += 1;
      if (g.grade === "correct") c.correct += 1;
      if (g.grade === "mixed") c.mixed += 1;
      if (g.score !== null) {
        c.scoreSum += g.score;
        c.scoreN += 1;
      }
    }
  }
  return [...byAgent.values()]
    .map((c) => ({ ...c, avgScore: c.scoreN > 0 ? c.scoreSum / c.scoreN : null }))
    .sort((a, b) => b.findings - a.findings);
}

function FindingCard({ row }: { row: AgentFindingRow }) {
  const grade = row.finding_grades[0];
  const when = new Date(row.created_at).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return (
    <Card data-testid={`finding-${row.id}`}>
      <CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono-numbers text-[10px]">#{row.id}</Badge>
          <Badge variant="outline">{row.agent_name}</Badge>
          {row.ticker ? <span className="font-semibold font-mono-numbers text-sm">{row.ticker}</span> : null}
          <Badge variant="outline" className={cn("uppercase text-[10px]", VERDICT_CLASS[row.verdict])}>
            {row.verdict}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono-numbers">
            conf {row.confidence.toFixed(2)}
          </span>
          {row.strategy_id ? (
            <Badge variant="outline" className="text-[10px]">{row.strategy_id}</Badge>
          ) : null}
          <span className="ml-auto text-[11px] text-muted-foreground font-mono-numbers">{when} ET</span>
        </div>
        <ul className="text-sm text-foreground/90 space-y-1 list-disc pl-5">
          {row.evidence.slice(0, 4).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
        {row.risks?.length ? (
          <p className="text-xs text-caution/90 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{row.risks.join(" · ")}</span>
          </p>
        ) : null}
        {grade ? (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
            <Badge variant="outline" className={cn("uppercase text-[10px]", GRADE_CLASS[grade.grade] ?? "")}>
              graded: {grade.grade}
            </Badge>
            {grade.score !== null ? (
              <span className="text-xs text-muted-foreground font-mono-numbers">score {grade.score.toFixed(2)}</span>
            ) : null}
            {grade.realized_move_pct !== null ? (
              <span className="text-xs text-muted-foreground font-mono-numbers">
                realized {grade.realized_move_pct > 0 ? "+" : ""}
                {grade.realized_move_pct.toFixed(1)}%
              </span>
            ) : null}
            <span className="text-[11px] text-muted-foreground">{grade.grader_ref}</span>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/60">
            ungraded — postflight grades this against the next session
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Live view of the crew's episodic memory: agent_findings + finding_grades from Supabase. */
export default function MemoryPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["agent-findings"],
    queryFn: () => fetchAgentFindings(100),
    staleTime: 60 * 1000,
  });

  const calibration = data ? computeCalibration(data) : [];

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6 space-y-6" data-testid="page-memory">
      <div className="flex items-center gap-2">
        <BrainCircuit className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold">Crew Memory</h1>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Database className="w-3 h-3" /> live from Supabase — findings are opinions, never trade signals
        </span>
      </div>

      {error ? (
        <Card>
          <CardContent className="p-5 text-sm text-bearish">
            Memory unreachable: {(error as Error).message}. The crew runs memory-blind until this recovers —
            nothing here is fabricated in the meantime.
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {data ? (
        <>
          <section data-testid="section-calibration">
            <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">
              Agent calibration
            </h2>
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2">Agent</th>
                      <th className="px-4 py-2 text-right">Findings</th>
                      <th className="px-4 py-2 text-right">Graded</th>
                      <th className="px-4 py-2 text-right">Hit rate</th>
                      <th className="px-4 py-2 text-right">Avg score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calibration.map((c) => (
                      <tr key={c.agent} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-2 font-medium">{c.agent}</td>
                        <td className="px-4 py-2 text-right font-mono-numbers">{c.findings}</td>
                        <td className="px-4 py-2 text-right font-mono-numbers">{c.graded}</td>
                        <td className="px-4 py-2 text-right font-mono-numbers">
                          {c.graded > 0 ? `${Math.round(((c.correct + 0.5 * c.mixed) / c.graded) * 100)}%` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono-numbers">
                          {c.avgScore !== null ? c.avgScore.toFixed(2) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Ungraded agents speak at stated confidence discounted 50% in the chief-analyst's fusion.
            </p>
          </section>

          <section className="space-y-3" data-testid="section-findings">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Findings ({data.length})
            </h2>
            {data.map((row) => (
              <FindingCard key={row.id} row={row} />
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}
