import { describe, it, expect } from 'vitest'
import {
  computeCropBox,
  findClippedSafeZones,
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
