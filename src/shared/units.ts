/**
 * A frame rate for a person to read: "30 fps", "29.97 fps".
 *
 * ffprobe gives 30000/1001 as 29.97002997… and 30/1 as 30, and the player used
 * to print both with `toFixed(2)` — "30.00 fps" beside "30fps" elsewhere. A
 * whole rate drops its decimals; anything else keeps two. The unit is spaced,
 * as every unit is (docs/BRANDING_GUIDE.md, "Writing a label").
 */
export function formatFps(fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) return '30 fps'
  const rounded = Math.round(fps * 100) / 100
  return Number.isInteger(rounded) ? `${rounded} fps` : `${rounded.toFixed(2)} fps`
}

/**
 * A number and its unit as one readout, for the text a slider shows AND the value a screen reader is given (T-126 (12)).
 *
 * `${value} ${unit}` put a space in front of every unit, which is right for "300 ms" and "-30 dBFS" and wrong for a ratio: the
 * Ratio slider drew "8 :1" and read "8 :1" to a screen reader, beside a hint that says "8:1". A unit that begins with ":" is a
 * ratio's tail and joins the number without a space. ONE function, so the drawn readout and `aria-valuetext` cannot disagree.
 */
export function readoutText(value: number, unit: string): string {
  return unit.startsWith(':') ? `${value}${unit}` : `${value} ${unit}`
}
