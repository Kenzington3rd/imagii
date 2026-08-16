import { assert } from './assert'

/**
 * Compute an appropriate initial window size given the user's primary
 * display work-area (the screen minus taskbar/dock).
 *
 * Goals:
 *   - Always fit on the user's actual display — never request a window
 *     bigger than the work area.
 *   - On small displays (1080p and below) keep the prior 1280x800
 *     default so the open experience matches what existing users see.
 *   - On larger displays scale up so the studios get room to breathe:
 *     panels stay readable, the canvas area gets more room.
 *   - Cap at a sane maximum so a 5K/6K ultrawide doesn't get a
 *     comically large window.
 *
 * Pure function — no Electron imports, no DOM. Designed to be unit-tested
 * with synthetic widths/heights covering 1080p, 2K, and 4K.
 *
 * Power of Ten compliance: ≤60 lines, 2 assertions, no loops, no recursion.
 */
export interface WindowSize {
  width: number
  height: number
}

// Floor on the requested window size. Anything smaller than this and we
// just clamp to the work area as-is — there's no margin to give back.
const MIN_REQUESTED_WIDTH = 1280
const MIN_REQUESTED_HEIGHT = 800

// Ceiling for the auto-sized window. On very large displays we cap
// growth so the window doesn't span the whole screen by default. Users
// who want full-screen can maximize.
const MAX_REQUESTED_WIDTH = 2400
const MAX_REQUESTED_HEIGHT = 1500

// Fraction of the work-area we aim to occupy by default. 0.85 leaves a
// visible frame of desktop on each side so the user can still grab
// other windows.
const TARGET_FRACTION = 0.85

export function computeInitialWindowSize(
  workAreaWidth: number,
  workAreaHeight: number
): WindowSize {
  assert(
    Number.isFinite(workAreaWidth) && workAreaWidth > 0,
    'workAreaWidth must be a positive finite number'
  )
  assert(
    Number.isFinite(workAreaHeight) && workAreaHeight > 0,
    'workAreaHeight must be a positive finite number'
  )

  // Aim for TARGET_FRACTION of work area, then clamp into [MIN, MAX]
  // and also clamp to the work area itself so we never request more
  // pixels than the display actually has.
  const desiredW = Math.round(workAreaWidth * TARGET_FRACTION)
  const desiredH = Math.round(workAreaHeight * TARGET_FRACTION)
  const width = Math.min(
    workAreaWidth,
    Math.max(MIN_REQUESTED_WIDTH, Math.min(MAX_REQUESTED_WIDTH, desiredW))
  )
  const height = Math.min(
    workAreaHeight,
    Math.max(MIN_REQUESTED_HEIGHT, Math.min(MAX_REQUESTED_HEIGHT, desiredH))
  )
  return { width, height }
}

/**
 * T-47 — remembering the window's size and position across launches.
 *
 * Hand-rolled rather than pulled in as a dependency: the whole policy is
 * the thirty lines below, and a local-first app should not ship a package
 * for it (see the ladder in CLAUDE.md). Pure, so the interesting cases —
 * the monitor that is no longer plugged in above all — are unit tests
 * rather than something only a second display could reproduce.
 */

/** A rectangle in Electron's screen coordinates (a display's workArea). */
export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

/** What main stored at the end of the last session. */
export interface StoredWindowBounds extends ScreenRect {
  maximized: boolean
}

/** What to hand BrowserWindow. `x`/`y` absent means "let Electron center it". */
export interface ResolvedWindowBounds {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

/** Electron's own floor for the app window, mirrored from main/index.ts. */
export const MIN_WINDOW_WIDTH = 1024
export const MIN_WINDOW_HEIGHT = 640

/**
 * How much of the window has to land on a real display for the stored
 * position to be reusable. A window is grabbable as long as a chunk of its
 * title bar is on screen; less than this and it is effectively lost, which
 * is exactly what happens to bounds saved on a monitor that has since been
 * unplugged.
 */
const MIN_VISIBLE_WIDTH = 120
const MIN_VISIBLE_HEIGHT = 40

export function isStoredWindowBounds(value: unknown): value is StoredWindowBounds {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const finite = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n)
  return (
    finite(v.x) &&
    finite(v.y) &&
    finite(v.width) &&
    finite(v.height) &&
    (v.width as number) > 0 &&
    (v.height as number) > 0 &&
    typeof v.maximized === 'boolean'
  )
}

/** Overlap of two rectangles, in pixels. */
function overlap(a: ScreenRect, b: ScreenRect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  }
}

function isOnSomeDisplay(rect: ScreenRect, workAreas: readonly ScreenRect[]): boolean {
  for (const area of workAreas) {
    const o = overlap(rect, area)
    if (o.width >= MIN_VISIBLE_WIDTH && o.height >= MIN_VISIBLE_HEIGHT) return true
  }
  return false
}

/**
 * Turn whatever is on disk into bounds that are safe to open.
 *
 * - Nothing stored, or stored garbage: the auto-sized default, centered.
 * - Stored bounds whose visible area lands on a connected display: reused
 *   as-is, clamped to the app's minimum and to that primary work area.
 * - Stored bounds that land nowhere (the display was unplugged, the layout
 *   changed, a negative-coordinate monitor went away): the SIZE is kept —
 *   it is still the size the user chose — and the position is dropped so
 *   Electron centers the window on the primary display.
 *
 * `maximized` rides along either way, and the size returned is always the
 * NORMAL (restored) size, so un-maximizing lands back where the user had
 * the window rather than at a default.
 */
export function resolveWindowBounds(
  stored: unknown,
  workAreas: readonly ScreenRect[],
  primaryWorkArea: ScreenRect
): ResolvedWindowBounds {
  assert(
    Number.isFinite(primaryWorkArea.width) && primaryWorkArea.width > 0,
    'primaryWorkArea.width must be a positive finite number'
  )
  assert(Array.isArray(workAreas), 'workAreas must be an array')

  const fallback = computeInitialWindowSize(primaryWorkArea.width, primaryWorkArea.height)
  if (!isStoredWindowBounds(stored)) {
    return { width: fallback.width, height: fallback.height, maximized: false }
  }
  const width = Math.round(
    Math.min(primaryWorkArea.width, Math.max(MIN_WINDOW_WIDTH, stored.width))
  )
  const height = Math.round(
    Math.min(primaryWorkArea.height, Math.max(MIN_WINDOW_HEIGHT, stored.height))
  )
  const candidate: ScreenRect = { x: stored.x, y: stored.y, width, height }
  if (!isOnSomeDisplay(candidate, workAreas)) {
    return { width, height, maximized: stored.maximized }
  }
  return {
    width,
    height,
    x: Math.round(stored.x),
    y: Math.round(stored.y),
    maximized: stored.maximized
  }
}
