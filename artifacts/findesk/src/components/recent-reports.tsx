import { useLocation } from "wouter";
import { format } from "date-fns";
import { Clock, TrendingUp, TrendingDown, Minus, Trash2 } from "lucide-react";
import { useListReports, useDeleteReport, getListReportsQueryKey } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";

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
        }
      }
    );
  };

  const getRatingColor = (rating: string) => {
    switch (rating.toUpperCase()) {
      case "BUY": return "bg-green-500/10 text-green-500 border-green-500/20";
      case "SELL": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "HOLD": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  return (
    <Card className="bg-card border-card-border h-full">
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          Recent Analyses
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full bg-muted/50" />)}
          </div>
        ) : !reports || reports.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
            No recent reports found. Enter a ticker above to start.
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map(report => (
              <div 
                key={report.id}
                onClick={() => setLocation(`/report/${report.id}`)}
                className="group flex items-center justify-between p-4 rounded-lg border border-border bg-background/50 hover:bg-accent/20 hover:border-primary/30 cursor-pointer transition-all"
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg font-mono-numbers">{report.ticker}</span>
                    <span className="text-sm text-muted-foreground">{report.companyName}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                    <span>{report.sector}</span>
                    <span>•</span>
                    <span>{format(new Date(report.generatedAt), "MMM d, yyyy")}</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <Badge variant="outline" className={`font-mono-numbers tracking-wider ${getRatingColor(report.overallRating)}`}>
                    {report.overallRating}
                  </Badge>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    onClick={(e) => handleDelete(e, report.id)}
                    disabled={deleteReport.isPending}
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
