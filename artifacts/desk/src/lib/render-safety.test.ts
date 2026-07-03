// Render-layer safety test (spec §21 item 32): the analyst text the dashboard
// actually renders must pass the forbidden-language scanner. This runs the real
// deterministic committee over every fixture and pushes the dashboard read plus
// every agent string through the exact render-safe helpers the UI uses
// (safeText / safeList), asserting nothing forbidden survives and that the
// recommendation is always one of the approved enums.

import { describe, it, expect } from "vitest";
import {
  buildCopilotEvent,
  getFixture,
  listFixtures,
  type CopilotEvent,
} from "@workspace/copilot-core";
import { runCommittee } from "@workspace/copilot-committee";
import { APPROVED_RECOMMENDATIONS } from "@workspace/copilot-committee/vocab";
import { safeText, safeList, hasForbiddenLanguage } from "./safety";

function eventFor(symbol: string): CopilotEvent {
  const f = getFixture(symbol);
  if (!f) throw new Error(`missing fixture ${symbol}`);
  return buildCopilotEvent({
    symbol: f.symbol,
    mode: f.mode,
    dataSource: f.dataSource,
    bars: f.bars,
    quote: f.quote,
    nowMs: f.nowMs,
  });
}

describe("dashboard render-safety over real committee output (item 32)", () => {
  for (const symbol of listFixtures()) {
    it(`${symbol}: rendered analyst text is forbidden-free and uses approved enums`, async () => {
      const result = await runCommittee(eventFor(symbol));

      // The recommendation can only ever be an approved enum value.
      expect(APPROVED_RECOMMENDATIONS as readonly string[]).toContain(
        result.dashboardRead.recommendation,
      );

      // Exactly the strings the dashboard renders, passed through the same
      // render-safe layer the UI components use before display.
      const dash = result.dashboardRead;
      const rawStrings: string[] = [
        dash.oneSentenceRead,
        ...dash.riskNotes,
        ...result.agents.flatMap((a) => [
          a.headline,
          ...a.supportingFactors,
          ...a.warnings,
        ]),
      ];

      for (const raw of rawStrings) {
        // The committee output is already clean, so the render-safe layer must
        // not have to redact anything (text passes through unchanged) and the
        // scanner must report no forbidden language.
        expect(safeText(raw)).toBe(raw);
        expect(hasForbiddenLanguage(raw)).toBe(false);
      }

      // safeList over the array fields must likewise leave clean prose intact.
      expect(safeList(dash.riskNotes)).toEqual(dash.riskNotes);
    });
  }
});
