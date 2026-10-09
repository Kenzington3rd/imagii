import { describe, it, expect } from 'vitest'
import {
  captureDocument,
  defaultExportScale,
  outputPixels,
  thumbnailSizeNote
} from './ExportDialog'

/**
 * Resolution-fragility regression: previously the ExportDialog defaulted
 * to scale=1 regardless of the user's monitor DPR, so a 4K-at-200% user
 * (devicePixelRatio 2) got a file with half the pixels their own screen
 * can show and every thumbnail preview looked soft. Since T-45 the export
 * is the document, not the canvas, so the multiplier is purely about the
 * crispness of the deliverable; this helper picks it per DPR and the
 * picker still lets the user override.
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
 * T-53 regression. The same capture also drew the EDITOR: Konva paints every
 * visible stage layer, and Canvas.tsx keeps the grid and the Transformer in
 * layers of their own, so a shape being selected (or Grid being checked) put
 * the app's own handles and gridlines into the exported PNG. The layers are
 * tagged `chrome`; `captureDocument` switches those off for the capture and
 * restores each one's PRIOR flag.
 *
 * The real-pixel proof is `tests/e2e/image.spec.ts` (PNG header dimensions off
 * bytes on disk at two window sizes; the same document exported four ways —
 * deselected/grid-off, grid on, selected, both — compared byte for byte).
 * These cover the contract this helper owns: what Konva is handed, which
 * layers are drawing when it is handed it, and that the on-screen zoom and
 * every layer flag survive the trip.
 */
