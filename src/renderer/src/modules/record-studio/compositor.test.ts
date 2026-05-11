import { describe, it, expect } from 'vitest'
import { computeCornerRect, drawFrame } from './compositor'

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
