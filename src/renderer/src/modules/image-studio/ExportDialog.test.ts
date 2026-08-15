import { describe, it, expect } from 'vitest'
import { captureDocument, defaultExportScale } from './ExportDialog'

/**
 * Resolution-fragility regression: previously the ExportDialog defaulted
 * to scale=1 regardless of the user's monitor DPR. On a 4K monitor at
 * 200% Windows scaling, devicePixelRatio is 2 — meaning the canvas the
 * user SEES at 1× is internally rendered at 2× — and yet the default
 * export was 1×, producing a half-size PNG relative to what they saw on
 * screen. This helper picks a sensible scale per DPR; the picker still
 * lets the user override.
 */
describe('defaultExportScale', () => {
  it('returns 1× on standard 1080p monitors (DPR 1.0)', () => {
    expect(defaultExportScale(1)).toBe(1)
  })

  it('returns 1× on slightly-scaled 1440p (DPR ~1.25-1.5)', () => {
    expect(defaultExportScale(1.25)).toBe(1)
    expect(defaultExportScale(1.5)).toBe(1)
  })

  it('returns 2× on common 4K-at-200% setups (DPR ~1.75-2.4)', () => {
    expect(defaultExportScale(1.75)).toBe(2)
    expect(defaultExportScale(2)).toBe(2)
    expect(defaultExportScale(2.4)).toBe(2)
  })

  it('returns 3× on extreme HiDPI displays (DPR ≥ 2.5)', () => {
    expect(defaultExportScale(2.5)).toBe(3)
    expect(defaultExportScale(3)).toBe(3)
    expect(defaultExportScale(4)).toBe(3)
  })

  it('defends against invalid DPR inputs by defaulting to 1', () => {
    expect(defaultExportScale(0)).toBe(1)
    expect(defaultExportScale(-1)).toBe(1)
    expect(defaultExportScale(NaN)).toBe(1)
    expect(defaultExportScale(Infinity)).toBe(1)
  })
})

/**
 * T-45 regression (BUG-EXPORT-ZOOM / BUG-EMOTE-SIZES). The on-screen stage is
 * scaled to fit its container, so a capture taken off the live stage rendered
 * `doc.width * fitZoom` pixels — the export was the size of the WINDOW, and
 * the emote pack's "28 / 56 / 112" filenames sat on 112 / 224 / 448 bytes.
 * `captureDocument` neutralises the zoom and pins the capture box to the
 * document, so the size the label promises is the size Konva is asked for.
 *
 * The real-pixel proof is `tests/e2e/image.spec.ts` (PNG header dimensions off
 * bytes on disk, at two window sizes). These cover the contract this helper
 * owns: what Konva is handed, and that the on-screen zoom survives the trip.
 */
describe('captureDocument', () => {
  interface Call {
    mimeType?: string
    quality?: number
    pixelRatio?: number
    width?: number
    height?: number
  }

  /** A stage at an arbitrary fit-to-container zoom, recording what it is asked. */
  function fakeStage(zoom: number, onCapture?: () => void) {
    const calls: Call[] = []
    const scaleSeen: number[] = []
    let scale = { x: zoom, y: zoom }
    return {
      calls,
      scaleSeen,
      get scale$() {
        return scale
      },
      stage: {
        scaleX: () => scale.x,
        scaleY: () => scale.y,
        scale: (value: { x: number; y: number }) => {
          scale = value
        },
        toDataURL: (opts: Call) => {
          calls.push(opts)
          scaleSeen.push(scale.x)
          onCapture?.()
          return 'data:image/png;base64,AA=='
        }
      }
    }
  }

  it('asks for the document box, never the zoomed stage', () => {
    const f = fakeStage(0.746875) // 1280-wide doc fitted into a ~956px container
    const url = captureDocument(f.stage, 1280, 720, {
      mimeType: 'image/png',
      quality: 0.92,
      pixelRatio: 1
    })
    expect(url).toBe('data:image/png;base64,AA==')
    expect(f.calls).toEqual([
      { mimeType: 'image/png', quality: 0.92, pixelRatio: 1, width: 1280, height: 720 }
    ])
  })

  it('renders with the stage zoom neutralised, and puts it back afterwards', () => {
    const f = fakeStage(4) // the emote doc, pinned to the 4x zoom cap
    captureDocument(f.stage, 112, 112, {
      mimeType: 'image/png',
      quality: 0.92,
      pixelRatio: 0.25
    })
    // Konva multiplies width by pixelRatio, so the capture is 112 * 0.25 = 28
    // exactly — the zoom is not in the arithmetic at all.
    expect(f.scaleSeen).toEqual([1])
    expect(f.scale$).toEqual({ x: 4, y: 4 })
  })

  it('restores the zoom even when the capture throws', () => {
    const f = fakeStage(2.5, () => {
      throw new Error('canvas is tainted')
    })
    expect(() =>
      captureDocument(f.stage, 1200, 480, {
        mimeType: 'image/jpeg',
        quality: 0.5,
        pixelRatio: 2
      })
    ).toThrow('canvas is tainted')
    expect(f.scale$).toEqual({ x: 2.5, y: 2.5 })
  })

  it('emits the emote trio at exactly 28, 56 and 112 device pixels', () => {
    const f = fakeStage(4)
    for (const size of [28, 56, 112]) {
      captureDocument(f.stage, 112, 112, {
        mimeType: 'image/png',
        quality: 0.92,
        pixelRatio: size / 112
      })
    }
    // What Konva will allocate: width * pixelRatio, integer for integer.
    expect(f.calls.map((c) => (c.width ?? 0) * (c.pixelRatio ?? 0))).toEqual([28, 56, 112])
    expect(f.calls.map((c) => (c.height ?? 0) * (c.pixelRatio ?? 0))).toEqual([28, 56, 112])
  })
})