describe('captureDocument', () => {
  interface Call {
    mimeType?: string
    quality?: number
    pixelRatio?: number
    width?: number
    height?: number
  }

  /**
   * A stage layer carrying whatever Konva `name` Canvas.tsx gave it. Editor
   * chrome is tagged `chrome` (`"grid chrome"`, `"overlay chrome"`); the
   * document layer carries no name. Konva matches names by whitespace-
   * separated token, which `hasName` mirrors here.
   */
  class FakeLayer {
    shown: boolean
    constructor(
      readonly names: string,
      shown = true
    ) {
      this.shown = shown
    }
    hasName(name: string): boolean {
      return this.names.split(' ').includes(name)
    }
    visible(): boolean
    visible(value: boolean): void
    visible(value?: boolean): boolean | void {
      if (value === undefined) return this.shown
      this.shown = value
    }
  }

  /**
   * A node inside the document layer (T-91): a shape carrying whatever Konva
   * `name` Canvas.tsx gave it — `hint` for a hint layer, nothing otherwise.
   */
  class FakeNode {
    shown: boolean
    constructor(
      readonly label: string,
      readonly names: string,
      shown = true
    ) {
      this.shown = shown
    }
    visible(): boolean
    visible(value: boolean): void
    visible(value?: boolean): boolean | void {
      if (value === undefined) return this.shown
      this.shown = value
    }
  }

  const PNG_1PX = 'data:image/png;base64,AA=='
  const PNG_OPTS = { mimeType: 'image/png', quality: 0.92, pixelRatio: 1 }

  /** A stage at an arbitrary fit-to-container zoom, recording what it is asked. */
  function fakeStage(
    zoom: number,
    opts: { layers?: FakeLayer[]; nodes?: FakeNode[]; onCapture?: () => void } = {}
  ) {
    const layers = opts.layers ?? []
    const nodes = opts.nodes ?? []
    const calls: Call[] = []
    const scaleSeen: number[] = []
    /** The layers still switched on at the moment Konva was asked to draw. */
    const drawnAtCapture: string[][] = []
    /** The document-layer nodes still switched on at that moment. */
    const nodesAtCapture: string[][] = []
    const selectors: string[] = []
    let scale = { x: zoom, y: zoom }
    return {
      calls,
      scaleSeen,
      drawnAtCapture,
      nodesAtCapture,
      selectors,
      get scale$() {
        return scale
      },
      stage: {
        scaleX: () => scale.x,
        scaleY: () => scale.y,
        scale: (value: { x: number; y: number }) => {
          scale = value
        },
        getLayers: () => layers,
        // Konva's selector search, reduced to the one form the export uses:
        // `.name` matches a node carrying that name TOKEN.
        find: (selector: string) => {
          selectors.push(selector)
          const wanted = selector.startsWith('.') ? selector.slice(1) : '\u0000'
          return nodes.filter((n) => n.names.split(' ').includes(wanted))
        },
        toDataURL: (callOpts: Call) => {
          calls.push(callOpts)
          scaleSeen.push(scale.x)
          drawnAtCapture.push(layers.filter((l) => l.visible()).map((l) => l.names))
          nodesAtCapture.push(nodes.filter((n) => n.visible()).map((n) => n.label))
          opts.onCapture?.()
          return PNG_1PX
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
    const f = fakeStage(2.5, {
      onCapture: () => {
        throw new Error('canvas is tainted')
      }
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

  // ── T-53: the editor's own layers must not reach the file ────────────────

  it('draws the document with the chrome layers switched off', () => {
    const f = fakeStage(1, {
      layers: [
        new FakeLayer(''), // the document layer, unnamed
        new FakeLayer('grid chrome'),
        new FakeLayer('overlay chrome'),
        // Matching is by whole name token, as Konva's own `hasName` is: a
        // layer that merely CONTAINS the word is not editor chrome.
        new FakeLayer('chromecast-preview')
      ]
    })
    captureDocument(f.stage, 1280, 720, PNG_OPTS)
    expect(f.drawnAtCapture).toEqual([['', 'chromecast-preview']])
  })

  it('puts every layer back the way it found it, including ones already off', () => {
    // "Restore" means each layer's PRIOR flag, never a blanket show-all: a
    // layer that was already switched off has to stay that way.
    const doc = new FakeLayer('', false)
    const grid = new FakeLayer('grid chrome', false)
    const overlay = new FakeLayer('overlay chrome', true)
    const f = fakeStage(1, { layers: [doc, grid, overlay] })
    captureDocument(f.stage, 1280, 720, PNG_OPTS)
    // Nothing was drawing, and nothing came back on that was not on before.
    expect(f.drawnAtCapture).toEqual([[]])
    expect([doc.visible(), grid.visible(), overlay.visible()]).toEqual([false, false, true])
  })

  it('restores the chrome even when the capture throws', () => {
    const grid = new FakeLayer('grid chrome')
    const overlay = new FakeLayer('overlay chrome')
    const f = fakeStage(2.5, {
      layers: [new FakeLayer(''), grid, overlay],
      onCapture: () => {
        throw new Error('canvas is tainted')
      }
    })
    expect(() => captureDocument(f.stage, 1280, 720, PNG_OPTS)).toThrow('canvas is tainted')
    expect([grid.visible(), overlay.visible()]).toEqual([true, true])
    expect(f.scale$).toEqual({ x: 2.5, y: 2.5 })
  })

  it('leaves the chrome up between the three captures of an emote pack', () => {
    const grid = new FakeLayer('grid chrome')
    const overlay = new FakeLayer('overlay chrome')
    const f = fakeStage(4, { layers: [new FakeLayer(''), grid, overlay] })
    for (const size of [28, 56, 112]) {
      expect([grid.visible(), overlay.visible()]).toEqual([true, true])
      captureDocument(f.stage, 112, 112, { ...PNG_OPTS, pixelRatio: size / 112 })
    }
    expect(f.drawnAtCapture).toEqual([[''], [''], ['']])
    expect([grid.visible(), overlay.visible()]).toEqual([true, true])
  })

  // ── T-91: hint layers stay on the canvas and out of the file ─────────────

  const hintNodes = (): FakeNode[] => [
    new FakeNode('Title', ''),
    new FakeNode('Face placeholder', 'hint'),
    new FakeNode('Face hint', 'hint'),
    new FakeNode('Accent bar', ''),
    // A name that merely CONTAINS the word is not a hint (whole-token match,
    // as Konva's own selector does).
    new FakeNode('Hinterland', 'hinterland')
  ]

  it('draws the document without its hint nodes', () => {
    const f = fakeStage(1, { nodes: hintNodes() })
    captureDocument(f.stage, 1280, 720, PNG_OPTS)
    expect(f.selectors).toEqual(['.hint'])
    expect(f.nodesAtCapture).toEqual([['Title', 'Accent bar', 'Hinterland']])
  })

  it('puts every hint node back the way it found it, including one already off', () => {
    const nodes = hintNodes()
    const alreadyOff = new FakeNode('Handle', 'hint', false)
    const f = fakeStage(1, { nodes: [...nodes, alreadyOff] })
    captureDocument(f.stage, 1280, 720, PNG_OPTS)
    expect(nodes.map((n) => n.visible())).toEqual([true, true, true, true, true])
    // "Restore" is each node's PRIOR flag: a hidden layer stays hidden.
    expect(alreadyOff.visible()).toBe(false)
  })

  it('restores the hint nodes even when the capture throws', () => {
    const nodes = hintNodes()
    const f = fakeStage(2.5, {
      nodes,
      onCapture: () => {
        throw new Error('canvas is tainted')
      }
    })
    expect(() => captureDocument(f.stage, 1280, 720, PNG_OPTS)).toThrow('canvas is tainted')
    expect(nodes.every((n) => n.visible())).toBe(true)
    expect(f.scale$).toEqual({ x: 2.5, y: 2.5 })
  })

  it('hides chrome layers and hint nodes together, and the emote pack captures all three times without them', () => {
    const grid = new FakeLayer('grid chrome')
    const nodes = hintNodes()
    const f = fakeStage(4, { layers: [new FakeLayer(''), grid], nodes })
    for (const size of [28, 56, 112]) {
      captureDocument(f.stage, 112, 112, { ...PNG_OPTS, pixelRatio: size / 112 })
    }
    expect(f.drawnAtCapture).toEqual([[''], [''], ['']])
    expect(f.nodesAtCapture).toEqual(Array(3).fill(['Title', 'Accent bar', 'Hinterland']))
    expect(grid.visible()).toBe(true)
    expect(nodes.every((n) => n.visible())).toBe(true)
  })
})

/**
 * T-91: the readout beside Scale. It is a measurement of the file, so it floors
 * exactly as Konva's output canvas does (width * pixelRatio, truncated).
 */
describe('outputPixels', () => {
  it('is the document times the scale', () => {
    expect(outputPixels(1280, 720, 1)).toEqual({ width: 1280, height: 720 })
    expect(outputPixels(1280, 720, 2)).toEqual({ width: 2560, height: 1440 })
    expect(outputPixels(1280, 720, 3)).toEqual({ width: 3840, height: 2160 })
    expect(outputPixels(1280, 720, 0.5)).toEqual({ width: 640, height: 360 })
  })

  it('truncates a fractional size the way the capture does', () => {
    expect(outputPixels(1201, 801, 0.5)).toEqual({ width: 600, height: 400 })
    expect(outputPixels(1, 1, 0.5)).toEqual({ width: 0, height: 0 })
  })

  it('the picker\'s default on a HiDPI screen is what the readout warns about', () => {
    const scale = defaultExportScale(2)
    expect(outputPixels(1280, 720, scale)).toEqual({ width: 2560, height: 1440 })
  })
})

describe('thumbnailSizeNote', () => {
  const NOTE = "Bigger than YouTube's thumbnail size (1280x720)."

  it('stays quiet at YouTube\'s own size and below', () => {
    expect(thumbnailSizeNote(1280, 720, false)).toBeNull()
    expect(thumbnailSizeNote(640, 360, false)).toBeNull()
  })

  it('speaks up for a 16:9 export that is bigger', () => {
    expect(thumbnailSizeNote(2560, 1440, false)).toBe(NOTE)
    expect(thumbnailSizeNote(3840, 2160, false)).toBe(NOTE)
    expect(thumbnailSizeNote(1920, 1080, false)).toBe(NOTE)
  })

  it('stays quiet for a shape that is not a thumbnail: square, vertical, wide banner', () => {
    expect(thumbnailSizeNote(1080, 1080, false)).toBeNull()
    expect(thumbnailSizeNote(1080, 1920, false)).toBeNull()
    expect(thumbnailSizeNote(2560, 423, false)).toBeNull()
  })

  it('stays quiet for a transparent document — that is a stream overlay, not a thumbnail', () => {
    expect(thumbnailSizeNote(1920, 1080, true)).toBeNull()
  })

  it('does not divide by zero', () => {
    expect(thumbnailSizeNote(0, 0, false)).toBeNull()
  })
})
