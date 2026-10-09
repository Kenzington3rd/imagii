export type LayerType = 'image' | 'rect' | 'ellipse' | 'line' | 'text'

export interface BaseLayer {
  id: string
  type: LayerType
  name: string
  visible: boolean
  locked: boolean
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
  opacity: number
  /**
   * T-91: this layer is guidance for the person editing — a facecam hole, a
   * "Drop face here" hint, an "@yourhandle" placeholder, a mood-board
   * reference — and is LEFT OUT of every export. It still draws on the canvas
   * and stays in the project; only the capture skips it
   * (`captureDocument`). Absent means false, so every layer saved before this
   * field existed exports as it always did. Editing a text layer's words
   * clears it (canvasStore.updateLayer): text the user wrote is theirs.
   */
  hint?: boolean
}

export interface ImageLayer extends BaseLayer {
  type: 'image'
  src: string
  width: number
  height: number
}

export interface RectLayer extends BaseLayer {
  type: 'rect'
  width: number
  height: number
  fill: string
  stroke: string
  strokeWidth: number
  cornerRadius: number
}

export interface EllipseLayer extends BaseLayer {
  type: 'ellipse'
  radiusX: number
  radiusY: number
  fill: string
  stroke: string
  strokeWidth: number
}

export interface LineLayer extends BaseLayer {
  type: 'line'
  points: number[]
  stroke: string
  strokeWidth: number
  closed: boolean
}

export interface TextLayer extends BaseLayer {
  type: 'text'
  text: string
  fontSize: number
  fontFamily: string
  fill: string
}

export type CanvasLayer = ImageLayer | RectLayer | EllipseLayer | LineLayer | TextLayer

export interface CanvasDocument {
  width: number
  height: number
  background: string
  layers: CanvasLayer[]
}

export type ImageExportFormat = 'png' | 'jpg' | 'svg' | 'pdf'

/** The two formats the Export button writes (T-91). */
export type ImageSaveFormat = 'png' | 'jpg'

/** One picture to save through the native Save dialog. */
export interface ImageSaveRequest {
  /** `data:image/png;base64,…` or `data:image/jpeg;base64,…` from Konva. */
  dataUrl: string
  /** The name the dialog opens with; main keeps only a safe file name from it. */
  defaultName: string
  format: ImageSaveFormat
}

/** Several pictures written into ONE folder the user picks (one dialog, not N). */
export interface ImageSaveManyRequest {
  /** The folder picker's title — says what is being saved. */
  title: string
  files: Array<{ name: string; dataUrl: string }>
}

export interface ImageExportSpec {
  format: ImageExportFormat
  quality: number
  dpi: number
  perLayer: boolean
}

/**
 * The Konva `name` the canvas gives every hint layer's node. `captureDocument`
 * (ExportDialog.tsx) switches off whatever carries it for the duration of an
 * export, the same way it switches off the editor's `chrome` layers (T-53).
 */
export const HINT_NODE_NAME = 'hint'

/** Mark a layer as guidance that never reaches an export (see `BaseLayer.hint`). */
export function asHint<T extends CanvasLayer>(layer: T): T {
  return { ...layer, hint: true }
}

/**
 * The small tag the Layers panel puts on a layer an export will leave out, or
 * null for a layer that exports. A picture can only be a mood-board reference
 * (that is the one place an image layer is made a hint); everything else is a
 * template's hint or placeholder.
 */
export function hintTag(layer: CanvasLayer): string | null {
  if (!layer.hint) return null
  return layer.type === 'image' ? "reference \u2014 won't export" : "hint \u2014 won't export"
}
