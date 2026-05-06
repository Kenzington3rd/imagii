export type PlatformId = 'youtube' | 'reels' | 'tiktok' | 'twitter' | 'facebook'

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface TextOverlay {
  id: string
  text: string
  font: string
  sizePx: number
  colorHex: string
  x: number
  y: number
  startSec: number
  endSec: number
}

export interface ColorGrade {
  brightness: number
  contrast: number
  saturation: number
  temperature: number
}

export const DEFAULT_COLOR_GRADE: ColorGrade = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0
}

export interface Clip {
  id: string
  name: string
  startSec: number
  endSec: number
  cropRect: CropRect | null
  textOverlays: TextOverlay[]
  selectedPresets: PlatformId[]
  customPresetIds?: string[]
  speedMultiplier?: number
  colorGrade?: ColorGrade
  autoZoom?: boolean
  hypeShake?: boolean
}

export interface WatermarkSpec {
  text: string
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  opacity: number
  fontSizePct: number
}

export interface ExportJobSpec {
  jobId: string
  sourcePath: string
  outDir: string
  clip: Clip
  preset: PlatformId
  watermark?: WatermarkSpec | null
  outputFilename?: string
}

export interface ExportProgress {
  jobId: string
  percent: number
  fps?: number
  timemark?: string
}

export interface ExportResult {
  jobId: string
  outputPath: string
  durationMs: number
}
