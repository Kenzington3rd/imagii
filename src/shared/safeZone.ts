import { assert } from './assert'

/**
 * Phase 3.4: pure geometry helpers shared between SafeZoneOverlay (renderer
 * preview) and the export-time pre-flight modal. Keeping this in src/shared
 * means tests can import without pulling React.
 */

export interface CropBox {
  /** x position of crop in source pixels. */
  x: number
  /** y position of crop in source pixels. */
  y: number
  /** width of crop in source pixels. */
  w: number
  /** height of crop in source pixels. */
  h: number
}

/**
 * Compute the centered crop rectangle that produces the given target aspect
 * ratio inside a source frame. If source is wider than target, crops left/right;
 * if narrower, crops top/bottom.
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
