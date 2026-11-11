import { describe, it, expect, beforeEach } from 'vitest'
import { asHint, displayOpacity, type CanvasDocument, type CanvasLayer, type LayerType, type TextLayer } from '@shared/canvas'
import {
  FONT_SIZE_MIN,
  applyLayerPatch,
  foldTextScale,
  keepsRatioOnCornerDrag,
  makeEllipseLayer,
  makeImageLayer,
  makeLineLayer,
  makeRectLayer,
  makeReferenceLayer,
  makeTextLayer,
  textLayerFor,
  useCanvasStore
} from './canvasStore'
import { CANVAS_TEMPLATES } from '../templates'
import { ASSET_CATALOG } from '../../references/assetCatalog'
import { READABLE_CONTRAST, contrastRatio, estimatedTextBox, newTextLook, surfacesUnder, worstContrast } from '@shared/newText'
import { BG_BASE, INK_BASE } from '../../../styles/tokens'
import { MAX_SCHEMA_VERSION, validateProject } from '@shared/projectValidation'

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
    it(`${name} (${doc.width}x${doc.height}, ${doc.background}): the text is wholly inside it and its color is 4.5:1 against everything drawn under it`, () => {
      const t = textLayerFor(doc)
      const box = estimatedTextBox(t.text, t.fontSize)
      expect(t.type).toBe('text')
      expect(t.text).toBe('Text')
      expect(t.x, 'left').toBeGreaterThanOrEqual(0)
      expect(t.y, 'top').toBeGreaterThanOrEqual(0)
      expect(t.x + box.width, 'right').toBeLessThanOrEqual(doc.width)
      expect(t.y + box.height, 'bottom').toBeLessThanOrEqual(doc.height)
      // T-141 (2): not the document's background alone (T-140 (2) held it to that, which is how the emote's word was 2.9:1 on its disc) but every colour that can show under the word's
      // box: the document, the shapes and the words it overlaps. A transparent document is the dark workspace behind it.
      const under = surfacesUnder(doc, { x: t.x, y: t.y, ...box }, BG_BASE)
      expect(under.length).toBeGreaterThan(0)
      expect(worstContrast(t.fill, under, { dark: BG_BASE, light: INK_BASE, behind: BG_BASE }), `${t.fill} on ${under.join(', ')}`).toBeGreaterThanOrEqual(4.5)
      // The color is a token, never a literal of its own.
      expect([BG_BASE, INK_BASE]).toContain(t.fill)
    })
  }

  it('the default blank page keeps the look it always had: 32 px BG_BASE text, now 60 px in from the corner', () => {
    expect(textLayerFor({ width: 1200, height: 800, background: '#ffffff' })).toMatchObject({ fontSize: 32, fill: BG_BASE, x: 60, y: 60 })
  })

  // T-141 (2): the emote is a transparent document with a disc that fills it, and T-140 (2) gave it the light ink for the transparent document; the word sits on the disc (see the
  // T-141 (2) block below), so it is the dark ink now. The 4K overlay's first place is bare transparent document, and keeps the light one.
  it('the emote takes the dark ink for its disc and the 4K overlay the light ink for its transparent document, and the 4K overlay\'s text is bigger than the 32 px speck it was', () => {
    const emote = CANVAS_TEMPLATES.find((t) => t.id === 'emote-blank-112')
    const overlay4k = CANVAS_TEMPLATES.find((t) => t.id === 'tw-overlay-streamer-4k')
    expect(emote && overlay4k).toBeTruthy()
    expect(textLayerFor((emote as { doc: CanvasDocument }).doc).fill).toBe(BG_BASE)
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

// ── T-141 (2): the text layer for a document that has layers ──────────────────────────────────────────────────────────────────────────────

describe('textLayerFor reads the layers (T-141 (2))', () => {
  const emote = (id: string): CanvasDocument => {
    const t = CANVAS_TEMPLATES.find((c) => c.id === id)
    if (!t) throw new Error(`${id} is gone from templates.ts`)
    return t.doc
  }

  it('the emote\'s word is the dark ink: it sits on the red disc, where the light ink was 2.9:1', () => {
    const t = textLayerFor(emote('emote-blank-112'))
    expect(t.fill).toBe(BG_BASE)
    expect(contrastRatio(t.fill, '#ff3131')).toBeGreaterThan(5)
    expect(contrastRatio(INK_BASE, '#ff3131')).toBeLessThan(3)
  })

  it('the POG emote\'s word is the dark ink and is not drawn on POG: it was the light ink on the gold disc, 1.33:1', () => {
    const doc = emote('emote-text')
    const t = textLayerFor(doc)
    const pog = doc.layers.find((l) => l.type === 'text')
    expect(pog).toBeTruthy()
    expect(t.fill).toBe(BG_BASE)
    expect(t.y, 'below the estimated box of the word POG').toBeGreaterThanOrEqual((pog as TextLayer).y + (pog as TextLayer).fontSize)
  })

  it('the Bold thumbnail\'s word is not drawn on its sample title (the title is at the first place: it moves to the next corner)', () => {
    const doc = emote('yt-thumb-bold')
    const t = textLayerFor(doc)
    expect(t.x, 'not at the first place, which is the sample title\'s').toBeGreaterThan(300)
    expect(t.y).toBe(60)
    expect(t.fill).toBe(INK_BASE)
  })

  it('a document with no layers at all is exactly what T-140 (2) made of it', () => {
    expect(textLayerFor({ width: 1200, height: 800, background: '#ffffff' })).toMatchObject({ fontSize: 32, fill: BG_BASE, x: 60, y: 60 })
    expect(textLayerFor({ width: 1200, height: 800, background: '#ffffff', layers: [] })).toMatchObject({ fontSize: 32, fill: BG_BASE, x: 60, y: 60 })
  })

  it('a second word on the blank page does not land on the first: it takes the next corner', () => {
    const first = textLayerFor({ width: 1200, height: 800, background: '#ffffff' })
    const second = textLayerFor({ width: 1200, height: 800, background: '#ffffff', layers: [first] })
    expect([first.x, first.y]).toEqual([60, 60])
    expect(second.x).toBeGreaterThan(first.x + estimatedTextBox('Text', first.fontSize).width)
    expect(second.y).toBe(60)
    expect(second.fill).toBe(BG_BASE)
  })
})

// ── T-141 (6): a resize folds the scale into the font size ────────────────────────────────────────────────────────────────────────────────

describe('foldTextScale - the size is what is drawn (T-141 (6))', () => {
  it('a layer that was not resized is unchanged', () => {
    expect(foldTextScale(32, 1, 1)).toEqual({ fontSize: 32, scaleX: 1, scaleY: 1 })
    expect(foldTextScale(86, 1, 1)).toEqual({ fontSize: 86, scaleX: 1, scaleY: 1 })
  })

  it('a corner drag that kept the ratio becomes a bigger size at scale 1, to the whole pixel', () => {
    expect(foldTextScale(32, 1.5, 1.5)).toEqual({ fontSize: 48, scaleX: 1, scaleY: 1 })
    expect(foldTextScale(32, 1.37, 1.37)).toEqual({ fontSize: 44, scaleX: 1, scaleY: 1 })
    expect(foldTextScale(32, 0.5, 0.5)).toEqual({ fontSize: 16, scaleX: 1, scaleY: 1 })
    expect(foldTextScale(20, 2.06, 2.06)).toEqual({ fontSize: 41, scaleX: 1, scaleY: 1 })
  })

  it('two scales within float error of each other are one scale (Konva keeps a ratio to its own arithmetic, not to the digit)', () => {
    expect(foldTextScale(32, 1.5, 1.5000000000000002)).toEqual({ fontSize: 48, scaleX: 1, scaleY: 1 })
    expect(foldTextScale(32, 0.9999999999999996, 1)).toEqual({ fontSize: 32, scaleX: 1, scaleY: 1 })
  })

  it('never under the Size field\'s smallest, 4', () => {
    expect(FONT_SIZE_MIN).toBe(4)
    expect(foldTextScale(8, 0.2, 0.2).fontSize).toBe(4)
    expect(foldTextScale(4, 0.1, 0.1)).toEqual({ fontSize: 4, scaleX: 1, scaleY: 1 })
  })

  it('a Shift-freed stretch: the height goes into the size, the scale is 1 vertically, and the width ratio is what remains in scaleX', () => {
    // Taller only: 32 px made 1.5x tall at the same drawn width: 48 px, and a squeeze of 2/3 in x.
    const tall = foldTextScale(32, 1, 1.5)
    expect(tall.fontSize).toBe(48)
    expect(tall.scaleY).toBe(1)
    expect(tall.scaleX).toBeCloseTo(32 / 48, 10)
    // Wider only: the size stays and the width is kept as scaleX.
    expect(foldTextScale(32, 1.8, 1)).toEqual({ fontSize: 32, scaleX: 1.8, scaleY: 1 })
  })

  it('the width as drawn is kept through the rounding: size * scaleX is the old fontSize * scaleX (the height moves by under half a pixel, the width not at all)', () => {
    for (const [fontSize, sx, sy] of [[32, 1.2, 1.37], [20, 3, 1.7], [86, 0.8, 1.011], [47, 2.2, 0.63], [12, 1.9, 2.9]] as const) {
      const folded = foldTextScale(fontSize, sx, sy)
      expect(folded.fontSize * folded.scaleX, `${fontSize} x ${sx} / ${sy}`).toBeCloseTo(fontSize * sx, 8)
      expect(Math.abs(folded.fontSize - fontSize * sy), `${fontSize} x ${sy}`).toBeLessThanOrEqual(0.5 + 1e-9)
      expect(Number.isInteger(folded.fontSize)).toBe(true)
      expect(folded.scaleY).toBe(1)
    }
  })

  it('a flip keeps its sign: dragged past the opposite edge it is mirrored, at the size it was dragged to', () => {
    expect(foldTextScale(32, -1.5, 1.5)).toEqual({ fontSize: 48, scaleX: -1, scaleY: 1 })
    expect(foldTextScale(32, 1.5, -1.5)).toEqual({ fontSize: 48, scaleX: 1, scaleY: -1 })
    expect(foldTextScale(32, -2, 1)).toEqual({ fontSize: 32, scaleX: -2, scaleY: 1 })
    expect(foldTextScale(32, -1, -1)).toEqual({ fontSize: 32, scaleX: -1, scaleY: -1 })
    // A mirrored word dragged with its ratio kept is still one scale (the rounding must not leave a stretch behind): 1.37 x 32 is 44 px.
    expect(foldTextScale(32, -1.37, 1.37)).toEqual({ fontSize: 44, scaleX: -1, scaleY: 1 })
    expect(foldTextScale(32, 1.37, -1.37)).toEqual({ fontSize: 44, scaleX: 1, scaleY: -1 })
  })

  it('a layer saved before this, with a scale it already carries, folds the whole of it on its next resize', () => {
    // 32 px at 1.4 (a stored scale), dragged by a further 1.1: the node reports 1.54.
    expect(foldTextScale(32, 1.54, 1.54)).toEqual({ fontSize: 49, scaleX: 1, scaleY: 1 })
  })

  it('folding twice is folding once: a folded layer is at scale 1 and stays', () => {
    const once = foldTextScale(32, 1.4, 1.4)
    expect(foldTextScale(once.fontSize, once.scaleX, once.scaleY)).toEqual(once)
    const free = foldTextScale(32, 1.8, 1.3)
    expect(foldTextScale(free.fontSize, free.scaleX, free.scaleY)).toEqual(free)
  })
})

// ── T-141 (8): a layer that is not there is not removed, and Undo does not keep a selection that names none ───────────────────────────────

describe('removing a layer that is not there, and a selection that outlives its layer (T-141 (8))', () => {
  beforeEach(() => {
    useCanvasStore.getState().resetDocument()
  })

  it('removeLayer with an id nothing has is no step: the document, the past and the Redo branch are untouched', () => {
    const s = useCanvasStore.getState()
    const a = makeTextLayer(10, 10, 'A')
    const b = makeTextLayer(20, 20, 'B')
    s.addLayer(a)
    s.addLayer(b)
    useCanvasStore.getState().undo() // b goes to Redo
    const before = useCanvasStore.getState()
    useCanvasStore.getState().removeLayer('no-such-layer')
    const after = useCanvasStore.getState()
    expect(after.doc).toBe(before.doc)
    expect(after.history.past).toBe(before.history.past)
    expect(after.history.future, 'Redo is kept').toBe(before.history.future)
    expect(after.canRedo()).toBe(true)
    expect(after.selectedLayerId).toBe(before.selectedLayerId)
  })

  it('removeLayer of a real layer is still a step, and clears Redo as any edit does', () => {
    const s = useCanvasStore.getState()
    const a = makeTextLayer(10, 10, 'A')
    s.addLayer(a)
    s.addLayer(makeTextLayer(20, 20, 'B'))
    useCanvasStore.getState().undo()
    expect(useCanvasStore.getState().canRedo()).toBe(true)
    useCanvasStore.getState().removeLayer(a.id)
    expect(useCanvasStore.getState().canRedo()).toBe(false)
    expect(useCanvasStore.getState().doc.layers).toHaveLength(0)
  })

  it('Undo of "+ Add text" leaves nothing selected: the word it selected is gone, and Delete on the stale id would have recorded a step and cleared Redo', () => {
    const s = useCanvasStore.getState()
    const word = textLayerFor(useCanvasStore.getState().doc)
    s.addLayer(word)
    expect(useCanvasStore.getState().selectedLayerId).toBe(word.id)
    useCanvasStore.getState().undo()
    expect(useCanvasStore.getState().selectedLayerId).toBeNull()
    expect(useCanvasStore.getState().doc.layers).toHaveLength(0)
    // What the Delete key does with the selection it has: nothing to remove, and the word is still in Redo.
    const id = useCanvasStore.getState().selectedLayerId
    if (id) useCanvasStore.getState().removeLayer(id)
    expect(useCanvasStore.getState().canRedo()).toBe(true)
    useCanvasStore.getState().redo()
    expect(useCanvasStore.getState().doc.layers.map((l) => l.id)).toEqual([word.id])
  })

  it('Redo that takes away the selected layer leaves nothing selected', () => {
    const s = useCanvasStore.getState()
    const a = makeTextLayer(10, 10, 'A')
    s.addLayer(a)
    useCanvasStore.getState().removeLayer(a.id)
    useCanvasStore.getState().undo() // A is back
    useCanvasStore.getState().selectLayer(a.id)
    expect(useCanvasStore.getState().selectedLayerId).toBe(a.id)
    useCanvasStore.getState().redo() // the removal again: A is gone
    expect(useCanvasStore.getState().doc.layers).toHaveLength(0)
    expect(useCanvasStore.getState().selectedLayerId).toBeNull()
  })

  it('a selection that is still a layer in the document an Undo or Redo brings back is kept', () => {
    const s = useCanvasStore.getState()
    const a = makeTextLayer(10, 10, 'A')
    const b = makeTextLayer(20, 20, 'B')
    s.addLayer(a)
    s.addLayer(b)
    useCanvasStore.getState().selectLayer(a.id)
    useCanvasStore.getState().undo() // B goes: A exists in both
    expect(useCanvasStore.getState().selectedLayerId).toBe(a.id)
    useCanvasStore.getState().redo()
    expect(useCanvasStore.getState().selectedLayerId).toBe(a.id)
  })

  it('no selection stays no selection', () => {
    const s = useCanvasStore.getState()
    s.addLayer(makeTextLayer(10, 10, 'A'))
    useCanvasStore.getState().selectLayer(null)
    useCanvasStore.getState().undo()
    expect(useCanvasStore.getState().selectedLayerId).toBeNull()
    useCanvasStore.getState().redo()
    expect(useCanvasStore.getState().selectedLayerId).toBeNull()
  })

  it('Undo and Redo with nothing to undo or redo change nothing, the selection included', () => {
    const s = useCanvasStore.getState()
    const a = makeTextLayer(10, 10, 'A')
    s.addLayer(a)
    useCanvasStore.getState().redo()
    expect(useCanvasStore.getState().selectedLayerId).toBe(a.id)
    useCanvasStore.getState().resetDocument()
    useCanvasStore.getState().undo()
    expect(useCanvasStore.getState().selectedLayerId).toBeNull()
  })
})

/**
 * T-78 image half (T-147): `updateLayer` pushed an undo step for every `input` event behind the Properties panel's opacity slider, colour fields and name
 * field, so one drag was dozens of steps and Ctrl+Z moved the value one notch. The video store's shape (T-40): an edit carries a control's key, the first edit
 * of a gesture records the step, `endGesture` (a release, a blur) closes the window, and a discrete action or an undo / redo closes it too.
 */
describe('updateLayer coalescing - one gesture, one undo step (T-78)', () => {
  const stepsBack = (): number => useCanvasStore.getState().history.past.length
  const layerNow = (id: string): TextLayer => useCanvasStore.getState().doc.layers.find((l) => l.id === id) as TextLayer
  let id = ''

  beforeEach(() => {
    useCanvasStore.getState().resetDocument()
    const t = makeTextLayer(10, 10, 'A')
    id = t.id
    useCanvasStore.getState().addLayer(t)
  })

  it('a drag (many keyed edits) is ONE step, and one Undo restores the value from before it', () => {
    const before = stepsBack()
    for (const o of [0.9, 0.8, 0.7, 0.6, 0.5]) useCanvasStore.getState().updateLayer(id, { opacity: o }, 'opacity')
    expect(layerNow(id).opacity).toBe(0.5)
    expect(stepsBack()).toBe(before + 1)
    useCanvasStore.getState().undo()
    expect(layerNow(id).opacity).toBe(1)
    expect(stepsBack()).toBe(before)
  })

  it('two drags are two steps: endGesture is what tells the second one apart', () => {
    const before = stepsBack()
    for (const o of [0.8, 0.6]) useCanvasStore.getState().updateLayer(id, { opacity: o }, 'opacity')
    useCanvasStore.getState().endGesture()
    for (const o of [0.4, 0.2]) useCanvasStore.getState().updateLayer(id, { opacity: o }, 'opacity')
    expect(stepsBack()).toBe(before + 2)
    useCanvasStore.getState().undo()
    expect(layerNow(id).opacity).toBe(0.6)
    useCanvasStore.getState().undo()
    expect(layerNow(id).opacity).toBe(1)
  })

  it('typing a name is one step until the field loses focus (endGesture), then the next typing is another', () => {
    const before = stepsBack()
    for (const n of ['L', 'La', 'Lay', 'Layer']) useCanvasStore.getState().updateLayer(id, { name: n }, 'name')
    expect(stepsBack()).toBe(before + 1)
    useCanvasStore.getState().endGesture()
    for (const n of ['Layer 2', 'Layer 22']) useCanvasStore.getState().updateLayer(id, { name: n }, 'name')
    expect(stepsBack()).toBe(before + 2)
    useCanvasStore.getState().undo()
    expect(layerNow(id).name).toBe('Layer')
  })

  it('a different control is a different gesture, and so is the same control on another layer', () => {
    const other = makeTextLayer(50, 50, 'B')
    useCanvasStore.getState().addLayer(other)
    const before = stepsBack()
    useCanvasStore.getState().updateLayer(id, { opacity: 0.5 }, 'opacity')
    useCanvasStore.getState().updateLayer(id, { fill: '#ff0000' }, 'fill')
    expect(stepsBack(), 'opacity then fill: two controls, two steps').toBe(before + 2)
    useCanvasStore.getState().updateLayer(id, { opacity: 0.4 }, 'opacity')
    useCanvasStore.getState().updateLayer(other.id, { opacity: 0.3 }, 'opacity')
    expect(stepsBack(), 'opacity on a, then opacity on b: the window is per layer').toBe(before + 4)
  })

  it('a discrete action after a drag is its own step, and a keyed edit after it starts a new one', () => {
    const before = stepsBack()
    useCanvasStore.getState().updateLayer(id, { opacity: 0.5 }, 'opacity')
    useCanvasStore.getState().setRotation(id, 45)
    expect(stepsBack()).toBe(before + 2)
    // the rotation reset the window: the same slider again is a new step, not folded into the one before the rotation
    useCanvasStore.getState().updateLayer(id, { opacity: 0.4 }, 'opacity')
    expect(stepsBack()).toBe(before + 3)
    // an edit with no key is discrete: it always records
    useCanvasStore.getState().updateLayer(id, { x: 99 })
    useCanvasStore.getState().updateLayer(id, { x: 98 })
    expect(stepsBack()).toBe(before + 5)
  })

  it('undo and redo close the window: a drag after an Undo is a new step', () => {
    useCanvasStore.getState().updateLayer(id, { opacity: 0.5 }, 'opacity')
    useCanvasStore.getState().undo()
    const before = stepsBack()
    useCanvasStore.getState().updateLayer(id, { opacity: 0.3 }, 'opacity')
    expect(stepsBack()).toBe(before + 1)
    useCanvasStore.getState().undo()
    useCanvasStore.getState().redo()
    useCanvasStore.getState().updateLayer(id, { opacity: 0.2 }, 'opacity')
    expect(stepsBack(), 'the redo reset the window').toBe(before + 2)
  })

  it('selecting another layer, adding one and opening a document close the window', () => {
    useCanvasStore.getState().updateLayer(id, { opacity: 0.5 }, 'opacity')
    const afterFirst = stepsBack()
    useCanvasStore.getState().selectLayer(null)
    useCanvasStore.getState().selectLayer(id)
    useCanvasStore.getState().updateLayer(id, { opacity: 0.4 }, 'opacity')
    expect(stepsBack(), 'selecting ended the gesture').toBe(afterFirst + 1)
    useCanvasStore.getState().resetDocument()
    expect(useCanvasStore.getState().historyKey).toBeNull()
  })

  it('endGesture with no window open changes nothing', () => {
    const before = useCanvasStore.getState()
    useCanvasStore.getState().endGesture()
    expect(useCanvasStore.getState().history).toBe(before.history)
    expect(useCanvasStore.getState().historyKey).toBeNull()
  })
})

describe('typed boxes - one burst of typing is one undo step (T-153 (1))', () => {
  // The Properties panel's DraftFields commit LIVE on each in-range keystroke (T-124 (15)), so "12" typed into a box is two `updateLayer` calls. Each box passes
  // its own key (`'strokeWidth'`, `'fontSize'`, `'x'`, `'y'`, `'rotation'`) and the window `useGestureEnd` closes on leaving the panel makes the burst one step.
  // The panel half (the keys are passed) is pinned in interactionWiring.test.ts and driven in image.spec.ts "T-153 (1)"; this is the store's half of the contract.
  const stepsBack = (): number => useCanvasStore.getState().history.past.length
  const layerNow = (id: string): TextLayer => useCanvasStore.getState().doc.layers.find((l) => l.id === id) as TextLayer
  let id = ''

  beforeEach(() => {
    useCanvasStore.getState().resetDocument()
    const t = makeTextLayer(10, 10, 'A')
    id = t.id
    useCanvasStore.getState().addLayer(t)
  })

  for (const [key, first, second, start] of [
    ['strokeWidth', 1, 12, 0],
    ['fontSize', 7, 72, 32],
    ['x', 5, 50, 10],
    ['y', 3, 30, 10],
    ['rotation', 4, 45, 0]
  ] as const) {
    it(`"${first}" then "${second}" typed into the ${key} box is ONE step, and a second burst after the window closes is a second`, () => {
      const store = useCanvasStore.getState
      // The layer is a word, which has no stroke: seed the box's starting value as its own step first.
      store().updateLayer(id, { [key]: start }, 'seed')
      store().endGesture()
      const before = stepsBack()
      store().updateLayer(id, { [key]: first }, key)
      store().updateLayer(id, { [key]: second }, key)
      expect(stepsBack(), 'the two keystrokes are one step').toBe(before + 1)
      store().undo()
      expect((layerNow(id) as unknown as Record<string, number>)[key], 'one Undo restores the value from before the typing').toBe(start)

      store().redo()
      store().endGesture()
      store().updateLayer(id, { [key]: 99 }, key)
      store().updateLayer(id, { [key]: 98 }, key)
      expect(stepsBack(), 'a burst after endGesture is a new step').toBe(before + 2)
      store().undo()
      expect((layerNow(id) as unknown as Record<string, number>)[key], 'and its Undo lands on the first burst\'s value').toBe(second)
    })
  }

  it('x then y typed in a row are two steps: each box is its own window', () => {
    const before = stepsBack()
    useCanvasStore.getState().updateLayer(id, { x: 5 }, 'x')
    useCanvasStore.getState().updateLayer(id, { x: 50 }, 'x')
    useCanvasStore.getState().updateLayer(id, { y: 3 }, 'y')
    useCanvasStore.getState().updateLayer(id, { y: 30 }, 'y')
    expect(stepsBack()).toBe(before + 2)
  })

  it('a rotation preset is one step each, and typing after a preset starts a new step', () => {
    const before = stepsBack()
    useCanvasStore.getState().updateLayer(id, { rotation: 4 }, 'rotation')
    useCanvasStore.getState().updateLayer(id, { rotation: 45 }, 'rotation')
    // T-167 (2): this pressed 90 twice and counted two steps; the second press of the rotation the layer is already at records nothing now (it would also clear Redo), so the second
    // press is 180 (typed burst + two presses is still before + 3, and the Undo below lands on 180, not 90).
    useCanvasStore.getState().setRotation(id, 90)
    useCanvasStore.getState().setRotation(id, 180)
    expect(stepsBack(), 'typed burst + two presses').toBe(before + 3)
    useCanvasStore.getState().updateLayer(id, { rotation: 1 }, 'rotation')
    expect(stepsBack(), 'a preset closes the typing window').toBe(before + 4)
    useCanvasStore.getState().undo()
    expect(layerNow(id).rotation).toBe(180)
  })
})

// T-166 (1): the paste branch built `{ ...textLayerFor(doc), text: words }`, and `textLayerFor` sized, placed and inked for the word "Text" - so a pasted sentence on the Bold
// thumbnail landed at x=1150 (about 70% off the 1280 page) and on both 112 px emotes was invisible. `textLayerFor(doc, word)` hands the word on to `newTextLook`.
describe('textLayerFor(doc, word) - a pasted sentence is sized, placed and inked for itself (T-166 (1))', () => {
  const SENTENCE = 'Subscribe now for more streams'
  const INKS = { dark: BG_BASE, light: INK_BASE, behind: BG_BASE }
  const templateDoc = (id: string): CanvasDocument => {
    const t = CANVAS_TEMPLATES.find((c) => c.id === id)
    if (!t) throw new Error(`template ${id} is gone from templates.ts`)
    return t.doc
  }
  const look = (t: TextLayer): Pick<TextLayer, 'x' | 'y' | 'fontSize' | 'fill'> => ({ x: t.x, y: t.y, fontSize: t.fontSize, fill: t.fill })

  it('control: with no word it is today\'s layer - the default page, and a dark template (green on base, the word "Text")', () => {
    expect(look(textLayerFor({ width: 1200, height: 800, background: '#ffffff' }))).toEqual({ x: 60, y: 60, fontSize: 32, fill: BG_BASE })
    // (T-167 fold: the Bold thumbnail's x was 1150.4 = 1280 - 60 - 4 * 0.6 * 29; "Text" is 2.20 em now (each character its own measured advance), so 1280 - 60 - 63.8 = 1156.2)
    expect(look(textLayerFor(templateDoc('yt-thumb-bold')))).toEqual({ x: 1156.2, y: 60, fontSize: 29, fill: INK_BASE })
    // (T-167 fold: the blank emote's place was (52, 58), the nearest spot where a 48 px x 20 px box sits inside the disc; the box is 44 px wide now (2.20 em at 20 px), so the nearest is (56, 58))
    expect(look(textLayerFor(templateDoc('emote-blank-112')))).toEqual({ x: 56, y: 58, fontSize: 20, fill: BG_BASE })
    expect(textLayerFor(templateDoc('yt-thumb-bold')).text).toBe('Text')
  })

  it('"Text" given as the word is the same layer as no word (a fresh id apart)', () => {
    for (const id of ['yt-thumb-bold', 'emote-blank-112', 'emote-text']) {
      expect({ ...textLayerFor(templateDoc(id), 'Text'), id: '' }, id).toEqual({ ...textLayerFor(templateDoc(id)), id: '' })
    }
  })

  it('the sentence on the Bold thumbnail is not where "Text" went (x 1150.4 put its right edge at 1672 on a 1280 page): the whole box is inside, and it is readable', () => {
    const doc = templateDoc('yt-thumb-bold')
    const t = textLayerFor(doc, SENTENCE)
    const box = estimatedTextBox(SENTENCE, t.fontSize)
    expect(look(t)).not.toEqual(look(textLayerFor(doc)))
    expect(t.x + box.width).toBeLessThanOrEqual(doc.width)
    expect(t.y + box.height).toBeLessThanOrEqual(doc.height)
    expect(worstContrast(t.fill, surfacesUnder(doc, { x: t.x, y: t.y, ...box }, BG_BASE), INKS)).toBeGreaterThanOrEqual(4.5)
  })

  for (const id of ['emote-blank-112', 'emote-text']) {
    it(`the sentence on ${id} is smaller than the 20 px floor (it has to fit 112 px), inside the page, and not the 1.00:1 the word "Text" got`, () => {
      const doc = templateDoc(id)
      const t = textLayerFor(doc, SENTENCE)
      const box = estimatedTextBox(SENTENCE, t.fontSize)
      expect(t.fontSize).toBeLessThan(textLayerFor(doc).fontSize)
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.y).toBeGreaterThanOrEqual(0)
      expect(t.x + box.width).toBeLessThanOrEqual(doc.width)
      expect(t.y + box.height).toBeLessThanOrEqual(doc.height)
      expect(worstContrast(t.fill, surfacesUnder(doc, { x: t.x, y: t.y, ...box }, BG_BASE), INKS)).toBeGreaterThanOrEqual(4.5)
      expect([BG_BASE, INK_BASE]).toContain(t.fill)
    })
  }

  it('a pasted two-line title on the default page is two lines tall inside the page', () => {
    const doc: CanvasDocument = { width: 1200, height: 800, background: '#ffffff', layers: [] }
    const t = textLayerFor(doc, 'Subscribe now\nfor more streams')
    const box = estimatedTextBox('Subscribe now\nfor more streams', t.fontSize)
    expect(box.height).toBe(2 * t.fontSize)
    expect(t.y + box.height).toBeLessThanOrEqual(doc.height)
  })
})

// (here and not in newText.test.ts: that file is in the node project, which cannot import the renderer's templates.)
describe('newTextLook with a pasted sentence keeps the whole box inside the page and readable (T-166 (1))', () => {
  const INKS = { dark: BG_BASE, light: INK_BASE, behind: BG_BASE }
  const SENTENCE = 'Subscribe now for more streams'
  const documents: Array<[string, CanvasDocument]> = ['yt-thumb-bold', 'emote-blank-112', 'emote-text'].map((id): [string, CanvasDocument] => {
    const t = CANVAS_TEMPLATES.find((c) => c.id === id)
    if (!t) throw new Error(`template ${id} is gone from templates.ts`)
    return [t.name, t.doc]
  })

  for (const [name, doc] of documents) {
    it(`${name}: the sentence's box is wholly inside the ${doc.width}x${doc.height} page and the ink is at least READABLE_CONTRAST against everything under it (a control: \`newTextLook\` already took the word; the defect was its caller)`, () => {
      const look = newTextLook(doc, INKS, SENTENCE)
      const box = estimatedTextBox(SENTENCE, look.fontSize)
      expect(look.x, 'left').toBeGreaterThanOrEqual(0)
      expect(look.y, 'top').toBeGreaterThanOrEqual(0)
      expect(look.x + box.width, 'right').toBeLessThanOrEqual(doc.width + 1e-9)
      expect(look.y + box.height, 'bottom').toBeLessThanOrEqual(doc.height + 1e-9)
      // (the module's own helpers: what can show under the box, and the worst ratio the ink has against any of it)
      const under = surfacesUnder(doc, { x: look.x, y: look.y, ...box }, INKS.behind)
      expect(worstContrast(look.fill, under, INKS), `${look.fill} on ${under.join(', ')}`).toBeGreaterThanOrEqual(READABLE_CONTRAST)
    })

    // A two-line title is the case the one-line box could not hold. Inside the page is what is promised for any text; READABLE is promised where a place exists (the thumbnail), and
    // a 106 px x 22 px box on an emote's disc has none (`newTextLook`'s last resort: the best place there is), so the emotes are held to inside only.
    it(`${name}: a two-line title's whole box (two lines tall) is inside the page`, () => {
      const word = 'Subscribe now\nfor more streams'
      const look = newTextLook(doc, INKS, word)
      const box = estimatedTextBox(word, look.fontSize)
      expect(box.height).toBe(2 * look.fontSize)
      expect(look.x).toBeGreaterThanOrEqual(0)
      expect(look.y).toBeGreaterThanOrEqual(0)
      expect(look.x + box.width).toBeLessThanOrEqual(doc.width + 1e-9)
      expect(look.y + box.height).toBeLessThanOrEqual(doc.height + 1e-9)
    })
  }

  it('a two-line title on the Bold thumbnail is readable as well as inside', () => {
    const doc = documents[0]![1]
    const word = 'Subscribe now\nfor more streams'
    const look = newTextLook(doc, INKS, word)
    const under = surfacesUnder(doc, { x: look.x, y: look.y, ...estimatedTextBox(word, look.fontSize) }, INKS.behind)
    expect(worstContrast(look.fill, under, INKS)).toBeGreaterThanOrEqual(READABLE_CONTRAST)
  })
})

// T-167 (2): a Stream Graphics edit that changes nothing recorded an undo step and wiped Redo (the "0" rotation preset on a layer already at 0 after an Undo; a snapped drag shorter than half a
// cell, which `onDragEnd` writes as `updateLayer(id, { x, y })` at the layer's own place; an order the arrows leave as it was). The class T-166 (3) fixed in videoStore and T-141 (8) in `removeLayer`.
describe('an edit that changes nothing records nothing and keeps Redo (T-167 (2))', () => {
  /** A rect and an ellipse on the page, one step in `past` and one in `future` (two edits, one Undo), so a wrongly recorded step shows in BOTH lists. */
  function seed(): { rect: ReturnType<typeof makeRectLayer>; ellipse: ReturnType<typeof makeEllipseLayer> } {
    const s = useCanvasStore.getState()
    s.resetDocument()
    const rect = { ...makeRectLayer(40, 50), id: 'rect-1' }
    const ellipse = { ...makeEllipseLayer(300, 200), id: 'ellipse-1' }
    s.addLayer(rect)
    s.addLayer(ellipse)
    s.updateLayer(rect.id, { x: 41 })
    useCanvasStore.getState().undo()
    expect(useCanvasStore.getState().history.past).toHaveLength(2)
    expect(useCanvasStore.getState().history.future).toHaveLength(1)
    return { rect, ellipse }
  }

  /** Nothing was set at all: the document, both history lists, the object holding them and the coalescing key are the very ones from before. */
  function expectUntouched(before: ReturnType<typeof useCanvasStore.getState>): void {
    const after = useCanvasStore.getState()
    expect(after.doc, 'the document').toBe(before.doc)
    expect(after.history, 'the history object').toBe(before.history)
    expect(after.history.past, 'past').toBe(before.history.past)
    expect(after.history.future, 'future').toBe(before.history.future)
    expect(after.historyKey, 'historyKey').toBe(before.historyKey)
    expect(after.canRedo(), 'Redo is still offered').toBe(true)
  }

  beforeEach(() => {
    useCanvasStore.getState().resetDocument()
  })

  it('setRotation to the rotation the layer has (0 on a layer at 0) is no step', () => {
    const { rect } = seed()
    const before = useCanvasStore.getState()
    useCanvasStore.getState().setRotation(rect.id, 0)
    expectUntouched(before)
  })

  it('a layer with no rotation at all counts as 0, and setRotation of a layer that is not there is no step', () => {
    const { rect } = seed()
    // (a project file is read, not made by the editor: its layer may have no rotation key)
    const bare = { ...rect } as Partial<typeof rect>
    delete bare.rotation
    useCanvasStore.setState({ doc: { ...useCanvasStore.getState().doc, layers: [bare as typeof rect, ...useCanvasStore.getState().doc.layers.slice(1)] } })
    const before = useCanvasStore.getState()
    useCanvasStore.getState().setRotation(rect.id, 0)
    expectUntouched(before)
    useCanvasStore.getState().setRotation('no-such-layer', 45)
    expectUntouched(before)
  })

  it('updateLayer with the layer\'s own x and y (a drag that snapped back to where it started), with a key and without, is no step', () => {
    const { rect } = seed()
    const before = useCanvasStore.getState()
    useCanvasStore.getState().updateLayer(rect.id, { x: rect.x, y: rect.y })
    expectUntouched(before)
    useCanvasStore.getState().updateLayer(rect.id, { x: rect.x, y: rect.y }, 'x')
    expectUntouched(before)
  })

  it('updateLayer of a layer that is not there is no step', () => {
    seed()
    const before = useCanvasStore.getState()
    useCanvasStore.getState().updateLayer('no-such-layer', { x: 5 })
    expectUntouched(before)
    useCanvasStore.getState().updateLayer('no-such-layer', { x: 5 }, 'x')
    expectUntouched(before)
  })

  it('a patch that leaves every field it names as it was is no step, whatever its shape: a line\'s points copied, a hint retyped with its own words, an empty patch', () => {
    const s = useCanvasStore.getState()
    s.resetDocument()
    const line = { ...makeLineLayer([0, 0, 10, 10, 20, 5]), id: 'line-1' }
    const hint = asHint({ ...makeTextLayer(10, 10, '@yourhandle'), id: 'hint-1' })
    s.addLayer(line)
    s.addLayer(hint)
    s.updateLayer(line.id, { x: 3 })
    useCanvasStore.getState().undo()
    const before = useCanvasStore.getState()
    useCanvasStore.getState().updateLayer(line.id, { points: [0, 0, 10, 10, 20, 5] })
    expectUntouched(before)
    useCanvasStore.getState().updateLayer(hint.id, { text: '@yourhandle' } as Partial<TextLayer>)
    expectUntouched(before)
    useCanvasStore.getState().updateLayer(hint.id, {})
    expectUntouched(before)
    expect((useCanvasStore.getState().doc.layers[1] as TextLayer).hint, 'the hint is still a hint').toBe(true)
  })

  it('a no-op does not close or open a coalescing window: the key from the last real edit is still the key', () => {
    const { rect } = seed()
    useCanvasStore.getState().updateLayer(rect.id, { opacity: 0.5 }, 'opacity')
    const before = useCanvasStore.getState()
    expect(before.historyKey).toBe(`${rect.id}:opacity`)
    // (a real edit cleared Redo, so this is a past-only check)
    useCanvasStore.getState().updateLayer(rect.id, { opacity: 0.5 })
    useCanvasStore.getState().updateLayer(rect.id, { opacity: 0.5 }, 'other')
    const after = useCanvasStore.getState()
    expect(after.history).toBe(before.history)
    expect(after.historyKey).toBe(`${rect.id}:opacity`)
    expect(after.doc).toBe(before.doc)
  })

  it('reorderLayers with the order the layers already have is no step (the same ids in the same order, an id nothing has among them or not)', () => {
    const { rect, ellipse } = seed()
    const before = useCanvasStore.getState()
    useCanvasStore.getState().reorderLayers([rect.id, ellipse.id])
    expectUntouched(before)
    useCanvasStore.getState().reorderLayers([rect.id, 'no-such-layer', ellipse.id])
    expectUntouched(before)
  })

  it('control: a real change is still ONE step and clears Redo - a rotation, a patch, an order, a hint retyped to new words', () => {
    const { rect, ellipse } = seed()
    const pastBefore = useCanvasStore.getState().history.past.length
    useCanvasStore.getState().setRotation(rect.id, 45)
    let s = useCanvasStore.getState()
    expect(s.history.past, 'one step').toHaveLength(pastBefore + 1)
    expect(s.canRedo(), 'and Redo is gone').toBe(false)
    expect(s.doc.layers[0]!.rotation).toBe(45)

    s.undo()
    expect(useCanvasStore.getState().canRedo()).toBe(true)
    useCanvasStore.getState().updateLayer(rect.id, { x: 99, y: 98 })
    s = useCanvasStore.getState()
    expect(s.history.past).toHaveLength(pastBefore + 1)
    expect(s.canRedo()).toBe(false)
    expect(s.doc.layers[0]).toMatchObject({ x: 99, y: 98 })

    s.undo()
    useCanvasStore.getState().reorderLayers([ellipse.id, rect.id])
    s = useCanvasStore.getState()
    expect(s.history.past).toHaveLength(pastBefore + 1)
    expect(s.canRedo()).toBe(false)
    expect(s.doc.layers.map((l) => l.id)).toEqual([ellipse.id, rect.id])

    const hint = asHint({ ...makeTextLayer(10, 10, '@yourhandle'), id: 'hint-2' })
    s.addLayer(hint)
    const afterAdd = useCanvasStore.getState().history.past.length
    useCanvasStore.getState().updateLayer(hint.id, { text: 'my_handle' } as Partial<TextLayer>)
    s = useCanvasStore.getState()
    expect(s.history.past, 'retyping a hint is a step').toHaveLength(afterAdd + 1)
    expect((s.doc.layers[2] as TextLayer).hint, 'and it stops being a hint').toBe(false)
  })

  it('control: a patch that names one field it leaves and one it changes is a step (a drag that moved only along x), and an order that leaves a layer out still applies', () => {
    const { rect, ellipse } = seed()
    const past = useCanvasStore.getState().history.past.length
    useCanvasStore.getState().updateLayer(rect.id, { x: rect.x, y: 77 })
    expect(useCanvasStore.getState().history.past).toHaveLength(past + 1)
    expect(useCanvasStore.getState().doc.layers[0]).toMatchObject({ x: rect.x, y: 77 })
    useCanvasStore.getState().undo()
    useCanvasStore.getState().reorderLayers([rect.id])
    expect(useCanvasStore.getState().history.past, 'the ellipse is left out: that is a change').toHaveLength(past + 1)
    expect(useCanvasStore.getState().doc.layers.map((l) => l.id)).toEqual([rect.id])
    expect(ellipse.id).toBe('ellipse-1')
  })

  it('control: a keyed run is still one step - the first edit records, the rest of the run record none, and a different key starts another', () => {
    const { rect } = seed()
    const past = useCanvasStore.getState().history.past.length
    useCanvasStore.getState().updateLayer(rect.id, { opacity: 0.8 }, 'opacity')
    useCanvasStore.getState().updateLayer(rect.id, { opacity: 0.6 }, 'opacity')
    useCanvasStore.getState().updateLayer(rect.id, { opacity: 0.4 }, 'opacity')
    expect(useCanvasStore.getState().history.past).toHaveLength(past + 1)
    useCanvasStore.getState().updateLayer(rect.id, { strokeWidth: 5 } as Partial<CanvasLayer>, 'strokeWidth')
    expect(useCanvasStore.getState().history.past).toHaveLength(past + 2)
  })
})

/**
 * T-174 (3): the Pencil and the Line tool both made a layer named "Line". The Layers panel shows `name`, the toolbar says "Pencil", and the tutorial says
 * "Line (L) and Pencil (P)". The unreachable "Polygon" naming (nothing passed `closed`) is gone; the field stays false.
 */
describe('makeLineLayer names the layer for the tool that drew it (T-174 (3))', () => {
  it('a Pencil stroke is "Pencil", a Line is "Line", and the default is "Line"', () => {
    expect(makeLineLayer([0, 0, 10, 10, 20, 5], 'Pencil').name).toBe('Pencil')
    expect(makeLineLayer([0, 0, 10, 10], 'Line').name).toBe('Line')
    expect(makeLineLayer([0, 0, 10, 10]).name).toBe('Line')
  })

  it('both are the same stroke layer otherwise: type line, points kept, never closed', () => {
    for (const layer of [makeLineLayer([1, 2, 3, 4, 5, 6], 'Pencil'), makeLineLayer([1, 2, 3, 4])]) {
      expect(layer.type).toBe('line')
      expect(layer.closed).toBe(false)
      expect(layer.stroke).toBeTruthy()
    }
    expect(makeLineLayer([1, 2, 3, 4, 5, 6], 'Pencil').points).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('a Pencil layer added to the store shows as "Pencil" in the document\'s layers', () => {
    useCanvasStore.getState().addLayer(makeLineLayer([0, 0, 30, 30, 60, 10], 'Pencil'))
    const layers = useCanvasStore.getState().doc.layers
    expect(layers[layers.length - 1]?.name).toBe('Pencil')
  })
})

/**
 * T-188 (1), the control for the per-layer rule in `validateProject`: every canvas the app itself makes is a project the app opens. The rule is "what a canvas needs to
 * be drawn"; if a template, the default document, an asset-catalog scene or a layer one of the constructors makes failed it, the rule would be wrong for that field, not the
 * document. Lives here (and not beside the validator) because `src/shared` is typechecked without the renderer. Green on the base by construction (nothing there refuses a
 * layer); it goes red if the rule is tightened past a shape the app writes.
 */
describe('every canvas the app makes passes validateProject (T-188 (1) control)', () => {
  const asProject = (doc: CanvasDocument): unknown => JSON.parse(JSON.stringify({ schemaVersion: MAX_SCHEMA_VERSION, savedAt: Date.now(), appVersion: '1.0.0', imageCanvas: { doc } }))
  const reasonOf = (doc: CanvasDocument): string => {
    const r = validateProject(asProject(doc))
    return r.ok ? 'ok' : r.reason
  }

  it('every template document', () => {
    expect(CANVAS_TEMPLATES.length).toBeGreaterThan(0)
    for (const t of CANVAS_TEMPLATES) expect(reasonOf(t.doc), t.id).toBe('ok')
  })

  it('every asset-catalog scene document', () => {
    for (const a of ASSET_CATALOG) {
      if (a.doc !== undefined) expect(reasonOf(a.doc), a.id).toBe('ok')
    }
  })

  it('the default document, and a document holding one layer of every kind the constructors make', () => {
    useCanvasStore.getState().resetDocument()
    const fresh = useCanvasStore.getState().doc
    expect(reasonOf(fresh)).toBe('ok')
    const layers: CanvasLayer[] = [
      makeImageLayer('data:image/png;base64,AAAA', 40, 30),
      makeReferenceLayer('https://example.test/p.png', 40, 30, 'A reference'),
      makeRectLayer(10, 10),
      makeEllipseLayer(10, 10),
      makeLineLayer([0, 0, 20, 20]),
      makeLineLayer([0, 0, 20, 20, 40, 10], 'Pencil'),
      makeTextLayer(10, 10),
      textLayerFor(fresh, 'A pasted sentence'),
      asHint(makeTextLayer(5, 5, '@yourhandle'))
    ]
    expect(reasonOf({ ...fresh, layers })).toBe('ok')
  })

  it('a layer the store itself changed (rotated, flipped, scaled) still passes', () => {
    useCanvasStore.getState().resetDocument()
    const rect = makeRectLayer(10, 10)
    useCanvasStore.getState().addLayer(rect)
    useCanvasStore.getState().setRotation(rect.id, 33.5)
    useCanvasStore.getState().updateLayer(rect.id, { scaleX: -1, scaleY: 2, opacity: 0.5 })
    expect(reasonOf(useCanvasStore.getState().doc)).toBe('ok')
  })
})
