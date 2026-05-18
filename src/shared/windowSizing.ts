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
