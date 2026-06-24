import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StrategyLabPanel } from "./StrategyLabPanel";
import { EdgeScoreboardPanel } from "./EdgeScoreboardPanel";
import { JournalPanel } from "./JournalPanel";
import type { CopilotEvent } from "@workspace/api-client-react";

type TabKey = "strategy" | "scoreboard" | "journal";

const TABS: { key: TabKey; label: string }[] = [
  { key: "strategy", label: "STRATEGY LAB" },
  { key: "scoreboard", label: "EDGE SCOREBOARD" },
  { key: "journal", label: "JOURNAL" },
];

interface MeasurementDrawerProps {
  event?: CopilotEvent;
}

export function MeasurementDrawer({ event }: MeasurementDrawerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("strategy");

  const openTab = (key: TabKey) => {
    setTab(key);
    setOpen(true);
  };

  return (
    <>
      <div className="flex items-center gap-2 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => openTab(t.key)}
            className="border border-border rounded px-2 py-0.5 text-muted-foreground hover:text-foreground hover:border-primary/40 uppercase tracking-wider transition-colors"
            title={`Open ${t.label}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="h-[82vh] flex flex-col p-0 bg-background border-border"
        >
          <SheetHeader className="px-4 pt-4 pb-2 text-left shrink-0">
            <SheetTitle className="font-mono text-sm tracking-tight">
              MEASUREMENT SUBSYSTEM
            </SheetTitle>
            <SheetDescription className="font-mono text-[11px]">
              Deterministic registry & edge measurement — research only, never
              trading advice.
            </SheetDescription>
          </SheetHeader>

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as TabKey)}
            className="flex-1 flex flex-col min-h-0 px-4 pb-4"
          >
            <TabsList className="font-mono shrink-0">
              {TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="text-xs">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent
              value="strategy"
              className="flex-1 min-h-0 overflow-hidden"
            >
              <StrategyLabPanel />
            </TabsContent>
            <TabsContent
              value="scoreboard"
              className="flex-1 min-h-0 overflow-hidden"
            >
              <EdgeScoreboardPanel />
            </TabsContent>
            <TabsContent
              value="journal"
              className="flex-1 min-h-0 overflow-hidden"
            >
              <JournalPanel event={event} />
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  );
}
