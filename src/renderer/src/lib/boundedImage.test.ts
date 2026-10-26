import { afterEach, describe, it, expect, vi } from 'vitest'
import { boundedDataUrl, loadImage, storedDataUrl } from './boundedImage'

/**
 * T-138 (non-counted) - the one place a picture is decoded to be copied sends no referrer.
 *
 * PRODUCT_GUIDE promises that a picture requested from a remote host (a mood-board tile whose cached thumbnail is gone falls back to the address it
 * came from) tells that host nothing about where the request came from. ReferencePanel's and MoodBoardPanel's `<img>` say `referrerPolicy="no-referrer"`;
 * `loadImage` is one of four places an image fetches one (the two `<img>` above, this, and Canvas.tsx's `useImage`, ledger (g)), and sent the default policy.
 * The policy has to be set BEFORE `src`, because setting `src` starts the request. The unit runs in node, so `Image` is a stand-in that records what was assigned and in what order.
 */
class FakeImage {
  static made: FakeImage[] = []
  order: string[] = []
  values: Record<string, unknown> = {}
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  fail = false
  constructor() {
    FakeImage.made.push(this)
  }
  set referrerPolicy(value: string) {
    this.order.push('referrerPolicy')
    this.values.referrerPolicy = value
  }
  set crossOrigin(value: string) {
    this.order.push('crossOrigin')
    this.values.crossOrigin = value
  }
  set src(value: string) {
    this.order.push('src')
    this.values.src = value
    queueMicrotask(() => (this.fail ? this.onerror?.() : this.onload?.()))
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeImage.made = []
})

describe('loadImage - no referrer, set before the request starts (T-138)', () => {
  it('a local picture is decoded with the no-referrer policy, assigned before src', async () => {
    vi.stubGlobal('Image', FakeImage)
    await loadImage('data:image/png;base64,AAAA')
    const img = FakeImage.made[0]
    expect(img?.values.referrerPolicy).toBe('no-referrer')
    expect(img?.order.indexOf('referrerPolicy'), 'the policy is in force when src starts the request').toBeLessThan(img?.order.indexOf('src') ?? -1)
  })

  it('a tile fetched from a remote host keeps its crossOrigin AND the no-referrer policy, both before src', async () => {
    vi.stubGlobal('Image', FakeImage)
    await loadImage('https://images.example/thumb.jpg', 'anonymous')
    const img = FakeImage.made[0]
    expect(img?.values.crossOrigin).toBe('anonymous')
    expect(img?.values.referrerPolicy).toBe('no-referrer')
    expect(img?.order.indexOf('crossOrigin')).toBeLessThan(img?.order.indexOf('src') ?? -1)
    expect(img?.order.indexOf('referrerPolicy')).toBeLessThan(img?.order.indexOf('src') ?? -1)
  })

  it('without a crossOrigin argument none is set (a local picture needs none)', async () => {
    vi.stubGlobal('Image', FakeImage)
    await loadImage('data:image/png;base64,AAAA')
    expect(FakeImage.made[0]?.values.crossOrigin).toBeUndefined()
  })

  it('a picture that does not decode rejects in the sentence ImportPanel and the mood board report from', async () => {
    class Failing extends FakeImage {
      constructor() {
        super()
        this.fail = true
      }
    }
    vi.stubGlobal('Image', Failing)
    await expect(loadImage('data:image/png;base64,AAAA')).rejects.toThrow('Decode failed')
  })
})

/**
 * T-139 (4) - the stored copy is made to a byte budget, and opacity is read once.
 *
 * The ladder (which copy, in what order) is `chooseStoredCopy`'s, tested in `imageBounds.test.ts` with a stand-in encoder. This is the other half: the canvas that
 * draws the copy. The unit runs in node, so `document.createElement('canvas')` is a stand-in whose output is as long as its pixels are many, and which records
 * every canvas made, the size it was drawn at and the format it was asked for.
 */
interface MadeCanvas {
  width: number
  height: number
  willRead: boolean
  asked: string[]
  drew: boolean
  read: boolean
}

