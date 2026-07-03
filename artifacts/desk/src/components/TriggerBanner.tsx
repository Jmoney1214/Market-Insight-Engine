import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useTriggerAlertStore } from "@/hooks/use-trigger-alert-store";
import type { TriggerAlert } from "@/lib/trigger-alerts";

// Custom terminal-styled live trigger banner. NOT a generic toast — clicking an
// alert focuses the matching trigger in the live board, scrolls it into view,
// and dismisses the banner. Wording is deterministic (no LLM). This is a
// research signal only and never implies any action.

const SECTION_ID = "trigger-stack-section";

function formatName(name: string): string {
  return name.replace(/_/g, " ");
}

function categoryTag(category: TriggerAlert["category"]): {
  label: string;
  className: string;
} {
  if (category === "primary_edge") {
    return {
      label: "EDGE",
      className: "border-primary/40 text-primary bg-primary/10",
    };
  }
  return {
    label: "CONTEXT",
    className: "border-border text-muted-foreground bg-muted/30",
  };
}

export function TriggerBanner() {
  const alerts = useTriggerAlertStore((s) => s.alerts);
  const dismissAlert = useTriggerAlertStore((s) => s.dismissAlert);
  const focusTrigger = useTriggerAlertStore((s) => s.focusTrigger);

  const handleOpen = (name: string) => {
    focusTrigger(name);
    dismissAlert(name);
    if (typeof document !== "undefined") {
      const el = document.getElementById(SECTION_ID);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  return (
    <div className="pointer-events-none fixed top-14 left-1/2 z-50 flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col gap-2">
      <AnimatePresence initial={false}>
        {alerts.map((alert) => {
          const tag = categoryTag(alert.category);
          return (
            <motion.div
              key={alert.name}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="pointer-events-auto"
            >
              <div className="flex items-start gap-2 rounded border border-primary/40 bg-card/95 px-3 py-2 font-mono shadow-lg backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => handleOpen(alert.name)}
                  className="group flex flex-1 flex-col gap-1 text-left"
                  title="Show this trigger in the live board"
                >
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                      Live trigger
                    </span>
                    <span
                      className={`rounded border px-1 py-0 text-[9px] uppercase ${tag.className}`}
                    >
                      {tag.label}
                    </span>
                    {alert.alertLevel && (
                      <span className="ml-auto rounded border border-border bg-muted/20 px-1 py-0 text-[9px] text-muted-foreground">
                        {alert.alertLevel}
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-bold tracking-tight text-foreground group-hover:text-primary">
                    {formatName(alert.name)}
                  </div>
                  {alert.detail && (
                    <div className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                      {alert.detail}
                    </div>
                  )}
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
                    Research signal — not trading advice
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => dismissAlert(alert.name)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:bg-muted/40 hover:text-foreground"
                  title="Dismiss"
                  aria-label="Dismiss alert"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
