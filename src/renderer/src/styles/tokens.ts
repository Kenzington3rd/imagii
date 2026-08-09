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
 *   ACCENT on BG_BASE            5.57:1  (4.79:1 even on BG_HOVER)
 *   BG_BASE text on ACCENT       5.57:1  (filled buttons; 4.87:1 on
 *                                         ACCENT_MUTED hover fills)
 *   INK_BASE on BG_BASE         15.5:1
 *   INK_MUTED on BG_BASE         7.1:1
 *   INK_DIM on BG_BASE           6.2:1  (5.8:1 on BG_ELEVATED)
 *   EMBER on BG_BASE            11.6:1
 */

/** App background — obsidian black, warm undertone. */
export const BG_BASE = '#120c0c'
/** Cards, panels, modals. */
export const BG_ELEVATED = '#1c1313'
/** Hover state for interactive surfaces. */
export const BG_HOVER = '#2a1a18'

/** Primary actions, focus rings, active states — molten-core red. */
export const ACCENT = '#f25050'
/** Hover/pressed state of accent elements — deeper red. */
export const ACCENT_MUTED = '#e04b4b'

/** Primary text — warm off-white. */
export const INK_BASE = '#ece4e2'
/** Secondary text, labels. */
export const INK_MUTED = '#a59a97'
/** Tertiary text, borders, disabled. */
export const INK_DIM = '#9c8f8b'

/** Ember highlight — warnings, the icon's sun, hype moments. */
export const EMBER = '#fbbf24'

/** Checkerboard tiles for transparent-image previews (two warm darks). */
export const CHECKER_A = '#221616'
export const CHECKER_B = '#1c1313'
