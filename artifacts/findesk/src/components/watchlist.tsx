import { useState } from "react";
import { Plus, List, Trash2, Loader2 } from "lucide-react";
import { useGetWatchlist, useAddToWatchlist, useRemoveFromWatchlist, getGetWatchlistQueryKey } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";

export function Watchlist() {
  const [newTicker, setNewTicker] = useState("");
  const queryClient = useQueryClient();
  
  const { data: watchlist, isLoading } = useGetWatchlist();
  const addMutation = useAddToWatchlist();
  const removeMutation = useRemoveFromWatchlist();

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicker) return;
    
    addMutation.mutate(
      { data: { ticker: newTicker.toUpperCase() } },
      {
        onSuccess: () => {
          setNewTicker("");
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        }
      }
    );
  };

  const handleRemove = (ticker: string) => {
    removeMutation.mutate(
      { ticker },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        }
      }
    );
  };

  return (
    <Card className="bg-card border-card-border h-full">
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <List className="w-5 h-5 text-primary" />
          Watchlist
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleAdd} className="flex gap-2 mb-4">
          <Input
            value={newTicker}
            onChange={(e) => setNewTicker(e.target.value.toUpperCase().slice(0, 5))}
            placeholder="TICKER"
            className="font-mono-numbers bg-background border-border uppercase"
            disabled={addMutation.isPending}
            maxLength={5}
          />
          <Button type="submit" size="icon" disabled={!newTicker || addMutation.isPending}>
            {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </form>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full bg-muted/50" />)}
          </div>
        ) : !watchlist || watchlist.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
            Watchlist is empty
          </div>
        ) : (
          <div className="space-y-2">
            {watchlist.map(entry => (
              <div 
                key={entry.id}
                className="group flex items-center justify-between p-3 rounded-md border border-border bg-background/50 hover:border-primary/30 transition-colors"
              >
                <span className="font-bold font-mono-numbers">{entry.ticker}</span>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  onClick={() => handleRemove(entry.ticker)}
                  disabled={removeMutation.isPending}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
