import { useEffect, useRef } from "react";
import type { CopilotEvent } from "@workspace/api-client-react";
import { deriveTriggerAlerts, eventAlertSignature } from "@/lib/trigger-alerts";
import { useTriggerAlertStore } from "@/hooks/use-trigger-alert-store";

// Orchestrates the live trigger banner. Tracks the previous event for the
// active stream and pushes alerts on a deterministic false -> true transition.
//
// `streamKey` identifies the logical stream (symbol + mode + date/source) but
// intentionally EXCLUDES the replay step, so stepping through bars diffs against
// the prior bar rather than resetting. Changing symbol/mode/date/source resets
// the baseline (no carry-over diff) and clears any pending banners.

export function useTriggerAlerts(
  event: CopilotEvent | null | undefined,
  streamKey: string,
): void {
  const pushAlerts = useTriggerAlertStore((s) => s.pushAlerts);
  const clearAlerts = useTriggerAlertStore((s) => s.clearAlerts);
  const focusTrigger = useTriggerAlertStore((s) => s.focusTrigger);

  const prevEventRef = useRef<CopilotEvent | null>(null);
  const streamKeyRef = useRef<string | null>(null);
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    // Stream changed: reset baseline and clear stale UI state.
    if (streamKeyRef.current !== streamKey) {
      streamKeyRef.current = streamKey;
      prevEventRef.current = null;
      lastSignatureRef.current = null;
      clearAlerts();
      focusTrigger(null);
    }

    if (!event) return;
    // Guard against reprocessing identical polls (refetch identity churn or a
    // re-render with unchanged data). The signature keys off content
    // (eventId + the detected-state vector) rather than eventId alone, so an
    // intrabar false -> true flip — which shares the same eventId during a live
    // polling bar — is processed promptly instead of waiting for the bar close.
    const signature = eventAlertSignature(event);
    if (lastSignatureRef.current === signature) return;

    const alerts = deriveTriggerAlerts(prevEventRef.current, event);
    if (alerts.length > 0) pushAlerts(alerts);

    prevEventRef.current = event;
    lastSignatureRef.current = signature;
  }, [event, streamKey, pushAlerts, clearAlerts, focusTrigger]);
}
