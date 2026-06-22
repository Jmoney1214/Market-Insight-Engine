import { useLocation } from "wouter";
import { format } from "date-fns";
import { Clock, Trash2 } from "lucide-react";
import { useListReports, useDeleteReport, getListReportsQueryKey } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { ratingTone, toneBadge } from "@/lib/finance";

export function RecentReports() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: reports, isLoading } = useListReports();
  const deleteReport = useDeleteReport();

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteReport.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
        },
      }
    );
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          Recent Analyses
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[68px] w-full" />
            ))}
          </div>
        ) : !reports || reports.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
            No reports yet. Enter a ticker above to generate one.
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((report) => (
              <div
                key={report.id}
                onClick={() => setLocation(`/report/${report.id}`)}
                className="group flex items-center justify-between p-4 rounded-lg border border-border bg-background/40 hover-elevate cursor-pointer"
                data-testid={`card-report-${report.id}`}
              >
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base font-mono-numbers">{report.ticker}</span>
                    <span className="text-sm text-muted-foreground truncate">{report.companyName}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                    <span className="truncate">{report.sector}</span>
                    <span>•</span>
                    <span className="font-mono-numbers shrink-0">{format(new Date(report.generatedAt), "MMM d, yyyy")}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <Badge className={cn("font-mono-numbers tracking-wider", toneBadge[ratingTone(report.overallRating)])}>
                    {report.overallRating}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-bearish transition-opacity"
                    onClick={(e) => handleDelete(e, report.id)}
                    disabled={deleteReport.isPending}
                    data-testid={`button-delete-${report.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
