import { describe, it, expect, beforeEach } from 'vitest'
import { asHint, displayOpacity, type CanvasDocument, type LayerType, type TextLayer } from '@shared/canvas'
import { applyLayerPatch, keepsRatioOnCornerDrag, makeImageLayer, makeReferenceLayer, makeTextLayer, textLayerFor, useCanvasStore } from './canvasStore'
import { CANVAS_TEMPLATES } from '../templates'
import { ASSET_CATALOG } from '../../references/assetCatalog'
import { contrastRatio, estimatedTextBox } from '@shared/newText'
import { BG_BASE, INK_BASE } from '../../../styles/tokens'

/**
 * T-91 — a hint layer is guidance that never exports, and the one thing that
 * must NOT happen is a user's own words being treated as guidance. "@yourhandle"
 * is a placeholder until somebody types their handle over it; after that an
 * export that dropped it would ship a graphic missing the one thing they filled
 * in. So retyping a hint text layer clears the flag.
 */

const hintText = (): TextLayer => asHint({ ...makeTextLayer(10, 10, '@yourhandle'), name: 'Handle' })

describe('applyLayerPatch', () => {
  it('merges a patch the way the store always did', () => {
    const next = applyLayerPatch(hintText(), { x: 99 })
    expect(next).toMatchObject({ x: 99, text: '@yourhandle' })
  })

  it('moving, resizing or restyling a hint keeps it a hint — only its words matter', () => {
    const t = hintText()
    for (const patch of [{ x: 5 }, { y: 6 }, { fontSize: 99 }, { fill: '#fff' }, { rotation: 10 }, { opacity: 0.5 }]) {
      expect(applyLayerPatch(t, patch).hint, JSON.stringify(patch)).toBe(true)
    }
  })

  it('typing different words over a hint text clears the flag, so the export keeps what the user wrote', () => {
    const next = applyLayerPatch(hintText(), { text: '@makenah' } as Partial<TextLayer>)
    expect(next.hint).toBe(false)
    expect((next as TextLayer).text).toBe('@makenah')
  })

  // T-112: the canvas draws a hint's words dimmed; the layer's own opacity is data and stays.
  it('the dim is display only: the stored opacity is untouched, and retyping brings full strength back', () => {
    const t = hintText()
    expect(displayOpacity(t)).toBe(0.4)
    expect(t.opacity).toBe(1)
    const retyped = applyLayerPatch(t, { text: '@makenah' } as Partial<TextLayer>)
    expect(retyped.opacity).toBe(1)
    expect(displayOpacity(retyped)).toBe(1)
  })

  it('"editing" a hint to the same words is not an edit', () => {
    expect(applyLayerPatch(hintText(), { text: '@yourhandle' } as Partial<TextLayer>).hint).toBe(true)
  })

  it('a layer that was never a hint is untouched by the rule', () => {
    const plain = makeTextLayer(0, 0, 'Title')
    const next = applyLayerPatch(plain, { text: 'New title' } as Partial<TextLayer>)
    expect('hint' in next).toBe(false)
  })
})

describe('makeReferenceLayer', () => {
  it('is a 40%-opacity picture named for the board item, flagged as a hint', () => {
    const l = makeReferenceLayer('data:image/png;base64,AAAA', 300, 200, 'x'.repeat(80))
    expect(l).toMatchObject({ type: 'image', opacity: 0.4, hint: true, width: 300, height: 200 })
    expect(l.name).toHaveLength(40)
  })
})

