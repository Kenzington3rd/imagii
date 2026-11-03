import { describe, it, expect, beforeEach } from 'vitest'
import { asHint, displayOpacity, type CanvasDocument, type LayerType, type TextLayer } from '@shared/canvas'
import {
  FONT_SIZE_MIN,
  applyLayerPatch,
  foldTextScale,
  keepsRatioOnCornerDrag,
  makeImageLayer,
  makeReferenceLayer,
  makeTextLayer,
  textLayerFor,
  useCanvasStore
} from './canvasStore'
import { CANVAS_TEMPLATES } from '../templates'
import { ASSET_CATALOG } from '../../references/assetCatalog'
import { contrastRatio, estimatedTextBox, surfacesUnder, worstContrast } from '@shared/newText'
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
