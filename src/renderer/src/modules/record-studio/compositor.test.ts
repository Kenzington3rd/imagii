import { describe, it, expect, vi, afterEach } from 'vitest'
import { NoPictureError, computeContainRect, computeCornerRect, drawFrame, startCompositor, waitForFirstPicture, __testing__ } from './compositor'

/**
 * Pure-function tests for the compositor. The actual canvas drawing and
 * MediaStream lifecycle need a browser env; those are exercised by manual
 * smoke testing. Geometry is the part that breaks silently if math
 * regresses, so it gets unit coverage.
 */

describe('computeCornerRect', () => {
  // 1920x1080 canvas, 20% scale, 32 px margin → cam box 384x216
  it('places the webcam in the bottom-right corner by default math', () => {
    const r = computeCornerRect(1920, 1080, 'bottom-right', 0.2, 32)
    expect(r.w).toBe(384)
    expect(r.h).toBe(216)
    expect(r.x).toBe(1920 - 384 - 32)
    expect(r.y).toBe(1080 - 216 - 32)
  })

  it('top-left corner uses margin only', () => {
    const r = computeCornerRect(1920, 1080, 'top-left', 0.2, 32)
    expect(r.x).toBe(32)
    expect(r.y).toBe(32)
  })

  it('top-right has bottom-right x, top-left y', () => {
    const r = computeCornerRect(1920, 1080, 'top-right', 0.2, 32)
    expect(r.x).toBe(1920 - 384 - 32)
    expect(r.y).toBe(32)
  })

  it('bottom-left has top-left x, bottom-right y', () => {
    const r = computeCornerRect(1920, 1080, 'bottom-left', 0.2, 32)
    expect(r.x).toBe(32)
    expect(r.y).toBe(1080 - 216 - 32)
  })

  it('enforces minimum webcam width to keep faces legible', () => {
    // 100x100 canvas at 20% would mathematically be 20 px wide — too tiny.
    // The function clamps to 64 px minimum.
    const r = computeCornerRect(100, 100, 'bottom-right', 0.2, 0)
    expect(r.w).toBe(64)
  })

  it('rejects invalid input', () => {
    expect(() => computeCornerRect(0, 1080, 'top-left', 0.2, 32)).toThrow()
    expect(() => computeCornerRect(1920, 0, 'top-left', 0.2, 32)).toThrow()
    expect(() => computeCornerRect(1920, 1080, 'top-left', 0, 32)).toThrow()
    expect(() => computeCornerRect(1920, 1080, 'top-left', 1.5, 32)).toThrow()
  })

  it('clamps negative margin to zero', () => {
    const r = computeCornerRect(1920, 1080, 'top-left', 0.2, -50)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })
})

