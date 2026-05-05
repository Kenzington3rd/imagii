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

export interface Clip {
  id: string
  name: string
  startSec: number
  endSec: number
  cropRect: CropRect | null
  textOverlays: TextOverlay[]
  selectedPresets: PlatformId[]
  speedMultiplier?: number
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
