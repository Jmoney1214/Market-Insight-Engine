import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Tone, toneText } from "@/lib/finance";

export function ReportSection({
  id,
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  id?: string;
  title: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-[120px]", className)}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-bold tracking-wider uppercase text-foreground/90">{title}</h2>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function MetricTile({
  label,
  value,
  sub,
  tone = "muted",
  subTone,
  className,
  testId,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  subTone?: Tone;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn("rounded-md border border-border bg-background/40 p-3", className)} data-testid={testId}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}</p>
      <p className={cn("text-lg font-bold font-mono-numbers leading-none", tone !== "muted" ? toneText[tone] : "text-foreground")}>
        {value}
      </p>
      {sub != null ? (
        <p className={cn("text-xs font-mono-numbers mt-1.5", subTone && subTone !== "muted" ? toneText[subTone] : "text-muted-foreground")}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground font-medium truncate">{value}</span>
    </div>
  );
}