describe('through the store', () => {
  beforeEach(() => {
    const doc: CanvasDocument = { width: 400, height: 300, background: '#000000', layers: [] }
    useCanvasStore.getState().resetDocument(doc)
  })

  it('addLayer then retyping clears the hint, and undo brings the placeholder (and its flag) back', () => {
    const s = useCanvasStore.getState()
    const t = hintText()
    s.addLayer(t)
    s.updateLayer(t.id, { text: '@makenah' } as Partial<TextLayer>)
    expect(useCanvasStore.getState().doc.layers[0]?.hint).toBe(false)
    useCanvasStore.getState().undo()
    expect(useCanvasStore.getState().doc.layers[0]?.hint).toBe(true)
  })

  it('a duplicate of a hint is still a hint until its words change', () => {
    const s = useCanvasStore.getState()
    const t = hintText()
    s.addLayer(t)
    s.duplicateLayer(t.id)
    const [, copy] = useCanvasStore.getState().doc.layers
    expect(copy?.hint).toBe(true)
    useCanvasStore.getState().updateLayer(copy?.id ?? '', { text: 'mine' } as Partial<TextLayer>)
    expect(useCanvasStore.getState().doc.layers[1]?.hint).toBe(false)
    expect(useCanvasStore.getState().doc.layers[0]?.hint).toBe(true)
  })

  it('a layer carries its hint flag through JSON — a saved project keeps it', () => {
    const t = hintText()
    const round = JSON.parse(JSON.stringify(t)) as TextLayer
    expect(round.hint).toBe(true)
  })
})

// T-139 (2): where a picture's layer starts is the caller's (`placementFor` in `@shared/imageBounds` works it out for the document); with none given it is the
// 60 px in from the corner it has always been.
describe('makeImageLayer and makeReferenceLayer - the position of a first placement (T-139 (2))', () => {
  it('starts 60 px in from the corner unless it is told where', () => {
    expect(makeImageLayer('data:image/png;base64,AAAA', 300, 200)).toMatchObject({ x: 60, y: 60, width: 300, height: 200, scaleX: 1, scaleY: 1 })
    expect(makeReferenceLayer('data:image/png;base64,AAAA', 300, 200, 'ref')).toMatchObject({ x: 60, y: 60 })
  })

  it('takes a position, and a reference layer takes the same one', () => {
    expect(makeImageLayer('data:image/png;base64,AAAA', 112, 112, 0, 0)).toMatchObject({ x: 0, y: 0, width: 112, height: 112 })
    expect(makeImageLayer('data:image/png;base64,AAAA', 120, 480, 60, 0)).toMatchObject({ x: 60, y: 0 })
    const ref = makeReferenceLayer('data:image/png;base64,AAAA', 112, 112, 'ref', 0, 0)
    expect(ref).toMatchObject({ type: 'image', x: 0, y: 0, opacity: 0.4, hint: true })
  })

  it('a position of 0 is a position, not "none given"', () => {
    const l = makeImageLayer('data:image/png;base64,AAAA', 10, 10, 0, 0)
    expect([l.x, l.y]).toEqual([0, 0])
  })
})

