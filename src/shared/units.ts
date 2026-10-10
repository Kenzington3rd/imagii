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
