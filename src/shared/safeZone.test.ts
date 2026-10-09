import { describe, it, expect } from 'vitest'
import {
  computeCropBox,
  cropFrameSize,
  findClippedSafeZones,
  outputSourceRect,
  rectContains
} from './safeZone'

describe('computeCropBox', () => {
  it('crops left/right when source is wider than target', () => {
    // 1920x1080 source → 9:16 target should produce a centered 607.5x1080 box.
    const box = computeCropBox(1920, 1080, 9 / 16)
    expect(box.h).toBe(1080)
    expect(box.w).toBeCloseTo(607.5, 1)
    expect(box.y).toBe(0)
    expect(box.x).toBeCloseTo((1920 - 607.5) / 2, 1)
  })

  it('crops top/bottom when source is narrower than target', () => {
    // 1080x1920 source → 16:9 target → 1080x607.5 centered.
    const box = computeCropBox(1080, 1920, 16 / 9)
    expect(box.w).toBe(1080)
    expect(box.h).toBeCloseTo(607.5, 1)
    expect(box.x).toBe(0)
  })

  it('returns the full frame when source aspect == target aspect', () => {
    const box = computeCropBox(1080, 1080, 1)
    expect(box.x).toBe(0)
    expect(box.y).toBe(0)
    expect(box.w).toBe(1080)
    expect(box.h).toBe(1080)
  })

  it('throws on invalid input', () => {
    expect(() => computeCropBox(0, 1080, 1)).toThrow()
    expect(() => computeCropBox(1080, 0, 1)).toThrow()
    expect(() => computeCropBox(1080, 1080, 0)).toThrow()
    expect(() => computeCropBox(1080, 1080, NaN)).toThrow()
  })
})

describe('computeCropBox as the object-fit: contain fit (T-39)', () => {
  // Player's useVideoContentRect asks this function where a <video> is
  // actually painting inside its own box: the arguments are the ELEMENT's box
  // and the MEDIA's intrinsic aspect, and the answer is the letterboxed
  // picture. Same geometry, read the other way round — these cases pin the
  // reading the overlays depend on.

  it('pillarboxes a 4:3 picture in a 16:9 element box', () => {
    const picture = computeCropBox(1600, 900, 4 / 3)
    expect(picture.h).toBe(900)
    expect(picture.w).toBeCloseTo(1200, 6)
    expect(picture.x).toBeCloseTo(200, 6)
    expect(picture.y).toBe(0)
  })

  it('letterboxes a 16:9 picture in a 4:3 element box', () => {
    const picture = computeCropBox(800, 600, 16 / 9)
    expect(picture.w).toBe(800)
    expect(picture.h).toBeCloseTo(450, 6)
    expect(picture.x).toBe(0)
    expect(picture.y).toBeCloseTo(75, 6)
  })

  it('fills the box exactly when the element already carries the media aspect', () => {
    // The shipped player's own case: `max-h-[60vh] w-auto` keeps the element
    // on the media's aspect, so the picture IS the element box and the
    // overlays must not inset themselves at all.
    const picture = computeCropBox(320, 240, 320 / 240)
    expect(picture).toEqual({ x: 0, y: 0, w: 320, h: 240 })
  })

  it('never reports a picture larger than the box it fits into', () => {
    for (const [boxW, boxH, aspect] of [
      [640, 480, 21 / 9],
      [640, 480, 9 / 21],
      [1000, 1000, 1],
      [1, 10_000, 4 / 3]
    ] as Array<[number, number, number]>) {
      const picture = computeCropBox(boxW, boxH, aspect)
      expect(picture.w).toBeLessThanOrEqual(boxW + 1e-9)
      expect(picture.h).toBeLessThanOrEqual(boxH + 1e-9)
      expect(picture.x).toBeGreaterThanOrEqual(0)
      expect(picture.y).toBeGreaterThanOrEqual(0)
      // Centered: the inset is the same on both sides.
      expect(picture.x * 2 + picture.w).toBeCloseTo(boxW, 6)
      expect(picture.y * 2 + picture.h).toBeCloseTo(boxH, 6)
    }
  })
})

describe('rectContains', () => {
  it('returns true when inner is inside outer', () => {
    expect(
      rectContains({ x: 0, y: 0, w: 100, h: 100 }, { x: 10, y: 10, w: 80, h: 80 })
    ).toBe(true)
  })

  it('returns true when inner equals outer (tolerant of fp slop)', () => {
    expect(
      rectContains({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 100 })
    ).toBe(true)
  })

  it('returns false when inner extends past outer on any side', () => {
    expect(
      rectContains({ x: 10, y: 10, w: 80, h: 80 }, { x: 0, y: 0, w: 100, h: 100 })
    ).toBe(false)
  })
})

