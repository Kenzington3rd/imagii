import { afterEach, describe, it, expect, vi } from 'vitest'
import { loadImage } from './boundedImage'

/**
 * T-138 (non-counted) - the one place a picture is decoded to be copied sends no referrer.
 *
 * PRODUCT_GUIDE promises that a picture requested from a remote host (a mood-board tile whose cached thumbnail is gone falls back to the address it
 * came from) tells that host nothing about where the request came from. ReferencePanel's and MoodBoardPanel's `<img>` say `referrerPolicy="no-referrer"`;
 * `loadImage` is the third place an `Image` fetches one, and sent the default policy. The policy has to be set BEFORE `src`, because setting `src` starts
 * the request. The unit runs in node, so `Image` is a stand-in that records what was assigned and in what order.
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
