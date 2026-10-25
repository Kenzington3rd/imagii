import { describe, it, expect } from 'vitest'
import {
  LAYER_DRAWN_MAX_DIM,
  PLACEMENT_MARGIN,
  STORED_IMAGE_MAX_BYTES,
  STORED_IMAGE_MAX_DIM,
  boundedSize,
  chooseStoredCopy,
  nextStoredDim,
  placementFor,
  scaleToFit,
  storedImageMaxDim
} from './imageBounds'

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

/**
 * T-139 (2) - the FIRST placement of a picture fits the document it lands on.
 *
 * A picture was placed at min(its size, 800 px) at (60, 60) whatever the document, so a 512x512 file on the 112x112 emote showed a 52 px corner, with every
 * other handle off the stage and no size field to bring it back. The drawn size is also bounded by the document and the position stays inside it.
 */
describe('placementFor - the first placement of a picture is wholly on its document (T-139 (2))', () => {
  it('a 512x512 picture on the 112x112 emote is the whole emote, at the corner', () => {
    expect(placementFor(512, 512, 112, 112)).toEqual({ x: 0, y: 0, width: 112, height: 112 })
  })

  it('a tall 400x1600 picture on the 1200x480 banner is as tall as the banner (120x480), at the top, still 60 px in', () => {
    expect(placementFor(400, 1600, 1200, 480)).toEqual({ x: PLACEMENT_MARGIN, y: 0, width: 120, height: 480 })
  })

  it('on a document the picture fits, the placement is what it always was: 800 px at the longer side, at (60, 60)', () => {
    expect(placementFor(4000, 3000, 1920, 1080)).toEqual({ x: 60, y: 60, width: 800, height: 600 })
    expect(placementFor(1920, 1080, 1920, 1080)).toEqual({ x: 60, y: 60, width: 800, height: 450 })
    expect(placementFor(800, 800, 3840, 2160)).toEqual({ x: 60, y: 60, width: 800, height: 800 })
    expect(placementFor(64, 48, 1200, 800), 'a small picture is not enlarged').toEqual({ x: 60, y: 60, width: 64, height: 48 })
    expect(placementFor(1000, 4000, 1920, 1080)).toEqual({ x: 60, y: 60, width: 200, height: 800 })
  })

  it('the margin gives way before the picture does: a picture that fits but not 60 px in is moved up to the edge it can reach', () => {
    expect(placementFor(500, 500, 520, 520)).toEqual({ x: 20, y: 20, width: 500, height: 500 })
    expect(placementFor(500, 100, 520, 800), 'x gives way, y does not').toEqual({ x: 20, y: 60, width: 500, height: 100 })
    expect(placementFor(112, 112, 112, 112)).toEqual({ x: 0, y: 0, width: 112, height: 112 })
  })

  it('a document with no valid size places the picture as it was before (the 800 px bound, at 60 px), never NaN', () => {
    for (const [w, h] of [[0, 0], [NaN, 100], [100, NaN], [-5, 20], [Infinity, 4]] as const) {
      expect(placementFor(1600, 800, w, h), `${w}x${h}`).toEqual({ x: 60, y: 60, width: 800, height: 400 })
    }
  })

  it('wholly inside EXACTLY: a size scaled by (document / picture) does not overshoot the document by a rounding error (120 * (31 / 120) is 31.000000000000004)', () => {
    for (const [pic, doc] of [[120, 31], [121, 63], [134, 85], [137, 53], [139, 27]] as const) {
      const p = placementFor(pic, pic, doc, doc)
      expect(p, `${pic} on ${doc}`).toEqual({ x: 0, y: 0, width: doc, height: doc })
    }
  })

  it('on every document size the app makes, for a spread of pictures: wholly inside, the aspect kept, never enlarged, never past 800 px', () => {
    const documents = [[112, 112], [600, 400], [1200, 480], [1200, 800], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [1080, 1920], [333, 77]] as const
    const pictures = [[1, 1], [64, 48], [512, 512], [400, 1600], [1600, 400], [800, 800], [801, 3], [3, 4000], [1920, 1080], [4000, 3000], [9000, 6000], [111, 113]] as const
    for (const [docW, docH] of documents) {
      for (const [w, h] of pictures) {
        const p = placementFor(w, h, docW, docH)
        const what = `${w}x${h} on ${docW}x${docH}: ${JSON.stringify(p)}`
        expect(p.x, what).toBeGreaterThanOrEqual(0)
        expect(p.y, what).toBeGreaterThanOrEqual(0)
        // (a few ulps of slack: x is docW - width, and the sum of the two is not always exactly docW in floating point)
        expect(p.x + p.width, what).toBeLessThanOrEqual(docW + 1e-9)
        expect(p.y + p.height, what).toBeLessThanOrEqual(docH + 1e-9)
        expect(p.width, what).toBeLessThanOrEqual(w)
        expect(p.height, what).toBeLessThanOrEqual(h)
        expect(Math.max(p.width, p.height), what).toBeLessThanOrEqual(LAYER_DRAWN_MAX_DIM)
        expect(p.width / p.height, what).toBeCloseTo(w / h, 6)
        expect(p.x, 'the margin is never more than 60').toBeLessThanOrEqual(PLACEMENT_MARGIN)
      }
    }
  })
})

