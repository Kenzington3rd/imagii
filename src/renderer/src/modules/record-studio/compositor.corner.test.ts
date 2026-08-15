import { describe, it, expect } from 'vitest'
import { computeCornerRect, drawFrame } from './compositor'

/**
 * T-27: the corner-math branches `compositor.test.ts` does not reach.
 *
 * The existing suite covers the four corners at 1920x1080, the 64 px width
 * clamp, the input assertions, and the negative-margin clamp. Everything
 * below is a branch or an edge that file never executes, found by walking
 * `computeCornerRect` and `drawFrame` line by line against it:
 *
 *   - `drawFrame`'s `camRatio > boxRatio` arm. Both existing draw tests take
 *     the `else` arm (16:9 cam in a 16:9 box, then a 3:4 cam in a 4:3 box),
 *     so the "cam is WIDER than the box, fit by width and letterbox
 *     vertically" half of the aspect-preserve logic — including its own dy
 *     centering — has never run.
 *   - `drawFrame`'s webcam-not-ready guard. The existing skip test passes
 *     `null`; the `webcam.readyState < 2` half of the same condition is a
 *     different branch and it is the one that actually fires in production,
 *     during the first frames after the camera stream is attached.
 *   - `drawFrame`'s `videoWidth || 16` / `videoHeight || 9` fallback, which
 *     is what stops a division by zero when a camera reports dimensions of 0.
 *   - `computeCornerRect` on canvases small enough that the 64 px clamp
 *     pushes the rect off the left/top edge, at `scalePct` exactly 1 (the
 *     inclusive end of the asserted range), on a portrait canvas, and at a
 *     width where both roundings are .5 cases.
 *
 * These are pins on current behavior, not proposals: two of them (the
 * off-canvas rect and the full-bleed rect at scalePct 1) record that the
 * function does NOT clamp its output into the canvas, which is the fact a
 * future clamp would have to change deliberately.
 */

interface DrawCall {
  image: 'screen' | 'webcam'
  x: number
  y: number
  w: number
  h: number
}

