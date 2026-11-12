/**
 * T-117 - run the app on a clock whose calendar day is never the UTC day.
 *
 * The Clip Kit folder (`<name>-kit-<date>`, main) and Record's default file name (renderer) were stamped
 * from `toISOString()`, which is UTC, while the export panel's {date} was local: an evening streamer in
 * Pacific time got a kit dated tomorrow. A machine in UTC cannot tell the two apart, and a CI box usually
 * is one, so the specs that name the stamp put the process on a zone where the local day differs from the
 * UTC day at the moment they start: UTC+14 once it is 10:00 UTC or later, UTC-12 before that (the day is
 * different for at least 12 hours of every 24 in each). The app is launched with `...process.env`, so
 * main and the renderer inherit the zone, and the test's own `Date` reads it too.
 *
 * `localDay()` is the oracle: written out from the `Date` getters, not from the app's own helper.
 */

/** Set the process zone to a skewed one; call the returned function to put it back. */
export function skewTimeZone(): () => void {
  const was = process.env.TZ
  process.env.TZ = new Date().getUTCHours() >= 10 ? 'Etc/GMT-14' : 'Etc/GMT+12'
  return () => {
    if (was === undefined) delete process.env.TZ
    else process.env.TZ = was
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `YYYY-MM-DD` on the process clock (local). */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** `YYYY-MM-DD` in UTC, which is what the stamp used to be. */
export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10)
}
