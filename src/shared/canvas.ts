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

export interface ImageExportSpec {
  format: ImageExportFormat
  quality: number
  dpi: number
  perLayer: boolean
}