describe('drawFrame', () => {
  // Stub a CanvasRenderingContext2D — we only assert the calls happen
  // in the right order with the right rects. A real canvas/video would
  // need a JSDOM/browser env.
  interface DrawCall {
    image: 'screen' | 'webcam'
    x: number
    y: number
    w: number
    h: number
  }

  function makeStubCtx(): { ctx: CanvasRenderingContext2D; calls: DrawCall[] } {
    const calls: DrawCall[] = []
    const screenVid = { tag: 'screen' as const }
    const webcamVid = { tag: 'webcam' as const }
    const ctx = {
      drawImage: (
        img: { tag: 'screen' | 'webcam' },
        x: number,
        y: number,
        w: number,
        h: number
      ) => {
        calls.push({ image: img.tag, x, y, w, h })
      }
    } as unknown as CanvasRenderingContext2D
    return { ctx, calls, screenVid, webcamVid } as unknown as {
      ctx: CanvasRenderingContext2D
      calls: DrawCall[]
    }
  }

  function makeStubVideo(tag: 'screen' | 'webcam', w: number, h: number): HTMLVideoElement {
    return {
      tag,
      readyState: 4,
      videoWidth: w,
      videoHeight: h
    } as unknown as HTMLVideoElement
  }

  it('draws screen full-canvas then webcam inside the corner rect', () => {
    const { ctx, calls } = makeStubCtx()
    const screen = makeStubVideo('screen', 1920, 1080)
    const webcam = makeStubVideo('webcam', 1280, 720)
    const corner = { x: 1504, y: 832, w: 384, h: 216 }
    drawFrame(ctx, screen, webcam, corner, 1920, 1080)
    expect(calls.length).toBe(2)
    expect(calls[0]).toEqual({ image: 'screen', x: 0, y: 0, w: 1920, h: 1080 })
    // Webcam's 1280x720 has 16:9, same as the corner box, so it fills exactly.
    expect(calls[1]).toEqual({ image: 'webcam', x: 1504, y: 832, w: 384, h: 216 })
  })

  it('letterboxes the webcam if its aspect is taller than the corner box', () => {
    const { ctx, calls } = makeStubCtx()
    const screen = makeStubVideo('screen', 1920, 1080)
    const webcam = makeStubVideo('webcam', 480, 640) // 3:4 portrait
    const corner = { x: 0, y: 0, w: 400, h: 300 } // 4:3
    drawFrame(ctx, screen, webcam, corner, 1920, 1080)
    expect(calls.length).toBe(2)
    const camCall = calls[1]
    expect(camCall).toBeDefined()
    // Box is wider than cam → fit by height. drawH = 300, drawW = 300*(3/4)=225
    expect(camCall?.image).toBe('webcam')
    expect(camCall?.h).toBe(300)
    expect(camCall?.w).toBe(225)
    // Centered horizontally in the 400-wide box
    expect(camCall?.x).toBe(Math.round((400 - 225) / 2))
  })

  it('skips webcam draw when webcam is null', () => {
    const { ctx, calls } = makeStubCtx()
    const screen = makeStubVideo('screen', 1920, 1080)
    drawFrame(ctx, screen, null, { x: 0, y: 0, w: 100, h: 100 }, 1920, 1080)
    expect(calls.length).toBe(1)
    expect(calls[0]?.image).toBe('screen')
  })

  it('skips screen draw when screen is not ready', () => {
    const { ctx, calls } = makeStubCtx()
    const screen = {
      ...makeStubVideo('screen', 1920, 1080),
      readyState: 0
    } as unknown as HTMLVideoElement
    const webcam = makeStubVideo('webcam', 1280, 720)
    drawFrame(ctx, screen, webcam, { x: 0, y: 0, w: 100, h: 100 }, 1920, 1080)
    // Webcam still draws, but screen doesn't
    expect(calls.length).toBe(1)
    expect(calls[0]?.image).toBe('webcam')
  })
})

/**
 * Regression: prior to the 2026-05-11 partial-init fix, `startCompositor`
 * appended two offscreen `<video>` elements to `document.body` BEFORE
 * awaiting `play()` / `waitForMetadata()` / `getContext()`. If any of
 * those steps threw, the function rejected without removing the videos
 * from the DOM. Result: the input MediaStreams stayed open through the
 * orphaned video elements until the page unloaded.
 *
 * The fix wraps the setup phase in try/catch and calls `teardownOffscreen`
 * on failure. These tests pin both halves: the teardown helper itself,
 * and the contract that it survives elements already torn down or
 * missing srcObject.
 */
