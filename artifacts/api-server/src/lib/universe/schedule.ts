// artifacts/api-server/src/lib/universe/schedule.ts
/** America/New_York wall-clock parts for a Date (DST-correct via Intl). */
function etParts(now: Date): { hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: Number(parts["hour"] === "24" ? "0" : parts["hour"]),
    minute: Number(parts["minute"]),
    weekday: days[parts["weekday"] as string] ?? 0,
  };
}

const isWeekday = (wd: number) => wd >= 1 && wd <= 5;

/** Nightly EOD rebuild window: weekdays 18:00–20:00 ET. */
export function isFullRebuildWindowET(now: Date): boolean {
  const { hour, weekday } = etParts(now);
  return isWeekday(weekday) && hour >= 18 && hour < 20;
}

/** Pre-open refresh window: weekdays 07:00–07:59 ET. */
export function isPreOpenWindowET(now: Date): boolean {
  const { hour, weekday } = etParts(now);
  return isWeekday(weekday) && hour === 7;
}
