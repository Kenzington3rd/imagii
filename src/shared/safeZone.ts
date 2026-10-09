import { assert } from './assert'
import type { CropRect } from './clip'

/**
 * Phase 3.4: pure geometry helpers shared between SafeZoneOverlay (renderer
 * preview) and the export-time pre-flight modal. Keeping this in src/shared
 * means tests can import without pulling React.
 */

/** A rectangle inside a frame, in that frame's own pixel space — source
 *  pixels for a crop, CSS pixels for the on-screen picture rect (T-39). */
export interface CropBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Compute the centered crop rectangle that produces the given target aspect
 * ratio inside a source frame. If source is wider than target, crops left/right;
 * if narrower, crops top/bottom.
 *
 * This is also the `object-fit: contain` fit, which is the same geometry read
 * the other way round: the centered rect of a given aspect inside a frame.
 * Player's `useVideoContentRect` uses it to find where a <video> element is
 * actually painting its picture inside its own box (T-39).
 */
export function computeCropBox(
  sourceW: number,
  sourceH: number,
  targetAspect: number
): CropBox {
  assert(sourceW > 0 && sourceH > 0, 'sourceW/H must be positive')
  assert(Number.isFinite(targetAspect) && targetAspect > 0, 'targetAspect must be positive finite')
  const sourceAspect = sourceW / sourceH
  let cropW: number
  let cropH: number
  if (sourceAspect > targetAspect) {
    cropH = sourceH
    cropW = cropH * targetAspect
  } else {
    cropW = sourceW
    cropH = cropW / targetAspect
  }
  const x = (sourceW - cropW) / 2
  const y = (sourceH - cropH) / 2
  return { x, y, w: cropW, h: cropH }
}

/**
 * The frame an export STARTS from (T-83): the whole source, or — when the
 * user drew a manual crop — that crop's rectangle in source pixels.
 *
 * The export pipeline treats a manual crop as the new source frame and cuts
 * each platform's shape out of it (`buildVideoFilter`), so every question the
 * UI asks about a platform's fit — the grid's indicator, the safe-zone
 * pre-flight, the output preview — is a question about THIS frame, not about
 * the file on disk. `crop` is the stored rect (fractions of the source). A
 * rect that is not a usable size (NaN from a hand-edited project) is treated
 * as no crop, since the renderer must not throw while drawing; main clamps the
 * same rect to a 2-px minimum, which is a different failure for a different
 * file.
 */
export function cropFrameSize(
  sourceW: number,
  sourceH: number,
  crop: { w: number; h: number } | null | undefined
): { w: number; h: number } {
  assert(sourceW > 0 && sourceH > 0, 'sourceW/H must be positive')
  if (!crop) return { w: sourceW, h: sourceH }
  const w = Math.max(2, crop.w * sourceW)
  const h = Math.max(2, crop.h * sourceH)
  if (!Number.isFinite(w) || !Number.isFinite(h)) return { w: sourceW, h: sourceH }
  return { w, h }
}

/**
 * The part of the source that ends up in an output of shape `aspect` (T-83),
 * in source pixels: the manual crop's rectangle (or the whole frame when there
 * is none) with the centered cut to `aspect` taken out of it. The same two
 * steps `buildVideoFilter` runs — crop, then cut to the platform's shape —
 * without its even-pixel rounding, since the only reader is a preview canvas.
 */
export function outputSourceRect(
  sourceW: number,
  sourceH: number,
  crop: CropRect | null | undefined,
  aspect: number
): CropBox {
  const frame = cropFrameSize(sourceW, sourceH, crop)
  const offsetX = crop ? crop.x * sourceW : 0
  const offsetY = crop ? crop.y * sourceH : 0
  const fx = Number.isFinite(offsetX) ? Math.max(0, offsetX) : 0
  const fy = Number.isFinite(offsetY) ? Math.max(0, offsetY) : 0
  const cut = computeCropBox(frame.w, frame.h, aspect)
  return { x: fx + cut.x, y: fy + cut.y, w: cut.w, h: cut.h }
}

/**
 * True iff the rectangle `inner` is fully contained within rectangle `outer`.
 * Used to detect when a user's chosen crop would clip another platform's
 * required safe zone — if the platform's centered safe-zone rect is NOT
 * contained in the user's crop, that platform would lose subject framing.
 */
export function rectContains(outer: CropBox, inner: CropBox): boolean {
  // Tolerance accounts for floating-point: 0.5 px of slop on each side.
  const eps = 0.5
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  )
}

/**
 * Given the user's chosen crop and a list of additional platform aspect
 * ratios they're also exporting, return the labels that would be clipped —
 * i.e. the platform's centered safe-zone rect doesn't fit inside the crop.
 */
export function findClippedSafeZones(
  sourceW: number,
  sourceH: number,
  userCrop: CropBox,
  otherTargetRatios: ReadonlyArray<{ label: string; aspect: number }>
): string[] {
  assert(otherTargetRatios.length < 100, 'aspect list too long')
  const clipped: string[] = []
  for (const target of otherTargetRatios) {
    const safeZone = computeCropBox(sourceW, sourceH, target.aspect)
    if (!rectContains(userCrop, safeZone)) {
      clipped.push(target.label)
    }
  }
  return clipped
}