describe('teardownOffscreen (partial-init cleanup)', () => {
  function makeVideoLike(): HTMLVideoElement {
    const paused = { value: false }
    const src = { value: 'something' as unknown }
    const removed = { value: false }
    return {
      get _paused() {
        return paused.value
      },
      get _srcObject() {
        return src.value
      },
      get _removed() {
        return removed.value
      },
      pause: () => {
        paused.value = true
      },
      set srcObject(v: unknown) {
        src.value = v
      },
      get srcObject() {
        return src.value
      },
      parentNode: {
        removeChild: () => {
          removed.value = true
        }
      }
    } as unknown as HTMLVideoElement
  }

  it('pauses each element, nulls srcObject, and removes from parent', () => {
    const a = makeVideoLike()
    const b = makeVideoLike()
    __testing__.teardownOffscreen([a, b])
    // After teardown both should report paused, srcObject=null, and removed.
    expect((a as unknown as { _paused: boolean })._paused).toBe(true)
    expect((b as unknown as { _paused: boolean })._paused).toBe(true)
    expect(a.srcObject).toBeNull()
    expect(b.srcObject).toBeNull()
    expect((a as unknown as { _removed: boolean })._removed).toBe(true)
    expect((b as unknown as { _removed: boolean })._removed).toBe(true)
  })

  it('swallows pause() throws so a half-torn-down element does not block the second one', () => {
    const a = {
      pause: () => {
        throw new Error('already detached')
      },
      set srcObject(_v: unknown) {
        // Setting srcObject after a thrown pause is the realistic mid-cleanup state
      },
      parentNode: { removeChild: vi.fn() }
    } as unknown as HTMLVideoElement
    const b = makeVideoLike()
    expect(() => __testing__.teardownOffscreen([a, b])).not.toThrow()
    // The second element still gets cleaned up
    expect((b as unknown as { _paused: boolean })._paused).toBe(true)
  })

  it('handles a detached element (no parentNode)', () => {
    const a = {
      pause: () => undefined,
      set srcObject(_v: unknown) {},
      parentNode: null
    } as unknown as HTMLVideoElement
    expect(() => __testing__.teardownOffscreen([a])).not.toThrow()
  })
})

/**
 * T-153 (10) - a window source resized mid-take. The canvas is pinned at the size the screen had at start and `drawFrame` stretched every frame into it, so the
 * rest of the take was recorded distorted. `computeContainRect` fits the CURRENT size inside the canvas (centred, black bars) and `drawFrame` asks it per frame.
 * Screen capture is an OS boundary, so the deepest layer that reaches a real resize is this one (docs/INTERACTION_COVERAGE.md).
 */