function makeStubCtx(): { ctx: CanvasRenderingContext2D; calls: DrawCall[] } {
  const calls: DrawCall[] = []
  const ctx = {
    drawImage: (img: { tag: 'screen' | 'webcam' }, x: number, y: number, w: number, h: number) => {
      calls.push({ image: img.tag, x, y, w, h })
    }
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

function makeStubVideo(
  tag: 'screen' | 'webcam',
  w: number,
  h: number,
  readyState = 4
): HTMLVideoElement {
  return { tag, readyState, videoWidth: w, videoHeight: h } as unknown as HTMLVideoElement
}

describe('computeCornerRect — edges the base suite does not reach', () => {
  it('lets the clamped webcam hang off the left edge on a tiny canvas', () => {
    // 80x80 at 20% is 16 px, so the 64 px minimum kicks in — and 64 + 32 of
    // margin is wider than the canvas itself. The function returns the rect
    // it was asked for rather than clamping into bounds, so x goes negative
    // and the webcam is drawn partly off-canvas. Pinned because a future
    // in-bounds clamp must change this number on purpose.
    const r = computeCornerRect(80, 80, 'bottom-right', 0.2, 32)
    expect(r.w).toBe(64)
    expect(r.h).toBe(36)
    expect(r.x).toBe(-16)
    expect(r.y).toBe(12)
  })

  it('does not clamp at scalePct 1 either — the cam covers the whole canvas', () => {
    // scalePct 1 is the inclusive top of the asserted (0, 1] range, so this
    // is a legal call. The cam box becomes the full canvas width and both
    // offsets go negative by exactly the margin.
    const r = computeCornerRect(1920, 1080, 'bottom-right', 1, 32)
    expect(r.w).toBe(1920)
    expect(r.h).toBe(1080)
    expect(r.x).toBe(-32)
    expect(r.y).toBe(-32)
  })

  it('keeps the cam box landscape on a portrait canvas', () => {
    // Height never enters the box math: the box is always 16:9 off the
    // canvas WIDTH. On a 1080x1920 phone-shaped capture that is a 216x122
    // box, not a portrait one.
    const r = computeCornerRect(1080, 1920, 'top-right', 0.2, 32)
    expect(r.w).toBe(216)
    expect(r.h).toBe(122)
    expect(r.x).toBe(1080 - 216 - 32)
    expect(r.y).toBe(32)
  })

  it('rounds both dimensions half-up on a width that is not a round multiple', () => {
    // 1366 (the most common cheap-laptop width) at 20% is 273.2 -> 273, and
    // 273 * 9/16 is 153.5625 -> 154. Neither is exact, so this pins the
    // rounding direction of both Math.round calls at once.
    const r = computeCornerRect(1366, 768, 'bottom-left', 0.2, 16)
    expect(r.w).toBe(273)
    expect(r.h).toBe(154)
    expect(r.x).toBe(16)
    expect(r.y).toBe(768 - 154 - 16)
  })

  it('takes the un-clamped path when the scaled width lands exactly on 64', () => {
    // 320 * 0.2 === 64, the exact boundary of Math.max(64, ...). One px
    // narrower and the clamp is what produces the 64.
    expect(computeCornerRect(320, 180, 'top-left', 0.2, 0).w).toBe(64)
    expect(computeCornerRect(319, 180, 'top-left', 0.2, 0).w).toBe(64)
    expect(computeCornerRect(321, 180, 'top-left', 0.2, 0).w).toBe(64)
    expect(computeCornerRect(325, 180, 'top-left', 0.2, 0).w).toBe(65)
  })
})

describe('drawFrame — the aspect arm and the guards the base suite does not reach', () => {
  it('fits a cam WIDER than its box by width and centres it vertically', () => {
    // camRatio (16:9 = 1.778) > boxRatio (1:1), the arm the base suite never
    // enters. drawH shrinks to 56 and the 44 px of slack is split top/bottom.
    const { ctx, calls } = makeStubCtx()
    const screen = makeStubVideo('screen', 1920, 1080)
    const webcam = makeStubVideo('webcam', 1920, 1080)
    drawFrame(ctx, screen, webcam, { x: 30, y: 40, w: 100, h: 100 }, 1920, 1080)
    expect(calls.length).toBe(2)
    expect(calls[1]).toEqual({ image: 'webcam', x: 30, y: 62, w: 100, h: 56 })
  })

  it('skips a webcam that has not decoded a frame yet', () => {
    // readyState 1 is HAVE_METADATA: dimensions are known but no frame is
    // available, and drawImage on it would throw or paint garbage. This is
    // the real first-frames state, distinct from the null-webcam case the
    // base suite covers.
    const { ctx, calls } = makeStubCtx()
    const screen = makeStubVideo('screen', 1920, 1080)
    const webcam = makeStubVideo('webcam', 1280, 720, 1)
    drawFrame(ctx, screen, webcam, { x: 0, y: 0, w: 384, h: 216 }, 1920, 1080)
    expect(calls.length).toBe(1)
    expect(calls[0]?.image).toBe('screen')
  })

  it('draws nothing at all when neither input is ready', () => {
    // The first rAF ticks fire before either stream has decoded. A frame
    // that draws nothing is correct; a frame that throws would kill the
    // whole compositor loop.
    const { ctx, calls } = makeStubCtx()
    const screen = makeStubVideo('screen', 1920, 1080, 0)
    const webcam = makeStubVideo('webcam', 1280, 720, 0)
    expect(() =>
      drawFrame(ctx, screen, webcam, { x: 0, y: 0, w: 384, h: 216 }, 1920, 1080)
    ).not.toThrow()
    expect(calls.length).toBe(0)
  })

  it('falls back to 16:9 when the camera reports zero dimensions', () => {
    // A camera that is ready but reports 0x0 would make camRatio NaN and put
    // NaN into drawImage. The `|| 16` / `|| 9` fallback is what keeps the
    // rect finite; without it every number below would be NaN.
    const { ctx, calls } = makeStubCtx()
    const screen = makeStubVideo('screen', 1920, 1080)
    const webcam = makeStubVideo('webcam', 0, 0)
    drawFrame(ctx, screen, webcam, { x: 0, y: 0, w: 200, h: 200 }, 1920, 1080)
    expect(calls.length).toBe(2)
    const cam = calls[1]
    expect(cam).toEqual({ image: 'webcam', x: 0, y: 44, w: 200, h: 113 })
    expect(Number.isFinite(cam?.w)).toBe(true)
    expect(Number.isFinite(cam?.h)).toBe(true)
  })

  it('draws the screen at canvas size even when that differs from its natural size', () => {
    // The canvas is sized from the screen video at startup, but the rAF loop
    // re-reads canvasW/canvasH every frame while the video element keeps its
    // own intrinsic size. This pins that the screen is stretched to the
    // CANVAS, not blitted at its natural resolution.
    const { ctx, calls } = makeStubCtx()
    const screen = makeStubVideo('screen', 3840, 2160)
    drawFrame(ctx, screen, null, { x: 0, y: 0, w: 100, h: 100 }, 1280, 720)
    expect(calls[0]).toEqual({ image: 'screen', x: 0, y: 0, w: 1280, h: 720 })
  })
})
