import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { ACCENT, BG_BASE, INK_BASE, withAlpha } from '../../../styles/tokens'
import type {
  CanvasDocument,
  CanvasLayer,
  EllipseLayer,
  ImageLayer,
  LayerType,
  LineLayer,
  RectLayer,
  TextLayer
} from '@shared/canvas'
import { newTextLook } from '@shared/newText'

const HISTORY_LIMIT = 50

interface History {
  past: CanvasDocument[]
  future: CanvasDocument[]
}

export type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'pencil'

interface CanvasState {
  doc: CanvasDocument
  history: History
  /** T-147 (T-78): the control whose edits the last undo step already covers, or null. A slider drag or a typed name is ONE undo step: `updateLayer(id, patch, key)`
   *  pushes only when the key is not the one the previous edit carried. Discrete actions, undo / redo, selecting and `endGesture` reset it to null. */
  historyKey: string | null
  selectedLayerId: string | null
  tool: Tool
  showGrid: boolean
  snapToGrid: boolean
  gridSize: number

  setTool: (tool: Tool) => void
  setShowGrid: (show: boolean) => void
  setSnapToGrid: (snap: boolean) => void
  setGridSize: (size: number) => void

  selectLayer: (id: string | null) => void
  addLayer: (layer: CanvasLayer) => void
  /** Patch one layer. `key` (a control's name, e.g. 'opacity') makes the edit coalescible: the first edit of a gesture records the undo step and the rest of that
   *  gesture, on the same layer and control, record none. Without a key it is a discrete edit and always records one (T-147, T-78). */
  updateLayer: (id: string, patch: Partial<CanvasLayer>, key?: string) => void
  /** End the coalescing window: the next edit, even of the same control, is a new undo step. Called when a drag is released or a field loses focus. */
  endGesture: () => void
  removeLayer: (id: string) => void
  reorderLayers: (orderedIds: string[]) => void
  toggleVisible: (id: string) => void
  toggleLocked: (id: string) => void
  setRotation: (id: string, rotation: number) => void
  duplicateLayer: (id: string) => void