describe('computeContainRect (T-153 (10))', () => {
  it('the same aspect fills the whole canvas, at the same size and at another', () => {
    expect(computeContainRect(1920, 1080, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(computeContainRect(1280, 720, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(computeContainRect(960, 540, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })

  it('a wider picture has bars above and below, centred', () => {
    // 2560x1080 (21:9) into 1920x1080: width-bound, 810 tall, 135 above and below.
    expect(computeContainRect(2560, 1080, 1920, 1080)).toEqual({ x: 0, y: 135, w: 1920, h: 810 })
  })

  it('a taller picture has bars left and right, centred', () => {
    // 1080x1080 into 1920x1080: height-bound, 1080 wide, 420 each side.
    expect(computeContainRect(1080, 1080, 1920, 1080)).toEqual({ x: 420, y: 0, w: 1080, h: 1080 })
    // A window dragged narrow and tall.
    expect(computeContainRect(600, 1000, 1920, 1080)).toEqual({ x: 636, y: 0, w: 648, h: 1080 })
  })

  it('never leaves the canvas and never changes the aspect it was given (beyond a pixel of rounding)', () => {
    for (const [w, h] of [[1, 1], [333, 777], [4000, 300], [300, 4000], [1920, 1081]] as const) {
      const r = computeContainRect(w, h, 1920, 1080)
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(1920)
      expect(r.y + r.h).toBeLessThanOrEqual(1080)
      expect(Math.abs(r.w / r.h - w / h) / (w / h)).toBeLessThan(0.01)
    }
  })

  it('a size not reported yet is the full canvas, as it always drew', () => {
    expect(computeContainRect(0, 0, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(computeContainRect(NaN, 1080, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })

  it('refuses a canvas with no size', () => {
    expect(() => computeContainRect(1920, 1080, 0, 1080)).toThrow()
  })
})

describe('drawFrame fits the screen by its size right now (T-153 (10))', () => {
  interface Call {
    op: 'fillRect' | 'drawImage'
    tag?: string
    x: number
    y: number
    w: number
    h: number
    fillStyle?: string
  }
  function stub(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
    const calls: Call[] = []
    const state = { fillStyle: '' }
    const ctx = {
      set fillStyle(v: string) {
        state.fillStyle = v
      },
      get fillStyle() {
        return state.fillStyle
      },
      fillRect: (x: number, y: number, w: number, h: number) => calls.push({ op: 'fillRect', x, y, w, h, fillStyle: state.fillStyle }),
      drawImage: (img: { tag: string }, x: number, y: number, w: number, h: number) => calls.push({ op: 'drawImage', tag: img.tag, x, y, w, h })
    } as unknown as CanvasRenderingContext2D
    return { ctx, calls }
  }
  const video = (tag: string, w: number, h: number): HTMLVideoElement => ({ tag, readyState: 4, videoWidth: w, videoHeight: h }) as unknown as HTMLVideoElement
  const NO_CAM = { x: 0, y: 0, w: 100, h: 100 }

  it('at the start size the screen is the full canvas and nothing is cleared first', () => {
    const { ctx, calls } = stub()
    drawFrame(ctx, video('screen', 1920, 1080), null, NO_CAM, 1920, 1080)
    expect(calls).toEqual([{ op: 'drawImage', tag: 'screen', x: 0, y: 0, w: 1920, h: 1080 }])
  })

  it('a take whose window changes aspect: the same canvas, the picture letterboxed on black, then back to full when it returns', () => {
    const screen = { tag: 'screen', readyState: 4, videoWidth: 1920, videoHeight: 1080 }
    const el = screen as unknown as HTMLVideoElement

    const first = stub()
    drawFrame(first.ctx, el, null, NO_CAM, 1920, 1080)
    expect(first.calls.map((c) => c.op)).toEqual(['drawImage'])

    // The person drags the window square: 1080x1080 now, the canvas still 1920x1080.
    screen.videoWidth = 1080
    const squared = stub()
    drawFrame(squared.ctx, el, null, NO_CAM, 1920, 1080)
    expect(squared.calls).toEqual([
      { op: 'fillRect', x: 0, y: 0, w: 1920, h: 1080, fillStyle: 'black' },
      { op: 'drawImage', tag: 'screen', x: 420, y: 0, w: 1080, h: 1080 }
    ])

    // And back: the bars go with the next frame's full-canvas draw.
    screen.videoWidth = 1920
    const back = stub()
    drawFrame(back.ctx, el, null, NO_CAM, 1920, 1080)
    expect(back.calls).toEqual([{ op: 'drawImage', tag: 'screen', x: 0, y: 0, w: 1920, h: 1080 }])
  })

  it('a wider window has bars above and below, and the webcam corner math is untouched', () => {
    const { ctx, calls } = stub()
    const corner = { x: 1504, y: 832, w: 384, h: 216 }
    drawFrame(ctx, video('screen', 2560, 1080), { tag: 'webcam', readyState: 4, videoWidth: 1280, videoHeight: 720 } as unknown as HTMLVideoElement, corner, 1920, 1080)
    expect(calls).toEqual([
      { op: 'fillRect', x: 0, y: 0, w: 1920, h: 1080, fillStyle: 'black' },
      { op: 'drawImage', tag: 'screen', x: 0, y: 135, w: 1920, h: 810 },
      { op: 'drawImage', tag: 'webcam', x: 1504, y: 832, w: 384, h: 216 }
    ])
  })
})

/**
 * T-155 (bt): the draw loop keeps to the capture rate. `captureStream(30)` takes at most 30 frames a second, so a 144 Hz display used to draw
 * about four frames for every one the recorder kept. These run the REAL `startCompositor` against stubbed globals and a fake rAF clock (the
 * display's refresh), and count the draws the loop makes (a screen `drawImage` each) over one second of ticks.
 */
describe('startCompositor draws what the recorder keeps (T-155 (bt))', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** One second of display ticks at `hz` (the first at t = 0), with the loop's `now` the tick's time. Returns the draws made and the rAF re-arms. */
  async function drawsAt(hz: number, fps?: number): Promise<{ draws: number; ticks: number; stillArmed: boolean; stopped: boolean; drawsAfterStop: number }> {
    const loop: { pending: ((now: number) => void) | null; last: ((now: number) => void) | null } = { pending: null, last: null }
    let draws = 0
    const video = (): Record<string, unknown> => ({
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
      style: {},
      muted: false,
      playsInline: false,
      srcObject: null,
      parentNode: null,
      play: () => Promise.resolve(),
      pause: () => undefined
    })
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect: () => undefined, drawImage: () => void draws++ }),
      captureStream: () => ({ getTracks: () => [] })
    }
    vi.stubGlobal('document', {
      body: { appendChild: () => undefined },
      createElement: (tag: string) => (tag === 'canvas' ? canvas : video())
    })
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      loop.pending = cb
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {
      loop.pending = null
    })
    const handle = await startCompositor({
      screenStream: {} as MediaStream,
      webcamStream: {} as MediaStream,
      webcamCorner: 'bottom-right',
      ...(fps === undefined ? {} : { fps })
    })
    let ticks = 0
    for (let t = 0; t < 1000 - 1e-6; t += 1000 / hz) {
      const cb = loop.pending
      if (cb === null) break
      loop.pending = null
      loop.last = cb
      cb(t)
      ticks++
    }
    const stillArmed = loop.pending !== null
    handle.stop()
    // A tick already queued when stop() ran (the browser may still deliver it) draws nothing and arms nothing.
    const before = draws
    loop.last?.(5000)
    return { draws, ticks, stillArmed, stopped: loop.pending === null, drawsAfterStop: draws - before }
  }

  // The webcam video is a stub with readyState 4 too, so one frame is TWO drawImage calls (screen, then webcam).
  it('a 144 Hz display draws about 30 frames a second, not 144', async () => {
    const r = await drawsAt(144)
    expect(r.ticks).toBe(144)
    expect(r.draws / 2).toBeGreaterThanOrEqual(29)
    expect(r.draws / 2).toBeLessThanOrEqual(31)
  })

  it('a 60 Hz display draws 30 frames a second', async () => {
    const r = await drawsAt(60)
    expect(r.ticks).toBe(60)
    expect(r.draws / 2).toBeGreaterThanOrEqual(29)
    expect(r.draws / 2).toBeLessThanOrEqual(31)
  })

  it('a slow display (24 Hz) draws every frame it gets, and the loop is re-armed after every tick, drawn or skipped', async () => {
    const slow = await drawsAt(24)
    expect(slow.ticks).toBe(24)
    expect(slow.draws / 2).toBe(24)
    expect(slow.stillArmed).toBe(true)
    const fast = await drawsAt(144)
    expect(fast.ticks, 'skipped ticks re-arm the loop too: all 144 ran').toBe(144)
    expect(fast.stillArmed).toBe(true)
    expect(fast.stopped).toBe(true)
    expect(fast.drawsAfterStop, 'a tick delivered after stop() draws nothing').toBe(0)
  })

  it('the interval is the fps the compositor was given: 60 fps on a 60 Hz display draws every tick', async () => {
    const r = await drawsAt(60, 60)
    expect(r.ticks).toBe(60)
    expect(r.draws / 2).toBe(60)
  })
})

/**
 * T-156 (1): T-155's gate re-anchored on every draw, so the rate floored to the first refresh tick past 1000 / fps - 2 ms: a 75 Hz or 100 Hz
 * display drew 25 frames a second, 144 Hz 28.8. The gate now keeps the schedule's phase, so the average is `fps` on any display at or above it.
 * Same stubbed globals and fake rAF clock as the T-155 describe; the ticks are an explicit list of times so a stall can be one of them.
 */
describe('startCompositor keeps its 30 on any display (T-156 (1))', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Runs the REAL loop over the given tick times; returns the frames drawn at each tick (a frame is two drawImage calls). */
  async function framesPerTick(times: number[]): Promise<number[]> {
    let pending: ((now: number) => void) | null = null
    let draws = 0
    const video = (): Record<string, unknown> => ({
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
      style: {},
      muted: false,
      playsInline: false,
      srcObject: null,
      parentNode: null,
      play: () => Promise.resolve(),
      pause: () => undefined
    })
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect: () => undefined, drawImage: () => void draws++ }),
      captureStream: () => ({ getTracks: () => [] })
    }
    vi.stubGlobal('document', {
      body: { appendChild: () => undefined },
      createElement: (tag: string) => (tag === 'canvas' ? canvas : video())
    })
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      pending = cb
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {
      pending = null
    })
    const handle = await startCompositor({
      screenStream: {} as MediaStream,
      webcamStream: {} as MediaStream,
      webcamCorner: 'bottom-right'
    })
    const out: number[] = []
    for (const t of times) {
      const cb = pending as ((now: number) => void) | null
      if (cb === null) break
      pending = null
      const before = draws
      cb(t)
      out.push((draws - before) / 2)
    }
    handle.stop()
    return out
  }

  /** One second of ticks at `hz`, starting at `from`. */
  const second = (hz: number, from = 0): number[] => {
    const ts: number[] = []
    for (let t = from; t < from + 1000 - 1e-6; t += 1000 / hz) ts.push(t)
    return ts
  }
  const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0)

  it.each([60, 75, 100, 144, 165, 240])('a %i Hz display draws 29-31 frames a second', async (hz) => {
    const per = await framesPerTick(second(hz))
    expect(per.length).toBeGreaterThanOrEqual(Math.floor(hz) - 1)
    expect(sum(per)).toBeGreaterThanOrEqual(29)
    expect(sum(per)).toBeLessThanOrEqual(31)
  })

  it('a 24 Hz display draws every tick it gets', async () => {
    const per = await framesPerTick(second(24))
    expect(per).toHaveLength(24)
    expect(sum(per)).toBe(24)
  })

  it('after a 500 ms stall the next tick draws once, no burst follows, and the next second is still 29-31', async () => {
    const before = second(75)
    const resume = 1000 + 500
    const after = second(75, resume)
    const per = await framesPerTick([...before, ...after])
    const first = per.slice(before.length)
    expect(first[0], 'the first tick after the stall draws').toBe(1)
    expect(Math.max(...per), 'never two frames in one tick').toBe(1)
    expect(first[1], 'no catch-up burst on the tick after it').toBe(0)
    expect(sum(first)).toBeGreaterThanOrEqual(29)
    expect(sum(first)).toBeLessThanOrEqual(31)
  })

  it('a tick that arrives 1 ms early (the display\'s jitter) is not read as too early: 60 Hz with alternating +-1 ms still draws 29-31', async () => {
    const jittered = second(60).map((t, i) => t + (i % 2 === 0 ? -1 : 1))
    const per = await framesPerTick(jittered)
    expect(sum(per)).toBeGreaterThanOrEqual(29)
    expect(sum(per)).toBeLessThanOrEqual(31)
  })

  it('on a 240 Hz display no two draws are closer than a capture interval less the 2 ms of jitter', async () => {
    const ticks = second(240)
    const per = await framesPerTick(ticks)
    const drawn = ticks.filter((_, i) => per[i] === 1)
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]! - drawn[i - 1]!, `gap before the draw at ${drawn[i]}`).toBeGreaterThanOrEqual(1000 / 30 - 2)
  })

  it('a 50 ms hitch (more than one interval, less than two) resyncs: one draw, then none on the next ticks', async () => {
    const before = second(240)
    const after = second(240, 1000 + 50)
    const per = await framesPerTick([...before, ...after])
    const first = per.slice(before.length)
    expect(first.slice(0, 3)).toEqual([1, 0, 0])
  })
})

