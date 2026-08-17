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
 *   DANGER on BG_ELEVATED       9.64:1  (6.97:1 on a DANGER_STRONG/20 wash)
 *   DANGER_SOFT on BG_ELEVATED 12.92:1
 *   DANGER_STRONG on BG_BASE    7.20:1  (BG_BASE text on it: 7.20:1)
 *   WARN on BG_ELEVATED        12.64:1  (10.4:1 on an EMBER/10 wash)
 *   OK on BG_ELEVATED          11.96:1  (8.16:1 on an OK_STRONG/20 wash)
 *   OK_STRONG on BG_BASE       10.08:1
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

/**
 * T-71 — the semantic tier: danger / warn / ok.
 *
 * These three meanings were carried by RAW Tailwind palette classes — the
 * rose, amber and emerald families, straight out of Tailwind's defaults —
 * across a dozen files. Same bug as T-56's `bg-pink-400` playhead: nothing
 * fails, nothing looks broken, and a retheme walks straight past every one
 * of them. The VALUES are deliberately the palette values that were already
 * on screen, so this migration is a rename, not a redesign.
 *
 * Two tiers, because both were in use and mean different things:
 *   DEFAULT   the readable TEXT tone on a dark surface
 *   _STRONG   the saturated MARK tone — meter bars, status dots, progress
 *             fills, borders and the /NN washes drawn under the text
 * `_SOFT` exists only for danger, where seven ghost buttons brighten their
 * label on hover; warn and ok have no such state, and a token nobody uses
 * is scaffolding.
 *
 * There is deliberately no `WARN_STRONG`: amber-400 IS `EMBER`, to the byte.
 * Every amber-400 surface in the app moved onto the ember token instead of
 * gaining a second name for one color — the DESIGN_GUIDE row for ember has
 * claimed "warnings" since round 19, and now the code agrees.
 */
/** Destructive actions, failures, clipping — text tone. */
export const DANGER = '#fda4af'
/** Danger text brightened for hover (ghost-button labels). */
export const DANGER_SOFT = '#fecdd3'
/** Danger as a mark: meter bars, status dots, error bars, borders, washes. */
export const DANGER_STRONG = '#fb7185'

/** Caution, "this needs setup", degraded-but-working — text tone. */
export const WARN = '#fcd34d'

/** Healthy, ready, passed — text tone. */
export const OK = '#6ee7b7'
/** Ok as a mark: meter bars, status dots, borders, washes. */
export const OK_STRONG = '#34d399'

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
