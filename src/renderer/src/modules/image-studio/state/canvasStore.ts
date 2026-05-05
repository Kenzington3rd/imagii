import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type {
  CanvasDocument,
  CanvasLayer,
  EllipseLayer,
  Guide,
  ImageLayer,
  LineLayer,
  RectLayer,
  TextLayer
} from '@shared/canvas'

const HISTORY_LIMIT = 50

interface History {
  past: CanvasDocument[]
  future: CanvasDocument[]
}

export type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'pencil' | 'colorReplace'

interface CanvasState {
  doc: CanvasDocument
  history: History
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
  updateLayer: (id: string, patch: Partial<CanvasLayer>) => void
  removeLayer: (id: string) => void
  reorderLayers: (orderedIds: string[]) => void
  toggleVisible: (id: string) => void
  toggleLocked: (id: string) => void
  setRotation: (id: string, rotation: number) => void
  duplicateLayer: (id: string) => void

  setBackground: (color: string) => void
  setCanvasSize: (width: number, height: number) => void
  resetDocument: () => void

  addGuide: (axis: 'horizontal' | 'vertical', position: number) => void
  moveGuide: (id: string, position: number) => void
  removeGuide: (id: string) => void
  clearGuides: () => void

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

function defaultDoc(): CanvasDocument {
  return {
    width: 1200,
    height: 800,
    background: '#ffffff',
    layers: [],
    guides: []
  }
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
  selectedLayerId: null,
  tool: 'select',
  showGrid: false,
  snapToGrid: false,
  gridSize: 20,

  setTool: (tool) => set({ tool }),
  setShowGrid: (show) => set({ showGrid: show }),
  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  setGridSize: (size) => set({ gridSize: Math.max(2, size) }),

  selectLayer: (id) => set({ selectedLayerId: id }),
  addLayer: (layer) => {
    const prev = get().doc
    set({
      doc: { ...prev, layers: [...prev.layers, layer] },
      selectedLayerId: layer.id,
      history: pushHistory(get().history, prev)
    })
  },
  updateLayer: (id, patch) => {
    const prev = get().doc
    set({
      doc: {
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === id ? ({ ...l, ...(patch as Partial<typeof l>) } as CanvasLayer) : l
        )
      },
      history: pushHistory(get().history, prev)
    })
  },
  removeLayer: (id) => {
    const prev = get().doc
    set({
      doc: { ...prev, layers: prev.layers.filter((l) => l.id !== id) },
      selectedLayerId: get().selectedLayerId === id ? null : get().selectedLayerId,
      history: pushHistory(get().history, prev)
    })
  },
  reorderLayers: (orderedIds) => {
    const prev = get().doc
    const map = new Map(prev.layers.map((l) => [l.id, l]))
    const next = orderedIds.map((id) => map.get(id)).filter((l): l is CanvasLayer => Boolean(l))
    set({ doc: { ...prev, layers: next }, history: pushHistory(get().history, prev) })
  },
  toggleVisible: (id) => {
    const prev = get().doc
    set({
      doc: {
        ...prev,
        layers: prev.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
      },
      history: pushHistory(get().history, prev)
    })
  },
  toggleLocked: (id) => {
    const prev = get().doc
    set({
      doc: {
        ...prev,
        layers: prev.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l))
      },
      history: pushHistory(get().history, prev)
    })
  },
  setRotation: (id, rotation) => {
    const prev = get().doc
    set({
      doc: {
        ...prev,
        layers: prev.layers.map((l) => (l.id === id ? { ...l, rotation } : l))
      },
      history: pushHistory(get().history, prev)
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
      history: pushHistory(get().history, prev)
    })
  },

  setBackground: (color) => {
    const prev = get().doc
    set({
      doc: { ...prev, background: color },
      history: pushHistory(get().history, prev)
    })
  },
  setCanvasSize: (width, height) => {
    const prev = get().doc
    set({
      doc: { ...prev, width, height },
      history: pushHistory(get().history, prev)
    })
  },
  resetDocument: () => {
    set({ doc: defaultDoc(), history: { past: [], future: [] }, selectedLayerId: null })
  },

  addGuide: (axis, position) => {
    const prev = get().doc
    const guide: Guide = { id: nanoid(8), axis, position }
    set({
      doc: { ...prev, guides: [...(prev.guides ?? []), guide] },
      history: pushHistory(get().history, prev)
    })
  },
  moveGuide: (id, position) => {
    const prev = get().doc
    set({
      doc: {
        ...prev,
        guides: (prev.guides ?? []).map((g) => (g.id === id ? { ...g, position } : g))
      }
    })
  },
  removeGuide: (id) => {
    const prev = get().doc
    set({
      doc: {
        ...prev,
        guides: (prev.guides ?? []).filter((g) => g.id !== id)
      },
      history: pushHistory(get().history, prev)
    })
  },
  clearGuides: () => {
    const prev = get().doc
    set({
      doc: { ...prev, guides: [] },
      history: pushHistory(get().history, prev)
    })
  },

  undo: () => {
    const { history, doc } = get()
    if (history.past.length === 0) return
    const last = history.past[history.past.length - 1]!
    set({
      doc: last,
      history: { past: history.past.slice(0, -1), future: [doc, ...history.future] }
    })
  },
  redo: () => {
    const { history, doc } = get()
    if (history.future.length === 0) return
    const next = history.future[0]!
    set({
      doc: next,
      history: { past: [...history.past, doc], future: history.future.slice(1) }
    })
  },
  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0
}))

export function makeImageLayer(src: string, width: number, height: number): ImageLayer {
  return {
    id: nanoid(8),
    type: 'image',
    name: 'Image',
    visible: true,
    locked: false,
    x: 60,
    y: 60,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    src,
    width,
    height
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
    fill: 'rgba(167,139,250,0.4)',
    stroke: '#a78bfa',
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
    fill: 'rgba(96,165,250,0.4)',
    stroke: '#60a5fa',
    strokeWidth: 2
  }
}

export function makeLineLayer(points: number[], closed = false): LineLayer {
  return {
    id: nanoid(8),
    type: 'line',
    name: closed ? 'Polygon' : 'Line',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    points,
    stroke: '#f472b6',
    strokeWidth: 3,
    closed
  }
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
    fill: '#0b0b0f'
  }
}
