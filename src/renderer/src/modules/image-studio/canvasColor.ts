import { resolveOverlayColor } from '@shared/overlayColors'

/**
 * What Properties says when a Fill, Stroke or Color box holds something the canvas cannot draw (T-186 (1)). The overlay Color box's refusal (`OVERLAY_COLOR_REFUSAL`) in the
 * same voice, plus the one form this box takes that the overlay's does not: `transparent` is how a shape has no fill.
 */
export const CANVAS_COLOR_REFUSAL = "imagii doesn't know that color. Use a name like white, a code like #ffcc00, or transparent."

/** CSS-wide keywords and `var()` pass `CSS.supports('color', ...)` but are not a colour to a canvas (its `fillStyle` ignores them, and the shape is drawn black). */
const NOT_A_COLOR = /^(inherit|initial|unset|revert|revert-layer)$|var\(/i

/**
 * The colour a Fill, Stroke or Color box would store for `typed`, or `null` when the canvas cannot draw it. The overlay resolver goes first (a CSS name in any case,
 * `#rrggbb` or `rrggbb`, `#rgb`, each as the `#rrggbb` the overlay gates take); then the trimmed text as typed, when `supports` accepts it (the canvas's other colours:
 * `rgba()` / `rgb()` / `hsl()`, `#rgba`, `#rrggbbaa`, `transparent`, and the `rgba(...)` fills every template carries). `supports` is injected so this is pure:
 * the renderer passes `(v) => CSS.supports('color', v)`. A canvas ignores an unparseable `fillStyle` and keeps the context's black, so an empty or unknown text is `null`.
 */
export function resolveCanvasColor(typed: string, supports: (css: string) => boolean): string | null {
  const overlay = resolveOverlayColor(typed)
  if (overlay !== null) return overlay
  const text = typed.trim()
  if (text === '' || NOT_A_COLOR.test(text)) return null
  return supports(text) ? text : null
}