/**
 * T-172 (1): `play()` on a MediaStream-backed video stays pending until the first frame, and `startCompositor` awaited it BEFORE the 10 s metadata
 * race, so a camera that opened and sent nothing left Start on "Starting..." for good with both offscreen <video>s in the document. Each `play()` is
 * now raced against the same limit and rejects with a NoPictureError naming the source.
 */
describe('startCompositor gives up on a source that sends no picture (T-172 (1))', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** A document stub that tracks which <video>s are attached; `stalled` names the sources whose play() never settles. */
  function setup(stalled: Array<'screen' | 'camera'>): { attached: () => number } {
    const attached = new Set<unknown>()
    let made = 0
    const video = (): Record<string, unknown> => {
      const who = made++ === 0 ? 'screen' : 'camera'
      return {
        readyState: 4,
        videoWidth: 1920,
        videoHeight: 1080,
        style: {},
        muted: false,
        playsInline: false,
        srcObject: null,
        parentNode: null,
        play: () => (stalled.includes(who) ? new Promise<void>(() => undefined) : Promise.resolve()),
        pause: () => undefined
      }
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect: () => undefined, drawImage: () => undefined }),
      captureStream: () => ({ getTracks: () => [] })
    }
    vi.stubGlobal('document', {
      body: {
        appendChild: (v: { parentNode: unknown }) => {
          v.parentNode = { removeChild: (c: unknown) => attached.delete(c) }
          attached.add(v)
        }
      },
      createElement: (tag: string) => (tag === 'canvas' ? canvas : video())
    })
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    return { attached: () => attached.size }
  }

  const opts = { screenStream: {} as MediaStream, webcamStream: {} as MediaStream, webcamCorner: 'bottom-right' as const }

  async function settle(p: Promise<unknown>): Promise<{ error: unknown; value: unknown }> {
    return p.then(
      (value) => ({ error: null, value }),
      (error: unknown) => ({ error, value: null })
    )
  }

  it('a camera whose play() never settles rejects with a NoPictureError for the camera at the limit, and leaves no offscreen <video> in the document', async () => {
    vi.useFakeTimers()
    const dom = setup(['camera'])
    const done = settle(startCompositor(opts))
    await vi.advanceTimersByTimeAsync(9_999)
    expect(dom.attached(), 'still waiting just under the limit: both videos are mounted').toBe(2)
    await vi.advanceTimersByTimeAsync(2)
    const { error } = await done
    expect(error).toBeInstanceOf(NoPictureError)
    expect((error as NoPictureError).source).toBe('camera')
    expect((error as Error).message).toBe('The camera sent no picture for 10 seconds.')
    expect(dom.attached()).toBe(0)
  })

  it('a screen whose play() never settles rejects with a NoPictureError for the screen, in a finished sentence that says what to do', async () => {
    vi.useFakeTimers()
    const dom = setup(['screen'])
    const done = settle(startCompositor(opts))
    await vi.advanceTimersByTimeAsync(10_001)
    const { error } = await done
    expect(error).toBeInstanceOf(NoPictureError)
    expect((error as NoPictureError).source).toBe('screen')
    expect((error as Error).message).toBe(
      'The screen capture sent no picture for 10 seconds. Pick another screen or window, then press Start again.'
    )
    expect(dom.attached()).toBe(0)
  })

  it('control: a play() that resolves is no rejection, and no timer is left behind to fire at the limit', async () => {
    vi.useFakeTimers()
    const dom = setup([])
    const handle = await startCompositor(opts)
    expect(dom.attached()).toBe(2)
    expect(vi.getTimerCount(), 'the race cleared its timer: nothing is left to reject later').toBe(0)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(dom.attached(), 'a late timer would have torn the compositor down').toBe(2)
    handle.stop()
    expect(dom.attached()).toBe(0)
  })
})

