/**
 * DST-correct America/New_York time helpers. The desk previously hardcoded
 * -04:00 (EDT) in several places, which is one hour wrong from early November
 * to mid-March (EST = -05:00). Every ET wall-clock conversion goes through
 * here now — never a hardcoded offset.
 */

const OFFSET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  timeZoneName: "longOffset",
});

/** ET UTC offset ("-04:00" or "-05:00") in effect on a calendar date. */
export function etOffset(date: string): string {
  // Noon UTC is unambiguously inside the given ET calendar date.
  const probe = new Date(`${date}T12:00:00Z`);
  const part = OFFSET_FMT.formatToParts(probe).find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  const m = /GMT([+-]\d{2}:\d{2})/.exec(part);
  return m ? m[1]! : "-05:00";
}

/** ET wall-clock date+time → correct-offset ISO string. */
export function etIso(date: string, time: string): string {
  return `${date}T${time}${etOffset(date)}`;
}

/** ET wall-clock date+time → epoch milliseconds. */
export function etEpochMs(date: string, time: string): number {
  return Date.parse(etIso(date, time));
}
