import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface PositionState {
  status: "FLAT" | "IN_POSITION";
  direction: "LONG" | "SHORT" | null;
  entry: string;
  invalidation: string;
  target: string;
  currentR: string;
  thesisStatus: "VALID" | "WEAKENING" | "INVALIDATED" | "UNKNOWN";
}

const defaultState: PositionState = {
  status: "FLAT",
  direction: null,
  entry: "",
  invalidation: "",
  target: "",
  currentR: "",
  thesisStatus: "UNKNOWN"
};

export function PositionPanel() {
  const [pos, setPos] = useState<PositionState>(defaultState);
  const { toast } = useToast();

  useEffect(() => {
    const saved = localStorage.getItem("desk-position");
    if (saved) {
      try {
        setPos(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  const save = (newPos: PositionState) => {
    setPos(newPos);
    localStorage.setItem("desk-position", JSON.stringify(newPos));
  };

  const updateField = (field: keyof PositionState, value: any) => {
    save({ ...pos, [field]: value });
  };

  const handleJournal = () => {
    toast({
      title: "Coming Soon",
      description: "Journaling is slated for a later phase.",
      duration: 3000,
    });
  };

  const handleClear = () => {
    save(defaultState);
  };

  return (
    <div className="flex flex-col h-full font-mono text-sm overflow-y-auto">
      <div className="p-3 border-b border-border bg-muted/10 flex justify-between items-center shrink-0">
        <div className="text-xs text-muted-foreground">LOCAL POSITION (MANUAL)</div>
        <Badge variant="outline" className={`rounded-sm text-[10px] px-1 py-0 h-4 ${pos.status === 'IN_POSITION' ? 'bg-primary/20 text-primary border-primary/30' : 'bg-muted text-muted-foreground'}`}>
          {pos.status}
        </Badge>
      </div>

      <div className="p-3 space-y-3">
        {pos.status === 'FLAT' ? (
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full text-xs font-mono bg-card"
            onClick={() => updateField('status', 'IN_POSITION')}
          >
            START TRACKING
          </Button>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-muted-foreground text-[10px] mb-1 block">DIRECTION</label>
                <select 
                  className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                  value={pos.direction || ""}
                  onChange={(e) => updateField('direction', e.target.value)}
                >
                  <option value="">SELECT...</option>
                  <option value="LONG">LONG</option>
                  <option value="SHORT">SHORT</option>
                </select>
              </div>

              <div>
                <label className="text-muted-foreground text-[10px] mb-1 block">THESIS STATUS</label>
                <select 
                  className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                  value={pos.thesisStatus}
                  onChange={(e) => updateField('thesisStatus', e.target.value)}
                >
                  <option value="UNKNOWN">UNKNOWN</option>
                  <option value="VALID">VALID</option>
                  <option value="WEAKENING">WEAKENING</option>
                  <option value="INVALIDATED">INVALIDATED</option>
                </select>
              </div>

              <div>
                <label className="text-muted-foreground text-[10px] mb-1 block">ENTRY</label>
                <input 
                  type="number" 
                  className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                  value={pos.entry}
                  onChange={(e) => updateField('entry', e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="text-muted-foreground text-[10px] mb-1 block">CURRENT R</label>
                <input 
                  type="number" 
                  className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                  value={pos.currentR}
                  onChange={(e) => updateField('currentR', e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="text-muted-foreground text-[10px] mb-1 block">STOP / INVAL</label>
                <input 
                  type="number" 
                  className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                  value={pos.invalidation}
                  onChange={(e) => updateField('invalidation', e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="text-muted-foreground text-[10px] mb-1 block">TARGET</label>
                <input 
                  type="number" 
                  className="w-full bg-card border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-ring"
                  value={pos.target}
                  onChange={(e) => updateField('target', e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full text-xs font-mono border-primary text-primary hover:bg-primary/10"
                onClick={handleJournal}
              >
                ARCHIVE TRACKING NOTE
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full text-xs font-mono text-muted-foreground hover:text-foreground"
                onClick={handleClear}
              >
                CLEAR
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