describe('findClippedSafeZones', () => {
  it('returns empty list when user crop is the full source', () => {
    const fullCrop = { x: 0, y: 0, w: 1920, h: 1080 }
    const clipped = findClippedSafeZones(1920, 1080, fullCrop, [
      { label: '9:16 (Reels)', aspect: 9 / 16 },
      { label: '1:1 (Square)', aspect: 1 }
    ])
    expect(clipped).toEqual([])
  })

  it('flags platforms whose safe zone is wider than the user crop', () => {
    // Source 1920x1080. User cropped to a tight 9:16 (607.5 wide). 16:9 safe
    // zone needs the full 1920 width — that won't fit inside 607.5, so 16:9
    // gets flagged.
    const userCrop = computeCropBox(1920, 1080, 9 / 16)
    const clipped = findClippedSafeZones(1920, 1080, userCrop, [
      { label: '16:9 (YouTube)', aspect: 16 / 9 },
      { label: '1:1 (Square)', aspect: 1 }
    ])
    expect(clipped).toContain('16:9 (YouTube)')
    expect(clipped).toContain('1:1 (Square)') // 1:1 = 1080x1080 is also wider
  })

  it('does not flag platforms whose safe zone fits inside the user crop', () => {
    // User crops to full 16:9 of a 1920x1080 source — same aspect, full frame.
    // 9:16 safe zone (607.5x1080) fits comfortably.
    const userCrop = computeCropBox(1920, 1080, 16 / 9)
    const clipped = findClippedSafeZones(1920, 1080, userCrop, [
      { label: '9:16 (Reels)', aspect: 9 / 16 }
    ])
    expect(clipped).toEqual([])
  })
})

describe('cropFrameSize — the frame an export starts from (T-83)', () => {
  it('is the whole source when there is no manual crop', () => {
    expect(cropFrameSize(1920, 1080, null)).toEqual({ w: 1920, h: 1080 })
    expect(cropFrameSize(1920, 1080, undefined)).toEqual({ w: 1920, h: 1080 })
  })

  it("is the crop's rectangle in source pixels when there is one", () => {
    // A 9:16 strip of a 16:9 source: 0.28125 x 0.8889 of 1920x1080.
    const frame = cropFrameSize(1920, 1080, { w: 0.28125, h: 0.888888888888 })
    expect(frame.w).toBeCloseTo(540, 3)
    expect(frame.h).toBeCloseTo(960, 3)
    expect(frame.w / frame.h).toBeCloseTo(9 / 16, 4)
  })

  it('a full-frame rect is the source', () => {
    expect(cropFrameSize(1280, 720, { w: 1, h: 1 })).toEqual({ w: 1280, h: 720 })
  })

  it('mirrors main: a degenerate rect is held to the 2 px minimum', () => {
    expect(cropFrameSize(1920, 1080, { w: 0, h: 0 })).toEqual({ w: 2, h: 2 })
  })

  it('a rect that is not a number is no crop at all (the renderer must not throw while drawing)', () => {
    expect(cropFrameSize(1920, 1080, { w: NaN, h: 0.5 })).toEqual({ w: 1920, h: 1080 })
    expect(cropFrameSize(1920, 1080, { w: 0.5, h: Infinity })).toEqual({ w: 1920, h: 1080 })
  })

  it('throws on a source with no size', () => {
    expect(() => cropFrameSize(0, 1080, null)).toThrow()
    expect(() => cropFrameSize(1920, 0, { w: 0.5, h: 0.5 })).toThrow()
  })
})

describe('outputSourceRect — what the output preview draws from (T-83)', () => {
  it('with no crop it is the platform cut out of the whole source', () => {
    // 1920x1080 -> 9:16: the centered 607.5 x 1080 strip.
    const r = outputSourceRect(1920, 1080, null, 9 / 16)
    expect(r.h).toBe(1080)
    expect(r.w).toBeCloseTo(607.5, 1)
    expect(r.x).toBeCloseTo((1920 - 607.5) / 2, 1)
    expect(r.y).toBe(0)
  })

  it('with a crop it is the platform cut out of THE CROP, in source pixels', () => {
    // A 960x720 (4:3) crop at (480, 180); 9:16 of it is 405 x 720, centered.
    const r = outputSourceRect(1920, 1080, { x: 0.25, y: 180 / 1080, w: 0.5, h: 720 / 1080 }, 9 / 16)
    expect(r.w).toBeCloseTo(405, 1)
    expect(r.h).toBeCloseTo(720, 1)
    expect(r.x).toBeCloseTo(480 + (960 - 405) / 2, 1)
    expect(r.y).toBeCloseTo(180, 1)
  })

  it('never leaves the crop it was cut from', () => {
    const crop = { x: 0.2, y: 0.1, w: 0.4, h: 0.7 }
    for (const aspect of [9 / 16, 1, 4 / 5, 16 / 9, 2.4]) {
      const r = outputSourceRect(3840, 2160, crop, aspect)
      expect(r.x).toBeGreaterThanOrEqual(crop.x * 3840 - 0.001)
      expect(r.y).toBeGreaterThanOrEqual(crop.y * 2160 - 0.001)
      expect(r.x + r.w).toBeLessThanOrEqual((crop.x + crop.w) * 3840 + 0.001)
      expect(r.y + r.h).toBeLessThanOrEqual((crop.y + crop.h) * 2160 + 0.001)
      expect(r.w / r.h).toBeCloseTo(aspect, 6)
    }
  })

  it('a crop of the platform\'s own shape is that crop, whole', () => {
    const r = outputSourceRect(1920, 1080, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 16 / 9)
    expect(r).toEqual({ x: 480, y: 270, w: 960, h: 540 })
  })

  it('a rect that is not a number is no crop at all', () => {
    expect(outputSourceRect(1920, 1080, { x: NaN, y: NaN, w: NaN, h: NaN }, 16 / 9)).toEqual(
      outputSourceRect(1920, 1080, null, 16 / 9)
    )
  })
})