/**
 * T-174 (2): with the webcam off (or the camera fallen back) the take's picture is the raw screen and no compositor runs, so the 10 s first-picture check
 * `startCompositor` makes never ran: a screen that sent nothing opened a take of nothing. `waitForFirstPicture` is that same race on its own.
 */
describe('waitForFirstPicture waits for the screen\'s first picture and leaves nothing behind (T-174 (2))', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** A document stub that records the <video>s appended; `stalled` makes play() never settle. The stream has one track whose stop() is a spy. */
  function setup(stalled: boolean): {
    attached: () => number
    made: Array<Record<string, unknown>>
    stream: MediaStream
    stop: ReturnType<typeof vi.fn>
    track: EventTarget & { readyState: string }
  } {
    const attached = new Set<unknown>()
    const made: Array<Record<string, unknown>> = []
    const stop = vi.fn()
    const track = Object.assign(new EventTarget(), { stop, readyState: 'live' })
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
    vi.stubGlobal('document', {
      body: {
        appendChild: (v: { parentNode: unknown }) => {
          v.parentNode = { removeChild: (c: unknown) => attached.delete(c) }
          attached.add(v)
        }
      },
      createElement: () => {
        const v: Record<string, unknown> = {
          style: {},
          muted: false,
          playsInline: false,
          srcObject: null,
          parentNode: null,
          play: () => (stalled ? new Promise<void>(() => undefined) : Promise.resolve()),
          pause: () => undefined
        }
        made.push(v)
        return v
      }
    })
    return { attached: () => attached.size, made, stream, stop, track }
  }

  async function settle(p: Promise<unknown>): Promise<unknown> {
    return p.then(
      () => null,
      (error: unknown) => error
    )
  }

  it('a play() that resolves resolves it: the hidden muted <video> held the stream while it waited, and is gone after, with the stream\'s tracks untouched', async () => {
    vi.useFakeTimers()
    const dom = setup(false)
    await waitForFirstPicture(dom.stream)
    expect(dom.made).toHaveLength(1)
    const v = dom.made[0] as Record<string, unknown>
    expect(v.srcObject, 'teardown cleared the element\'s hold on the stream').toBeNull()
    expect(v.muted).toBe(true)
    expect(v.playsInline).toBe(true)
    expect((v.style as { display: string }).display).toBe('none')
    expect(dom.attached(), 'no <video> is left in the document').toBe(0)
    expect(dom.stop, 'the recorder still needs the screen\'s track').not.toHaveBeenCalled()
    expect(vi.getTimerCount(), 'the race cleared its timer').toBe(0)
  })

  it('while a play() is still pending the hidden element is mounted and holds the stream (it decodes only when attached)', async () => {
    vi.useFakeTimers()
    const dom = setup(true)
    const done = settle(waitForFirstPicture(dom.stream))
    await vi.advanceTimersByTimeAsync(9_999)
    expect(dom.attached(), 'still waiting just under the limit: the element is mounted').toBe(1)
    expect(dom.made[0]?.srcObject).toBe(dom.stream)
    await vi.advanceTimersByTimeAsync(2)
    await done
  })

  it('a play() that never settles rejects with a NoPictureError for the screen at the limit, in the finished sentence, leaving no <video> and the tracks untouched', async () => {
    vi.useFakeTimers()
    const dom = setup(true)
    const done = settle(waitForFirstPicture(dom.stream))
    await vi.advanceTimersByTimeAsync(10_001)
    const error = await done
    expect(error).toBeInstanceOf(NoPictureError)
    expect((error as NoPictureError).source).toBe('screen')
    expect((error as Error).message).toBe(
      'The screen capture sent no picture for 10 seconds. Pick another screen or window, then press Start again.'
    )
    expect(dom.attached(), 'torn down on the failing outcome too').toBe(0)
    expect(dom.made[0]?.srcObject).toBeNull()
    expect(dom.stop, 'the caller owns the tracks: the one catch releases them').not.toHaveBeenCalled()
  })

  it('a track that has already ended is not waited for: it resolves at once, with no element made and no timer pending (T-124 (1))', async () => {
    vi.useFakeTimers()
    const dom = setup(true)
    dom.track.readyState = 'ended'
    await waitForFirstPicture(dom.stream)
    expect(dom.made, 'nothing was mounted for a source that is gone').toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a track that ends during the wait resolves it at once, leaves no <video>, and no timer or listener is left to fire later', async () => {
    vi.useFakeTimers()
    const dom = setup(true)
    const done = settle(waitForFirstPicture(dom.stream))
    await vi.advanceTimersByTimeAsync(3_000)
    expect(dom.attached(), 'still waiting for a live track').toBe(1)
    dom.track.readyState = 'ended'
    dom.track.dispatchEvent(new Event('ended'))
    expect(await done, 'the end of the source is no "sent no picture"').toBeNull()
    expect(dom.attached()).toBe(0)
    expect(vi.getTimerCount(), 'the limit was cleared').toBe(0)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(dom.stop).not.toHaveBeenCalled()
  })

  it('control: a live track that sends nothing is still the 10 s sentence', async () => {
    vi.useFakeTimers()
    const dom = setup(true)
    const done = settle(waitForFirstPicture(dom.stream))
    await vi.advanceTimersByTimeAsync(10_001)
    expect(await done).toBeInstanceOf(NoPictureError)
  })
})
