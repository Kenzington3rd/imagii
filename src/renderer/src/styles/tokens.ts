/**
 * Round 19: the obsidian-volcano palette, as JS constants.
 *
 * Single source of truth for every context that cannot take a Tailwind
 * className — Konva strokes, wavesurfer options, inline SVG, toaster
 * styling, checkerboard gradients. `tailwind.config.js` mirrors these
 * values (it cannot import TS); `tests/unit/designTokensInSync.test.ts`
 * pins the two against each other so they cannot drift.
 *
 * Contrast (WCAG AA needs 4.5:1 for body text):
 *   ACCENT on BG_BASE            5.29:1  (4.55:1 even on BG_HOVER)
 *   BG_BASE text on ACCENT       5.29:1  (filled buttons; 4.90:1 on
 *                                         ACCENT_MUTED hover fills)
 *   INK_BASE on BG_BASE         15.5:1
 *   INK_MUTED on BG_BASE         7.1:1
 *   INK_DIM on BG_BASE           6.2:1  (5.8:1 on BG_ELEVATED)
 *   EMBER on BG_BASE            11.6:1  (9.99:1 on BG_HOVER — the Timeline
 *                                        track the playhead is drawn on)
 */

import { assert } from '@shared/assert'

/** App background — obsidian black, warm undertone. */
export const BG_BASE = '#120c0c'
/** Cards, panels, modals. */
export const BG_ELEVATED = '#1c1313'
/** Hover state for interactive surfaces. */
export const BG_HOVER = '#2a1a18'

/** Primary actions, focus rings, active states — neon magma red. */
export const ACCENT = '#ff3131'
/** Hover/pressed state of accent elements — deeper red. */
export const ACCENT_MUTED = '#f52e2e'

/** Primary text — warm off-white. */
export const INK_BASE = '#ece4e2'
/** Secondary text, labels. */
export const INK_MUTED = '#a59a97'
/** Tertiary text, borders, disabled. */
export const INK_DIM = '#9c8f8b'

/**
 * Ember highlight — warnings, the icon's sun, hype moments, and the
 * PLAYHEAD in both timed studios: wavesurfer's cursor in Audio, the
 * Timeline marker in Video (T-56). One meaning, one color — and it is the
 * one thing on the track that must stay readable over an accent clip range
 * (9.99:1 on BG_HOVER, 7.35:1 on the range's `accent/25` fill).
 */
export const EMBER = '#fbbf24'

/** Checkerboard tiles for transparent-image previews (two warm darks). */
export const CHECKER_A = '#221616'
export const CHECKER_B = '#1c1313'

/**
 * A token at partial alpha, for the JS contexts that need a translucent
 * FILL rather than a solid — wavesurfer region colors, which take one CSS
 * color string and have no separate opacity option.
 *
 * The alternative is a hand-copied `rgba(255, 49, 49, 0.25)` literal, and
 * WaveformView carried two of them (one of which was rose-500, a palette
 * color that was never in this file at all) two lines under its `tokens`
 * import until T-56. A literal cannot follow a retheme; this can.
 */
export function withAlpha(hex: string, alpha: number): string {
  assert(/^#[0-9a-fA-F]{6}$/.test(hex), `withAlpha expects #rrggbb, got ${hex}`)
  assert(alpha >= 0 && alpha <= 1, `withAlpha expects an alpha in 0..1, got ${alpha}`)
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
