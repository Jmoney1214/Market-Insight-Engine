// Date/session utilities — dependency-free, DST-correct via Intl.
// The harness's session template is fixed: pre-market 04:00, scan cutoff
// 08:30, RTH 09:30-16:00, flatten 15:50, extended close 20:00 (all ET).

const NY = "America/New_York";

/** UTC offset string ("-04:00" | "-05:00") in effect in New York on `day` at noon. */
export function etOffset(day) {
  const probe = new Date(`${day}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY, timeZoneName: "longOffset",
  }).formatToParts(probe);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  const m = tz.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "-05:00";
}

/** RFC3339 fetch window for `day` between two ET wall-clock times ("HH:MM"). */
export function etWindow(day, hmStart, hmEnd) {
  const off = etOffset(day);
  return { start: `${day}T${hmStart}:00${off}`, end: `${day}T${hmEnd}:00${off}` };
}

/** ET "HH:MM" for an ISO timestamp. */
export function etHm(iso) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: NY, hour12: false, hour: "2-digit", minute: "2-digit",
  }).slice(0, 5);
}

/** Weekdays (Mon-Fri) between from and to, inclusive. Holidays fall out naturally
 * downstream: a day with no RTH bars is reported as "no-session" and skipped. */
export function tradingDays(from, to) {
  const days = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime()) || d > end)
    throw new Error(`invalid date range ${from}..${to}`);
  while (d <= end) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

/** ISO date `n` calendar days before `day` — used for warm-up lookback. */
export function daysBefore(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** CLI parsing: --from YYYY-MM-DD --to YYYY-MM-DD [--report] [--html] [--fill mode] */
export function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const from = get("--from"), to = get("--to") ?? from;
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    throw new Error("usage: node pipeline.mjs --from YYYY-MM-DD [--to YYYY-MM-DD] [--report] [--html] [--fill stop_first|target_first|tv_ohlc_path]");
  const fill = get("--fill") ?? "stop_first";
  if (!["stop_first", "target_first", "tv_ohlc_path"].includes(fill))
    throw new Error(`unknown fill mode: ${fill}`);
  return { from, to, report: argv.includes("--report"), html: argv.includes("--html"), fill };
}