  /** Replace the document WITHOUT recording an undo step, clearing the
   *  history — "open a file", not "edit the canvas". Called with no
   *  argument it resets to an empty document. T-47: a session restore goes
   *  through here rather than `setDocument`, so the app never opens with
   *  Home's Undo offering to revert the work it just brought back. */
  resetDocument: (doc?: CanvasDocument) => void
  /** Replace the document as an undoable edit (templates, image import). */
  setDocument: (doc: CanvasDocument) => void

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

/**
 * T-71 note on where the token line falls in this file.
 *
 * The four `make*Layer` defaults below were authored FROM the palette —
 * three of them were the token hex spelled long-hand (accent, ember,
 * bg-base) and the fourth was a raw `rose-500`, the same palette leak T-56
 * found in WaveformView. They are the app's own default marks, so they
 * follow the tokens: a retheme should hand the user shapes in imagii's
 * colors, not in a colour frozen from round 19.
 *
 * `background` below is the exception and stays literal. A blank page is
 * white because pages are white — it is document content, not chrome, and
 * no token expresses it. Same reasoning keeps `templates.ts` and
 * `assetCatalog.ts` on literals; see DESIGN_GUIDE's exception list.
 */
function defaultDoc(): CanvasDocument {
  return {
    width: 1200,
    height: 800,
    background: '#ffffff',
    layers: []
  }
}

/**
 * A layer with `patch` applied. One rule beyond the merge (T-91): a hint TEXT
 * layer whose words are changed stops being a hint. "@yourhandle" is a
 * placeholder only until the user types their own handle — after that it is
 * their text, and an export that silently dropped it would ship a graphic
 * missing the one thing they filled in.
 */
export function applyLayerPatch(layer: CanvasLayer, patch: Partial<CanvasLayer>): CanvasLayer {
  const next = { ...layer, ...(patch as Partial<typeof layer>) } as CanvasLayer
  const retyped =
    layer.hint === true &&
    layer.type === 'text' &&
    'text' in patch &&
    (patch as Partial<TextLayer>).text !== layer.text
  return retyped ? { ...next, hint: false } : next
}

/**
 * The selection a document can keep (T-141 (8)): `id` if it names a layer there, else none. Undo and redo swap the whole document, so the layer a person had selected may
 * not exist in the one that comes back (undo of "+ Add text" removes the word it selected), and Delete on that stale id recorded a step that changed nothing and cleared Redo.
 */
function selectionIn(doc: CanvasDocument, id: string | null): string | null {
  return id !== null && doc.layers.some((l) => l.id === id) ? id : null
}

/** The same value for the record: identical, or two lists (a line's `points`) of the same values in the same order. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
}

function pushHistory(history: History, prev: CanvasDocument): History {
  const past = [...history.past, prev]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: []
  }
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  doc: defaultDoc(),
  history: { past: [], future: [] },
  historyKey: null,
  selectedLayerId: null,
  tool: 'select',
  showGrid: false,
  snapToGrid: false,
  gridSize: 20,

  setTool: (tool) => set({ tool }),
  setShowGrid: (show) => set({ showGrid: show }),
  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  setGridSize: (size) => set({ gridSize: Math.max(2, size) }),

  selectLayer: (id) => set({ selectedLayerId: id, historyKey: null }),
  addLayer: (layer) => {
    const prev = get().doc
    set({
      doc: { ...prev, layers: [...prev.layers, layer] },
      selectedLayerId: layer.id,
      history: pushHistory(get().history, prev),
      historyKey: null
    })
  },
  updateLayer: (id, patch, key) => {
    const prev = get().doc
    // T-167 (2): an edit that changes nothing is nothing to undo, and a step that changes nothing would also clear Redo (the class of `videoStore` T-166 (3) and `removeLayer` T-141 (8)).
    // A snapped drag shorter than half a cell writes the layer's own x and y back; a patch is a no-op when every field it names has the same value on the PATCHED layer (after
    // `applyLayerPatch`'s normalising) as on the stored one. Before the history and the coalescing key: neither moves.
    const stored = prev.layers.find((l) => l.id === id)
    if (!stored) return
    const patched = applyLayerPatch(stored, patch) as unknown as Record<string, unknown>
    const was = stored as unknown as Record<string, unknown>
    if (Object.keys(patch).every((field) => sameValue(patched[field], was[field]))) return
    // The window is per layer AND per control: the same slider on another layer is another gesture.
    const windowKey = key === undefined ? null : `${id}:${key}`
    const continuing = windowKey !== null && windowKey === get().historyKey
    set({
      doc: {
        ...prev,
        layers: prev.layers.map((l) => (l.id === id ? applyLayerPatch(l, patch) : l))
      },
      // The first edit of a gesture already captured the pre-gesture document.
      ...(continuing ? {} : { history: pushHistory(get().history, prev) }),
      historyKey: windowKey
    })
  },
  endGesture: () => {
    // Gesture ends are frequent (every pointerup in the panel): writing the same null back would notify every subscriber for nothing.
    if (get().historyKey === null) return
    set({ historyKey: null })
  },
  removeLayer: (id) => {
    const prev = get().doc
    // T-141 (8): a layer that is not there is nothing to remove, and nothing to undo: a step that changes nothing would also clear Redo (`videoStore.removeClip` guards this).
    if (!prev.layers.some((l) => l.id === id)) return
    const layers = prev.layers.filter((l) => l.id !== id)
    set({
      // T-140 (4): a document with no layers IS the blank page. The studio shows its templates-first screen for one ("Pick a template to start ... or start blank"), so
      // the size and background of the template that was open are not a canvas anyone chose, and an import or "Start with text" from that screen used to land on the
      // 112x112 emote (and Export wrote the emote pack). Undo puts the template's document back whole: `prev` is what the history keeps.
      doc: layers.length === 0 ? defaultDoc() : { ...prev, layers },
      selectedLayerId: get().selectedLayerId === id ? null : get().selectedLayerId,
      history: pushHistory(get().history, prev),
      historyKey: null
    })
  },
  reorderLayers: (orderedIds) => {
    const prev = get().doc
    const map = new Map(prev.layers.map((l) => [l.id, l]))
    const next = orderedIds.map((id) => map.get(id)).filter((l): l is CanvasLayer => Boolean(l))
    // T-167 (2): the same layers in the same order is nothing to undo (and would clear Redo).
    if (next.length === prev.layers.length && next.every((l, i) => l === prev.layers[i])) return
    set({ doc: { ...prev, layers: next }, history: pushHistory(get().history, prev), historyKey: null })
  },
  toggleVisible: (id) => {
    const prev = get().doc
    set({
      doc: {
        ...prev,
        layers: prev.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
      },
      history: pushHistory(get().history, prev),
      historyKey: null
    })
  },
  toggleLocked: (id) => {
    const prev = get().doc
    set({
      doc: {
        ...prev,
        layers: prev.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l))
      },
      history: pushHistory(get().history, prev),
      historyKey: null
    })
  },
  setRotation: (id, rotation) => {
    const prev = get().doc
    // T-167 (2): a layer that is not there, or already at this rotation (the "0" preset on a layer at 0, a layer with no rotation counting as 0), is nothing to undo - and a step
    // that changes nothing would also clear Redo.
    const stored = prev.layers.find((l) => l.id === id)
    if (!stored || (stored.rotation ?? 0) === rotation) return
    set({
      doc: {
        ...prev,
        layers: prev.layers.map((l) => (l.id === id ? { ...l, rotation } : l))
      },
      history: pushHistory(get().history, prev),
      historyKey: null
    })
  },
  duplicateLayer: (id) => {
    const prev = get().doc
    const original = prev.layers.find((l) => l.id === id)
    if (!original) return
    const copy: CanvasLayer = {
      ...original,
      id: nanoid(8),
      name: `${original.name} copy`,
      x: original.x + 20,
      y: original.y + 20
    }
    set({
      doc: { ...prev, layers: [...prev.layers, copy] },
      selectedLayerId: copy.id,
      history: pushHistory(get().history, prev),
      historyKey: null
    })
  },

  resetDocument: (doc) => {
    set({ doc: doc ?? defaultDoc(), history: { past: [], future: [] }, selectedLayerId: null, historyKey: null })
  },
  setDocument: (doc) => {
    const prev = get().doc
    set({
      doc,
      selectedLayerId: null,
      history: pushHistory(get().history, prev),
      historyKey: null
    })
  },

  undo: () => {
    const { history, doc } = get()
    if (history.past.length === 0) return
    const last = history.past[history.past.length - 1]!
    set({
      doc: last,
      selectedLayerId: selectionIn(last, get().selectedLayerId),
      history: { past: history.past.slice(0, -1), future: [doc, ...history.future] },
      historyKey: null
    })
  },
  redo: () => {
    const { history, doc } = get()
    if (history.future.length === 0) return
    const next = history.future[0]!
    set({
      doc: next,
      selectedLayerId: selectionIn(next, get().selectedLayerId),
      history: { past: [...history.past, doc], future: history.future.slice(1) },
      historyKey: null
    })
  },
  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0
}))

export function makeImageLayer(src: string, width: number, height: number, x = 60, y = 60): ImageLayer {
  return {
    id: nanoid(8),
    type: 'image',
    name: 'Image',
    visible: true,
    locked: false,
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    src,
    width,
    height
  }
}

/**
 * A mood-board picture dropped on the canvas as a 40%-opacity reference to
 * trace or match (T-91: a `hint`, so the export leaves it out — a faded
 * competitor thumbnail is never part of what the user posts).
 */
export function makeReferenceLayer(
  src: string,
  width: number,
  height: number,
  title: string, x?: number, y?: number
): ImageLayer {
  return {
    ...makeImageLayer(src, width, height, x, y),
    name: title.slice(0, 40),
    opacity: 0.4,
    hint: true
  }
}

export function makeRectLayer(x: number, y: number, w = 200, h = 120): RectLayer {
  return {
    id: nanoid(8),
    type: 'rect',
    name: 'Rectangle',
    visible: true,
    locked: false,
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    width: w,
    height: h,
    fill: withAlpha(ACCENT, 0.4),
    stroke: ACCENT,
    strokeWidth: 2,
    cornerRadius: 8
  }
}

export function makeEllipseLayer(x: number, y: number, rx = 80, ry = 60): EllipseLayer {
  return {
    id: nanoid(8),
    type: 'ellipse',
    name: 'Ellipse',
    visible: true,
    locked: false,
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    radiusX: rx,
    radiusY: ry,
    fill: withAlpha(ACCENT, 0.4),
    stroke: ACCENT,
    strokeWidth: 2
  }
}

/**
 * T-174 (3): a straight Line and a freehand Pencil stroke are the same layer type; `name` is what the Layers panel shows, so it says which tool drew it
 * (the toolbar and the tutorial call them "Line" and "Pencil"). `closed` is always false: no tool draws a closed shape, and the field stays on the type
 * for the project files that carry it.
 */
export function makeLineLayer(points: number[], name: 'Line' | 'Pencil' = 'Line'): LineLayer {
  return {
    id: nanoid(8),
    type: 'line',
    name,
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    points,
    // T-193 (4): the accent, the Rectangle's and Ellipse's stroke and the Line tool's draw preview. Ember was 1.67:1 on the default white page, and Line and
    // Pencil have no colour box (T-186), so the default is the colour a person gets.
    stroke: ACCENT,
    strokeWidth: 3,
    closed: false
  }
}

/**
 * A new text layer for the document that is open (T-140 (2)): sized to it, placed inside it by the rule a picture follows, and inked against what is under it - the near-black
 * on a white page, the light ink on a dark or transparent one (`newTextLook`, `@shared/newText`, which takes the colors from here so they stay tokens). T-141 (2): "what is
 * under it" is the document AND the shapes and words its box overlaps (`doc.layers`), so the emote's word is inked against the disc it sits on and a document with no
 * readable corner gets its word moved to a place that is. `makeTextLayer` is the layer itself and stays what it was for its other callers (a position it is given, 32 px,
 * `BG_BASE`).
 *
 * T-166 (1): `word` is the words the layer will hold when the caller already has them (a paste): the size, place and ink are chosen for THEM, not for "Text" (a pasted sentence on the
 * Bold thumbnail landed 70% off the page). The layer's own `text` stays the default word; the caller sets it. With no word it is the layer it always was.
 */
export function textLayerFor(doc: Pick<CanvasDocument, 'width' | 'height' | 'background'> & Partial<Pick<CanvasDocument, 'layers'>>, word?: string): TextLayer {
  const look = newTextLook(doc, { dark: BG_BASE, light: INK_BASE, behind: BG_BASE }, word)
  return { ...makeTextLayer(look.x, look.y), fontSize: look.fontSize, fill: look.fill }
}

/**
 * Does a corner drag on this kind of layer keep its proportions (T-140 (3))? A picture and a word have proportions of their own (a stretched logo, stretched glyphs, and
 * the stretch is what the export carries - a word keeps what is left of one in `scaleX` after its size has absorbed the height, `foldTextScale`); a rectangle's, an ellipse's
 * and a line's width and height are the point of resizing them. Shift flips it either way (Konva's Transformer; `Canvas.tsx`). The side handles stretch every layer.
 */
export function keepsRatioOnCornerDrag(type: LayerType): boolean {
  return type === 'image' || type === 'text'
}

/** The smallest a text layer's size can be (px): the 4 the Size field's attribute says, enforced when typing ends and when a resize ends. */
export const FONT_SIZE_MIN = 4

/** Two scales this near are one scale: a corner drag that kept its ratio (Konva's own arithmetic ends within float error of it). */
const UNIFORM_SCALE_TOLERANCE = 0.005

/**
 * What a text layer's size and scale become when a resize ends (T-141 (6)): the scale folded into the size.
 *
 * The Transformer scales the node, and the store kept `scaleX` / `scaleY` while Properties shows `fontSize`: after the corner drag T-140 (3) made the natural way to size a
 * word, "Size (px)" said 32 over a word drawn at 44, and a size typed afterwards was multiplied by the kept scale. A word is sized by its font size, so the size absorbs the
 * height: `fontSize` becomes `fontSize * |scaleY|` to the Size field's whole pixel (never under `FONT_SIZE_MIN`), the vertical scale becomes 1 (keeping a flip's sign), and a
 * stretch that is left stays in `scaleX` - a corner drag that kept its ratio leaves none (`scaleX` 1), a Shift-freed drag leaves the width/height ratio it made, measured
 * against the size it landed on so the drawn width is what the person dragged to and not what the rounding left. The drawn height moves by under half a pixel (the
 * rounding), which is the price of the Size field showing what is drawn.
 */
export function foldTextScale(fontSize: number, scaleX: number, scaleY: number): { fontSize: number; scaleX: number; scaleY: number } {
  const size = Math.max(FONT_SIZE_MIN, Math.round(fontSize * Math.abs(scaleY)))
  const uniform = Math.abs(Math.abs(scaleX) - Math.abs(scaleY)) <= UNIFORM_SCALE_TOLERANCE
  const flipX = scaleX < 0 ? -1 : 1
  return { fontSize: size, scaleX: uniform ? flipX : (scaleX * fontSize) / size, scaleY: scaleY < 0 ? -1 : 1 }
}

export function makeTextLayer(x: number, y: number, text = 'Text'): TextLayer {
  return {
    id: nanoid(8),
    type: 'text',
    name: 'Text',
    visible: true,
    locked: false,
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    text,
    fontSize: 32,
    fontFamily: 'Inter, sans-serif',
    fill: BG_BASE
  }
}
