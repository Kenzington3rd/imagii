/**
 * A time in a source video, as a person reads and types it (T-125 (23)).
 *
 * Eight panels each carried their own copy of `m:ss` (`Math.floor(seconds / 60)` with no upper bound), so a three-hour VOD's
 * playhead read "167:13.0" - minutes past 59 are not a clock anyone reads. `formatClock` is the one copy: `m:ss` below an hour
 * (unchanged, to the character), `h:mm:ss` from one hour up. `parseClock` is its other half, for a box a person types a time
 * into: the same forms back, plus plain seconds - what they typed from a stream's own timestamps ("2:47:13") is accepted
 * as it is written.
 */

/** How many digits of the second to keep: none ("1:05"), tenths ("1:05.2") or hundredths ("1:05.23"). Truncated, as the panels always did. */
export type ClockPlaces = 0 | 1 | 2

export function formatClock(seconds: number, places: ClockPlaces = 0): string {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0
  const whole = Math.floor(safe)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const frac = places === 0 ? '' : '.' + String(Math.floor((safe - whole) * 10 ** places)).padStart(places, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}${frac}` : `${m}:${ss}${frac}`
}

/**
 * A running timer ("REC 00:05", T-126 (4)): the same clock with the minutes padded below an hour, so a short take reads
 * "00:05" and the digits do not jump as it grows, and "1:00:00" from one hour up. Record's clock used to be its own
 * `mm:ss` with no upper bound ("REC 125:33" for a two-hour take).
 */
export function formatTimer(seconds: number): string {
  const clock = formatClock(seconds)
  return clock.split(':').length === 2 ? clock.padStart(5, '0') : clock
}

/** Seconds, or `h:mm:ss`, or `m:ss`, each with an optional fraction: "90", "1:30", ".5", "1:02:03.5". */
const CLOCK_TEXT = /^(?:(\d+):)?(?:(\d+):)?(\d*\.?\d*)$/

/**
 * The seconds a typed time means, or null for an empty box or text that is not a time. "90", "90.5", "1:30" (m:ss), "1:02:03"
 * (h:mm:ss) and "1:02:03.5" all read; "1:75" and "1:60:00" do not (a minute or second field of 60 or more beside a bigger unit
 * is a typo, not a time), and neither does a sign or any letter.
 */
export function parseClock(typed: string): number | null {
  const text = typed.trim()
  const match = CLOCK_TEXT.exec(text)
  if (!match) return null
  const [, first, second, last = ''] = match
  if (last === '' || last === '.' || !/\d/.test(last)) return null
  const seconds = Number(last)
  if (!Number.isFinite(seconds)) return null
  // One colon is minutes and seconds, two are hours, minutes and seconds.
  const parts = [first, second].filter((p): p is string => p !== undefined).map(Number)
  if (parts.length === 0) return seconds
  if (seconds >= 60) return null
  if (parts.length === 2 && (parts[1] as number) >= 60) return null
  const [a, b] = parts as [number, number | undefined]
  return b === undefined ? a * 60 + seconds : a * 3600 + b * 60 + seconds
}