/**
 * T-139 (4) - a byte budget for the copy the document keeps.
 *
 * T-138 (2) bounded the PIXELS of the stored copy and re-encoded as JPEG only a source that was one, so a 9000x6000 PNG on the 4K overlay became a 54 MB data
 * URL and paused autosave at once. The copy now has a budget in bytes: over it, an opaque picture is re-encoded as a JPEG at the same bound; still over (or
 * transparent), the bound steps down by a quarter until the copy fits.
 */
describe('STORED_IMAGE_MAX_BYTES and nextStoredDim - the budget and the step (T-139 (4))', () => {
  it('the budget is 16 MiB of data URL characters, a third of the project limit', () => {
    expect(STORED_IMAGE_MAX_BYTES).toBe(16 * 1024 * 1024)
  })

  it('a step is three quarters of the bound in whole pixels', () => {
    expect(nextStoredDim(4000)).toBe(3000)
    expect(nextStoredDim(3840)).toBe(2880)
    expect(nextStoredDim(7680)).toBe(5760)
    expect(nextStoredDim(1001)).toBe(750)
  })

  it('always smaller, never under one pixel, and 1 is the end of the road', () => {
    expect(nextStoredDim(4)).toBe(3)
    expect(nextStoredDim(3)).toBe(2)
    expect(nextStoredDim(2)).toBe(1)
    expect(nextStoredDim(1)).toBeNull()
    expect(nextStoredDim(0.5)).toBeNull()
    for (const bad of [NaN, Infinity, -Infinity, 0, -10]) expect(nextStoredDim(bad), String(bad)).toBeNull()
  })

  it('from any bound the steps reach 1 in a few dozen, each strictly smaller', () => {
    for (const start of [7680, 2400, 1600, 112, 37]) {
      let dim: number | null = start
      let steps = 0
      while (dim !== null) {
        const next = nextStoredDim(dim)
        if (next !== null) expect(next, `${dim} -> ${next}`).toBeLessThan(dim)
        dim = next
        steps += 1
        expect(steps, `${start} terminates`).toBeLessThan(60)
      }
    }
  })
})

