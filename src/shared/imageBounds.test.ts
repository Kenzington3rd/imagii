import { describe, it, expect } from 'vitest'
import { LAYER_DRAWN_MAX_DIM, STORED_IMAGE_MAX_DIM, boundedSize, scaleToFit } from './imageBounds'

/**
 * T-137 (6), (10) - the size a picture is kept at on the canvas.
 *
 * ImportPanel kept every picture's full-size data URL though the layer is drawn at most 800 px wide, so four 11 MB PNGs put a project over the size
 * limit (50 MiB) on their own. A picture is stored as a copy bounded to `STORED_IMAGE_MAX_DIM`, and a reference sent from a mood board is embedded at
 * `LAYER_DRAWN_MAX_DIM`; these are the numbers and the arithmetic (the canvas that draws the copy is in `lib/boundedImage.ts`, covered by the e2e specs).
 */
describe('scaleToFit - the factor that brings the longer side to the bound, never above 1', () => {
  it('shrinks the longer side to the bound', () => {
    expect(scaleToFit(4000, 3000, 800)).toBe(0.2)
    expect(scaleToFit(1000, 4000, 800)).toBe(0.2)
    expect(scaleToFit(1600, 900, 800)).toBe(0.5)
  })

  it('never enlarges: a picture under the bound is 1', () => {
    expect(scaleToFit(640, 480, 800)).toBe(1)
    expect(scaleToFit(800, 800, 800)).toBe(1)
  })

  it('a size that is not a size is 1 (nothing to fit), never NaN or Infinity', () => {
    for (const [w, h] of [[0, 0], [NaN, 10], [10, NaN], [-5, 20], [Infinity, 4]] as const) expect(scaleToFit(w, h, 800), `${w}x${h}`).toBe(1)
  })
})

describe('boundedSize - whole pixels, the aspect kept, at least one pixel a side', () => {
  it('a 4000x3000 picture at 1600 is 1600x1200', () => {
    expect(boundedSize(4000, 3000, STORED_IMAGE_MAX_DIM)).toEqual({ width: 1600, height: 1200 })
  })

  it('a portrait picture is bounded by its height', () => {
    expect(boundedSize(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('a picture under the bound is its own size', () => {
    expect(boundedSize(64, 48, 1600)).toEqual({ width: 64, height: 48 })
  })

  it('rounds to whole pixels and never reaches zero (a 1 px sliver stays a sliver)', () => {
    expect(boundedSize(4000, 1, 1600)).toEqual({ width: 1600, height: 1 })
    expect(boundedSize(3, 4000, 1600)).toEqual({ width: 1, height: 1600 })
    expect(boundedSize(4001, 3001, 1600)).toEqual({ width: 1600, height: 1200 })
  })
})

describe('the two bounds', () => {
  it('the copy is kept at twice the size the layer is first drawn at, so the default 2x export of a placed picture still has its pixels', () => {
    expect(LAYER_DRAWN_MAX_DIM).toBe(800)
    expect(STORED_IMAGE_MAX_DIM).toBe(2 * LAYER_DRAWN_MAX_DIM)
  })
})