function stubCanvas(opts: { opaque: boolean; perPixel?: Record<string, number> }): MadeCanvas[] {
  const made: MadeCanvas[] = []
  const perPixel = opts.perPixel ?? { 'image/png': 1.3, 'image/jpeg': 0.55 }
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`)
      const record: MadeCanvas = { width: 0, height: 0, willRead: false, asked: [], drew: false, read: false }
      made.push(record)
      return {
        get width() {
          return record.width
        },
        set width(v: number) {
          record.width = v
        },
        get height() {
          return record.height
        },
        set height(v: number) {
          record.height = v
        },
        getContext: (_kind: string, o?: { willReadFrequently?: boolean }) => {
          record.willRead = o?.willReadFrequently === true
          return {
            drawImage: () => {
              record.drew = true
            },
            getImageData: (_x: number, _y: number, w: number, h: number) => {
              record.read = true
              const data = new Uint8ClampedArray(w * h * 4).fill(255)
              if (!opts.opaque) data[3] = 128
              return { data }
            }
          }
        },
        toDataURL: (type: string) => {
          record.asked.push(type)
          return `data:${type};base64,${'A'.repeat(Math.round(record.width * record.height * (perPixel[type] ?? 1)))}`
        }
      }
    }
  })
  return made
}

const pictureOf = (w: number, h: number): HTMLImageElement => ({ naturalWidth: w, naturalHeight: h }) as unknown as HTMLImageElement

describe('storedDataUrl - the copy the document keeps, within the byte budget (T-139 (4))', () => {
  it('a small file within the bound is returned as it came and no canvas is made', () => {
    const made = stubCanvas({ opaque: true })
    const came = 'data:image/png;base64,AAAA'
    expect(storedDataUrl(pictureOf(64, 48), came, 2400, false)).toBe(came)
    expect(made).toEqual([])
  })

  it('a file within the bound but over the budget is re-encoded: an opaque one as a JPEG at its own size, its pixels read once', () => {
    const made = stubCanvas({ opaque: true, perPixel: { 'image/png': 1.3, 'image/jpeg': 0.2 } })
    const came = `data:image/png;base64,${'A'.repeat(5000)}`
    const stored = storedDataUrl(pictureOf(100, 50), came, 2400, false, 2000)
    expect(stored.startsWith('data:image/jpeg;')).toBe(true)
    expect(made.filter((c) => c.read), 'opacity is read on ONE canvas').toHaveLength(1)
    expect(made.map((c) => [c.width, c.height]), 'the opacity canvas and the encode canvas are the picture\'s own size').toEqual([[100, 50], [100, 50]])
    expect(made.flatMap((c) => c.asked)).toEqual(['image/jpeg'])
  })

  it('a transparent picture over the budget steps down as PNG, and never asks for a JPEG', () => {
    const made = stubCanvas({ opaque: false })
    const came = `data:image/png;base64,${'A'.repeat(50_000)}`
    const stored = storedDataUrl(pictureOf(400, 200), came, 2400, false, 20_000)
    expect(stored.startsWith('data:image/png;')).toBe(true)
    expect(stored.length).toBeLessThanOrEqual(20_000)
    const encoded = made.filter((c) => c.asked.length > 0)
    expect(encoded.flatMap((c) => c.asked).every((t) => t === 'image/png')).toBe(true)
    expect(encoded.map((c) => c.width), 'each step is three quarters of the last, in whole pixels').toEqual([300, 225, 168])
    expect(made.filter((c) => c.read), 'opacity is read once').toHaveLength(1)
  })

  it('a picture over the bound is copied at the bound first (the T-138 (2) size), as a PNG unless a JPEG source is opaque', () => {
    const made = stubCanvas({ opaque: true, perPixel: { 'image/png': 0.1, 'image/jpeg': 0.1 } })
    storedDataUrl(pictureOf(4000, 3000), 'data:image/png;base64,AAAA', 2400, false)
    expect(made.map((c) => [c.width, c.height, c.asked.join()])).toEqual([[2400, 1800, 'image/png']])
    const jpgMade = stubCanvas({ opaque: true, perPixel: { 'image/png': 0.1, 'image/jpeg': 0.1 } })
    storedDataUrl(pictureOf(4000, 3000), 'data:image/jpeg;base64,AAAA', 2400, true)
    expect(jpgMade.filter((c) => c.asked.length).map((c) => c.asked.join())).toEqual(['image/jpeg'])
  })

  it('the JPEG keeps the quality the stored copy has always had', () => {
    const calls: Array<[string, number | undefined]> = []
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => undefined, getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }) }),
        toDataURL: (type: string, quality?: number) => {
          calls.push([type, quality])
          return `data:${type};base64,A`
        }
      })
    })
    storedDataUrl(pictureOf(100, 100), `data:image/png;base64,${'A'.repeat(200)}`, 2400, false, 100)
    expect(calls).toEqual([['image/jpeg', 0.92]])
  })

  it('boundedDataUrl (the mood board\'s copy) is unchanged: JPEG if opaque and asked for, else PNG', () => {
    const opaque = stubCanvas({ opaque: true })
    expect(boundedDataUrl(pictureOf(1000, 500), 800, true).startsWith('data:image/jpeg;')).toBe(true)
    expect(opaque[0]?.width).toBe(800)
    stubCanvas({ opaque: false })
    expect(boundedDataUrl(pictureOf(1000, 500), 800, true).startsWith('data:image/png;')).toBe(true)
    stubCanvas({ opaque: true })
    expect(boundedDataUrl(pictureOf(1000, 500), 800, false).startsWith('data:image/png;')).toBe(true)
  })
})