// T-140 (2): "+ Add text" used to be `makeTextLayer(120, 120)` - 32 px `BG_BASE` text at a fixed point, whatever the document. `textLayerFor(doc)` is the layer
// that belongs on the document that is open: sized to it, inside it, inked against its background (the rules are `@shared/newText`; this is the wiring, held
// over every document the app can put on the canvas).
describe('textLayerFor - a new text layer for the open document (T-140 (2))', () => {
  const documents: Array<[string, CanvasDocument]> = [
    ['the default blank page', { width: 1200, height: 800, background: '#ffffff', layers: [] }],
    ...CANVAS_TEMPLATES.map((t): [string, CanvasDocument] => [`template ${t.id}`, t.doc]),
    ...ASSET_CATALOG.map((a): [string, CanvasDocument] => [`asset ${a.id}`, a.doc])
  ]

  it('covers every template and every asset the app can open', () => {
    expect(documents.length).toBe(1 + CANVAS_TEMPLATES.length + ASSET_CATALOG.length)
    expect(CANVAS_TEMPLATES.length).toBeGreaterThan(10)
    // The two ends the rule has to tell apart are both in the list: a white page and a transparent / near-black one.
    const backgrounds = new Set(documents.map(([, d]) => d.background))
    expect(backgrounds.has('#ffffff')).toBe(true)
    expect(backgrounds.has('transparent')).toBe(true)
    expect(backgrounds.has('#241614')).toBe(true)
  })

  for (const [name, doc] of documents) {
    it(`${name} (${doc.width}x${doc.height}, ${doc.background}): the text is wholly inside it and its color is 4.5:1 against what the document shows`, () => {
      const t = textLayerFor(doc)
      const box = estimatedTextBox(t.text, t.fontSize)
      expect(t.type).toBe('text')
      expect(t.text).toBe('Text')
      expect(t.x, 'left').toBeGreaterThanOrEqual(0)
      expect(t.y, 'top').toBeGreaterThanOrEqual(0)
      expect(t.x + box.width, 'right').toBeLessThanOrEqual(doc.width)
      expect(t.y + box.height, 'bottom').toBeLessThanOrEqual(doc.height)
      // A transparent document is the dark workspace (and most scenes) behind it.
      const surface = doc.background === 'transparent' ? BG_BASE : doc.background
      expect(t.fill).not.toBe(surface)
      expect(contrastRatio(t.fill, surface), `${t.fill} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      // The color is a token, never a literal of its own.
      expect([BG_BASE, INK_BASE]).toContain(t.fill)
    })
  }

  it('the default blank page keeps the look it always had: 32 px BG_BASE text, now 60 px in from the corner', () => {
    expect(textLayerFor({ width: 1200, height: 800, background: '#ffffff' })).toMatchObject({ fontSize: 32, fill: BG_BASE, x: 60, y: 60 })
  })

  it('the emote and the 4K overlay take the light ink, and the 4K overlay\'s text is bigger than the 32 px speck it was', () => {
    const emote = CANVAS_TEMPLATES.find((t) => t.id === 'emote-blank-112')
    const overlay4k = CANVAS_TEMPLATES.find((t) => t.id === 'tw-overlay-streamer-4k')
    expect(emote && overlay4k).toBeTruthy()
    expect(textLayerFor((emote as { doc: CanvasDocument }).doc).fill).toBe(INK_BASE)
    const big = textLayerFor((overlay4k as { doc: CanvasDocument }).doc)
    expect(big.fill).toBe(INK_BASE)
    expect(big.fontSize).toBeGreaterThan(32)
  })

  it('is a text layer like makeTextLayer\'s: same shape, a fresh id, visible and unlocked, no hint flag (what the person typed is theirs)', () => {
    const a = textLayerFor({ width: 112, height: 112, background: 'transparent' })
    const b = textLayerFor({ width: 112, height: 112, background: 'transparent' })
    expect(a.id).not.toBe(b.id)
    expect(a).toMatchObject({ name: 'Text', visible: true, locked: false, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fontFamily: 'Inter, sans-serif' })
    expect('hint' in a).toBe(false)
  })

  it('makeTextLayer is what it was for its other callers: the position it is given, 32 px, BG_BASE', () => {
    expect(makeTextLayer(10, 20)).toMatchObject({ x: 10, y: 20, fontSize: 32, fill: BG_BASE, text: 'Text' })
  })
})

// T-140 (4): the empty screen says "Pick a template to start ... or start blank". The store kept the template's size and background when its last layer was removed, so
// "start blank" put the picture on the 112x112 emote and Export wrote the emote pack. An empty document IS the blank page.
describe('removing the last layer - the empty screen starts blank (T-140 (4))', () => {
  const emote = (): CanvasDocument => {
    const t = CANVAS_TEMPLATES.find((c) => c.id === 'emote-text')
    if (!t) throw new Error('emote-text is gone from templates.ts')
    return JSON.parse(JSON.stringify(t.doc)) as CanvasDocument
  }

  beforeEach(() => {
    useCanvasStore.getState().resetDocument()
  })

  it('a template\'s last layer going leaves the default blank document: 1200x800, white, no layers', () => {
    const s = useCanvasStore.getState()
    s.setDocument(emote())
    expect(useCanvasStore.getState().doc).toMatchObject({ width: 112, height: 112, background: 'transparent' })
    const ids = useCanvasStore.getState().doc.layers.map((l) => l.id)
    expect(ids.length).toBe(2)
    for (const id of ids) useCanvasStore.getState().removeLayer(id)
    expect(useCanvasStore.getState().doc).toEqual({ width: 1200, height: 800, background: '#ffffff', layers: [] })
  })

  it('removing a layer that leaves others keeps the template\'s size and background', () => {
    const s = useCanvasStore.getState()
    s.setDocument(emote())
    const [first] = useCanvasStore.getState().doc.layers
    useCanvasStore.getState().removeLayer(first?.id ?? '')
    expect(useCanvasStore.getState().doc).toMatchObject({ width: 112, height: 112, background: 'transparent' })
    expect(useCanvasStore.getState().doc.layers).toHaveLength(1)
  })

  it('undo of the last removal brings back the template\'s document with its layer; redo takes it away again', () => {
    const s = useCanvasStore.getState()
    s.setDocument(emote())
    const ids = useCanvasStore.getState().doc.layers.map((l) => l.id)
    for (const id of ids) useCanvasStore.getState().removeLayer(id)
    useCanvasStore.getState().undo()
    const back = useCanvasStore.getState().doc
    expect(back).toMatchObject({ width: 112, height: 112, background: 'transparent' })
    expect(back.layers.map((l) => l.id)).toEqual([ids[1]])
    useCanvasStore.getState().redo()
    expect(useCanvasStore.getState().doc).toEqual({ width: 1200, height: 800, background: '#ffffff', layers: [] })
  })

  it('a layer added to the empty screen lands on the blank page, and undoing it walks back through the removal to the template', () => {
    const s = useCanvasStore.getState()
    s.setDocument(emote())
    for (const id of useCanvasStore.getState().doc.layers.map((l) => l.id)) useCanvasStore.getState().removeLayer(id)
    useCanvasStore.getState().addLayer(textLayerFor(useCanvasStore.getState().doc))
    expect(useCanvasStore.getState().doc).toMatchObject({ width: 1200, height: 800, background: '#ffffff' })
    expect(useCanvasStore.getState().doc.layers).toHaveLength(1)
    useCanvasStore.getState().undo() // the text
    expect(useCanvasStore.getState().doc.layers).toHaveLength(0)
    useCanvasStore.getState().undo() // the removal of the last template layer
    expect(useCanvasStore.getState().doc).toMatchObject({ width: 112, height: 112, layers: [expect.anything()] })
  })

  it('the blank page already is the default: removing its last layer changes nothing but the layer', () => {
    const s = useCanvasStore.getState()
    s.addLayer(makeTextLayer(0, 0))
    const id = useCanvasStore.getState().doc.layers[0]?.id ?? ''
    useCanvasStore.getState().removeLayer(id)
    expect(useCanvasStore.getState().doc).toEqual({ width: 1200, height: 800, background: '#ffffff', layers: [] })
  })

  it('the selection is cleared with the layer, as before', () => {
    const s = useCanvasStore.getState()
    s.setDocument(emote())
    const ids = useCanvasStore.getState().doc.layers.map((l) => l.id)
    useCanvasStore.getState().selectLayer(ids[0] ?? null)
    for (const id of ids) useCanvasStore.getState().removeLayer(id)
    expect(useCanvasStore.getState().selectedLayerId).toBeNull()
  })
})

// T-140 (3): which layers keep their proportions on a corner drag. The Transformer (Canvas.tsx) is handed this as `keepRatio`, with Shift inverting it for these and
// leaving Konva's default (Shift keeps the ratio) for the rest; the drag itself is held by image.spec.ts.
describe('keepsRatioOnCornerDrag - a picture and a word have proportions of their own (T-140 (3))', () => {
  it('a picture and text keep theirs; a rectangle, an ellipse and a line stretch', () => {
    const kinds: Record<LayerType, boolean> = { image: true, text: true, rect: false, ellipse: false, line: false }
    for (const [type, keeps] of Object.entries(kinds) as Array<[LayerType, boolean]>) {
      expect(keepsRatioOnCornerDrag(type), type).toBe(keeps)
    }
  })
})
