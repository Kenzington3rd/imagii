import { describe, it, expect } from 'vitest'
import { LAYER_DRAWN_MAX_DIM, STORED_IMAGE_MAX_DIM, boundedSize, scaleToFit, storedImageMaxDim } from './imageBounds'

/**
 * T-137 (6), (10) - the size a picture is kept at on the canvas.
 *
 * ImportPanel kept every picture's full-size data URL though the layer is drawn at most 800 px wide, so four 11 MB PNGs put a project over the size
 * limit (50 MiB) on their own. A picture is stored as a copy bounded to `storedImageMaxDim` of its document (never under `STORED_IMAGE_MAX_DIM`, T-138 (2)),
 * and a reference sent from a mood board is embedded at `LAYER_DRAWN_MAX_DIM`; these are the numbers and the arithmetic (the canvas that draws the copy is in
 * `lib/boundedImage.ts`, covered by the e2e specs).
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
  it('the floor is twice the size the layer is first drawn at, so the default 2x export of a placed picture still has its pixels', () => {
    expect(LAYER_DRAWN_MAX_DIM).toBe(800)
    expect(STORED_IMAGE_MAX_DIM).toBe(2 * LAYER_DRAWN_MAX_DIM)
  })
})

/**
 * T-138 (2) - the stored copy is sized to the document the picture is placed on.
 *
 * A layer is freely resizable and the templates are 1280 to 3840 px documents, so a 4K background enlarged to fill a 3840 px overlay was exported from
 * a 1600 px copy (2.4x upscaled; worse at the HiDPI 2x default). The bound is twice the document's longer side - what a picture that fills the document
 * is exported at in a default HiDPI export - and never less than the old 1600.
 */
describe('storedImageMaxDim - twice the document\'s longer side, never under the floor', () => {
  it.each([
    ['the default blank canvas, 1200x800', 1200, 800, 2400],
    ['the 1280x720 thumbnail', 1280, 720, 2560],
    ['the 1920x1080 overlay', 1920, 1080, 3840],
    ['the 2560x1440 overlay', 2560, 1440, 5120],
    ['the 3840x2160 overlay', 3840, 2160, 7680],
    ['a portrait document is read by its HEIGHT', 1080, 1920, 3840]
  ])('%s: %i x %i keeps up to %i px', (_label, width, height, expected) => {
    expect(storedImageMaxDim(width, height)).toBe(expected)
  })

  it('a small document keeps the floor: the 112 px emote, and a 600x400 card, are bounded at 1600 as before', () => {
    expect(storedImageMaxDim(112, 112)).toBe(STORED_IMAGE_MAX_DIM)
    expect(storedImageMaxDim(600, 400)).toBe(STORED_IMAGE_MAX_DIM)
    expect(storedImageMaxDim(800, 800), '2 x 800 is the floor itself').toBe(STORED_IMAGE_MAX_DIM)
  })

  it('a document size that is not a size falls back to the floor, never NaN, Infinity or a negative bound', () => {
    for (const [w, h] of [[NaN, 1080], [1920, NaN], [Infinity, 1080], [1920, -Infinity], [0, 0], [0, 1080], [1920, 0], [-1920, 1080], [1920, -1080]] as const) {
      expect(storedImageMaxDim(w, h), `${w}x${h}`).toBe(STORED_IMAGE_MAX_DIM)
    }
  })

  it('what the stored copy does with it: a 4000x3000 picture is 3840x2880 on the 1920x1080 overlay and 2560x1920 on the 1280x720 thumbnail; 1920x1080 is kept whole on the overlay', () => {
    const overlay = storedImageMaxDim(1920, 1080)
    const thumb = storedImageMaxDim(1280, 720)
    expect(boundedSize(4000, 3000, overlay)).toEqual({ width: 3840, height: 2880 })
    expect(boundedSize(4000, 3000, thumb)).toEqual({ width: 2560, height: 1920 })
    expect(boundedSize(1920, 1080, overlay), 'a picture within the bound is its own size').toEqual({ width: 1920, height: 1080 })
    expect(scaleToFit(1920, 1080, overlay), 'and ImportPanel keeps the file as it came (scale 1)').toBe(1)
  })
})
