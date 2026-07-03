// Shared presentation helpers for the edge-validation status enum so the
// Strategy Lab, Edge Scoreboard, and Live Board render it identically.

export function validationStatusLabel(status: string): string {
  // The out-of-sample bucket is fed by REPLAY-mode samples, so surface it as
  // "REPLAY" in the UI — never the word "paper" (no paper-trading, by design).
  switch (status) {
    case "paper_validated":
      return "REPLAY-VALIDATED";
    case "paper_pending":
      return "REPLAY-PENDING";
    default:
      return status.replace(/_/g, " ").toUpperCase();
  }
}

export function validationStatusClass(status: string): string {
  switch (status) {
    case "paper_validated":
      return "border-success/40 text-success bg-success/10";
    case "backtested_pending_forward":
    case "backtested_only":
      return "border-primary/40 text-primary bg-primary/10";
    case "paper_pending":
      return "border-warning/40 text-warning bg-warning/10";
    case "no_edge":
      return "border-destructive/40 text-destructive bg-destructive/10";
    case "insufficient_sample":
    case "unproven":
    default:
      return "border-border text-muted-foreground bg-muted/20";
  }
}