describe('chooseStoredCopy - the first copy that fits the budget (T-139 (4))', () => {
  /** An encoder whose output is `perPixel` characters per pixel of a square at `dim` (a noise picture is ~1.3 as PNG, ~0.55 as JPEG), recording every call. */
  function fakeCanvas(opts: { opaque: boolean; png?: number; jpeg?: number; aspect?: number }) {
    const calls: Array<{ dim: number; jpeg: boolean }> = []
    let asked = 0
    return {
      calls,
      asked: () => asked,
      canvas: {
        opaque: () => {
          asked += 1
          return opts.opaque
        },
        encode: (dim: number, jpeg: boolean) => {
          calls.push({ dim, jpeg })
          const chars = Math.round(dim * dim * (opts.aspect ?? 0.75) * (jpeg ? (opts.jpeg ?? 0.55) : (opts.png ?? 1.3)))
          return `data:image/${jpeg ? 'jpeg' : 'png'};base64,${'A'.repeat(chars)}`
        }
      }
    }
  }
  const BUDGET = 1000
  const url = (kind: string, chars: number): string => `data:image/${kind};base64,${'A'.repeat(chars)}`

  it('a picture within the bound whose file fits is kept as it came: nothing is encoded, opacity is never asked', () => {
    const fake = fakeCanvas({ opaque: true })
    const came = url('png', 100)
    expect(chooseStoredCopy({ longest: 300, startDim: 500, asCame: came, cameAsJpeg: false, maxBytes: BUDGET, ...fake.canvas })).toBe(came)
    expect(fake.calls).toEqual([])
    expect(fake.asked()).toBe(0)
  })

  it('a picture over the bound is copied at the bound, as before: PNG, or JPEG when it came as one and is opaque', () => {
    const png = fakeCanvas({ opaque: true, png: 0.001 })
    chooseStoredCopy({ longest: 900, startDim: 500, asCame: url('png', 5000), cameAsJpeg: false, maxBytes: BUDGET, ...png.canvas })
    expect(png.calls).toEqual([{ dim: 500, jpeg: false }])
    expect(png.asked(), 'a PNG source that fits asks nothing').toBe(0)

    const jpg = fakeCanvas({ opaque: true, jpeg: 0.001 })
    chooseStoredCopy({ longest: 900, startDim: 500, asCame: url('jpeg', 5000), cameAsJpeg: true, maxBytes: BUDGET, ...jpg.canvas })
    expect(jpg.calls).toEqual([{ dim: 500, jpeg: true }])
    expect(jpg.asked(), 'a JPEG source is asked its opacity, once').toBe(1)

    const ghost = fakeCanvas({ opaque: false, png: 0.001 })
    chooseStoredCopy({ longest: 900, startDim: 500, asCame: url('jpeg', 5000), cameAsJpeg: true, maxBytes: BUDGET, ...ghost.canvas })
    expect(ghost.calls, 'a transparent JPEG-named source is never made a JPEG').toEqual([{ dim: 500, jpeg: false }])
  })

  it('a file within the bound but over the budget is re-encoded as a JPEG at the SAME bound when it is opaque - not kept as it came', () => {
    const fake = fakeCanvas({ opaque: true, jpeg: 0.001 })
    const came = url('png', 5000)
    const stored = chooseStoredCopy({ longest: 400, startDim: 500, asCame: came, cameAsJpeg: false, maxBytes: BUDGET, ...fake.canvas })
    expect(stored).not.toBe(came)
    expect(stored.startsWith('data:image/jpeg;')).toBe(true)
    expect(fake.calls, 'at the picture\'s own size (400), which is the bound it already had').toEqual([{ dim: 400, jpeg: true }])
    expect(fake.asked()).toBe(1)
  })

  it('when the JPEG is still over, the bound steps down by a quarter until the copy fits, as a JPEG', () => {
    // chars = dim^2 * 0.75 * 0.55 = 0.4125 dim^2: 4000 -> 6.6M, 3000 -> 3.7M, 2250 -> 2.09M, 1687 -> 1.17M, 1265 -> 660k (fits 1M)
    const fake = fakeCanvas({ opaque: true })
    const stored = chooseStoredCopy({ longest: 4000, startDim: 7680, asCame: url('png', 36_000_000), cameAsJpeg: false, maxBytes: 1_000_000, ...fake.canvas })
    expect(fake.calls.map((c) => c.dim)).toEqual([4000, 3000, 2250, 1687, 1265])
    expect(fake.calls.every((c) => c.jpeg)).toBe(true)
    expect(stored.length).toBeLessThanOrEqual(1_000_000)
    expect(fake.asked(), 'opacity is asked ONCE, however many steps').toBe(1)
  })

  it('a transparent picture is never a JPEG: it steps down as a PNG from the first copy (no second encode at the same bound)', () => {
    const fake = fakeCanvas({ opaque: false })
    const stored = chooseStoredCopy({ longest: 4000, startDim: 7680, asCame: url('png', 48_000_000), cameAsJpeg: false, maxBytes: 3_000_000, ...fake.canvas })
    // 0.975 dim^2 chars as PNG: 4000 -> 15.6M (the file came as 48M, over, and no re-encode at 4000 is made), 3000 -> 8.8M, 2250 -> 4.9M, 1687 -> 2.77M
    expect(fake.calls).toEqual([{ dim: 3000, jpeg: false }, { dim: 2250, jpeg: false }, { dim: 1687, jpeg: false }])
    expect(stored.startsWith('data:image/png;')).toBe(true)
    expect(stored.length).toBeLessThanOrEqual(3_000_000)
  })

  it('a copy at the bound that came out over the budget: an opaque picture goes to JPEG at that bound, then steps (the bound is the starting size, T-138 (2))', () => {
    const fake = fakeCanvas({ opaque: true })
    // 3840x2160 overlay bound 7680; a 9000x6000 source: the first copy is a PNG at 7680, then JPEG at 7680, then 5760, 4320 ...
    const stored = chooseStoredCopy({ longest: 9000, startDim: 7680, asCame: url('png', 10), cameAsJpeg: false, maxBytes: 12_000_000, ...fake.canvas })
    expect(fake.calls.slice(0, 3)).toEqual([{ dim: 7680, jpeg: false }, { dim: 7680, jpeg: true }, { dim: 5760, jpeg: true }])
    expect(stored.length).toBeLessThanOrEqual(12_000_000)
  })

  it('a JPEG source that is opaque and whose bounded copy is over the budget is not re-encoded at the same bound a second time', () => {
    const fake = fakeCanvas({ opaque: true })
    chooseStoredCopy({ longest: 9000, startDim: 7680, asCame: url('jpeg', 10), cameAsJpeg: true, maxBytes: 12_000_000, ...fake.canvas })
    expect(fake.calls.slice(0, 2), 'the JPEG copy at the bound, then straight to the step').toEqual([{ dim: 7680, jpeg: true }, { dim: 5760, jpeg: true }])
    expect(fake.asked(), 'a JPEG source asks for the first copy and again for the steps: one reading of the pixels for both').toBe(1)
  })

  it('the length of the data URL is what is measured: exactly the budget fits, one over does not', () => {
    const fake = fakeCanvas({ opaque: true })
    expect(chooseStoredCopy({ longest: 100, startDim: 500, asCame: url('png', 1000 - 'data:image/png;base64,'.length), cameAsJpeg: false, maxBytes: 1000, ...fake.canvas }).length).toBe(1000)
    expect(fake.calls).toEqual([])
    const over = fakeCanvas({ opaque: true, jpeg: 0.0001 })
    chooseStoredCopy({ longest: 100, startDim: 500, asCame: url('png', 1001 - 'data:image/png;base64,'.length), cameAsJpeg: false, maxBytes: 1000, ...over.canvas })
    expect(over.calls.length, 'one character over is over').toBeGreaterThan(0)
  })

  it('a copy that never fits ends at one pixel with the smallest it made, having tried each step once', () => {
    const calls: number[] = []
    const stored = chooseStoredCopy({
      longest: 64,
      startDim: 500,
      asCame: url('png', 100),
      cameAsJpeg: false,
      maxBytes: 10,
      opaque: () => false,
      encode: (dim) => {
        calls.push(dim)
        return url('png', 100 + dim)
      }
    })
    expect(calls[0]).toBe(48)
    expect(calls[calls.length - 1]).toBe(1)
    expect(new Set(calls).size, 'no bound tried twice').toBe(calls.length)
    expect(stored).toBe(url('png', 101))
  })

  it('the default budget is STORED_IMAGE_MAX_BYTES', () => {
    const fake = fakeCanvas({ opaque: true })
    const came = url('png', STORED_IMAGE_MAX_BYTES)
    expect(chooseStoredCopy({ longest: 100, startDim: 500, asCame: came, cameAsJpeg: false, ...fake.canvas }).startsWith('data:image/jpeg;'), 'over by the prefix').toBe(true)
  })
})
