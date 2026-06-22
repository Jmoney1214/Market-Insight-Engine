import { useState } from "react";
import { useLocation } from "wouter";
import { Plus, List, Trash2, Loader2, LineChart } from "lucide-react";
import {
  useGetWatchlist,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useAnalyzeTicker,
  getGetWatchlistQueryKey,
} from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";

export function Watchlist() {
  const [newTicker, setNewTicker] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: watchlist, isLoading } = useGetWatchlist();
  const addMutation = useAddToWatchlist();
  const removeMutation = useRemoveFromWatchlist();
  const analyze = useAnalyzeTicker();

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicker) return;

    addMutation.mutate(
      { data: { ticker: newTicker.toUpperCase() } },
      {
        onSuccess: () => {
          setNewTicker("");
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        },
      }
    );
  };

  const handleRemove = (ticker: string) => {
    removeMutation.mutate(
      { ticker },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        },
      }
    );
  };

  const handleAnalyze = (ticker: string) => {
    if (analyze.isPending) return;
    analyze.mutate(
      { data: { ticker } },
      { onSuccess: (report) => setLocation(`/report/${report.id}`) }
    );
  };

  const pendingTicker = analyze.isPending ? analyze.variables?.data?.ticker : undefined;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <List className="w-4 h-4 text-primary" />
          Watchlist
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleAdd} className="flex gap-2 mb-4">
          <Input
            value={newTicker}
            onChange={(e) => setNewTicker(e.target.value.toUpperCase().slice(0, 5))}
            placeholder="ADD TICKER"
            aria-label="Add ticker to watchlist"
            className="font-mono-numbers bg-background border-border uppercase h-9"
            disabled={addMutation.isPending}
            maxLength={5}
            data-testid="input-watchlist-add"
          />
          <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={!newTicker || addMutation.isPending} data-testid="button-watchlist-add">
            {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </form>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : !watchlist || watchlist.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
            Watchlist is empty
          </div>
        ) : (
          <div className="space-y-2">
            {watchlist.map((entry) => {
              const isPending = pendingTicker === entry.ticker;
              return (
                <div
                  key={entry.id}
                  className="group flex items-center justify-between p-3 rounded-md border border-border bg-background/40 hover-elevate"
                  data-testid={`row-watchlist-${entry.ticker}`}
                >
                  <span className="font-bold font-mono-numbers">{entry.ticker}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-primary opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                      onClick={() => handleAnalyze(entry.ticker)}
                      disabled={analyze.isPending}
                      data-testid={`button-analyze-${entry.ticker}`}
                    >
                      {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LineChart className="w-3.5 h-3.5" />}
                      <span className="ml-1">Analyze</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-bearish transition-opacity"
                      onClick={() => handleRemove(entry.ticker)}
                      disabled={removeMutation.isPending}
                      data-testid={`button-remove-${entry.ticker}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
