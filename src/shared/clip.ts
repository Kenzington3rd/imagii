import type { CustomPreset } from './customPresets'

/** The five built-in platforms, as data. `ALL_PLATFORM_IDS` (renderer) and
 *  `ALL_PRESET_IDS` (main) are the ordered display copies of this list and
 *  are pinned equal to each other by `presetTablesInSync.test.ts`; this one
 *  exists so code with no table in reach — the custom-preset parser — can
 *  still tell a real platform id from a hand-edited one. */
export const PLATFORM_IDS = ['youtube', 'reels', 'tiktok', 'twitter', 'facebook'] as const

export type PlatformId = (typeof PLATFORM_IDS)[number]

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
  /** Ids of saved custom presets queued for this clip (T-50). They are
   *  export targets exactly like `selectedPresets`; the ids are resolved
   *  against the on-disk list, and one that no longer exists is pruned
   *  rather than queued. */
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
  /** T-50 — a custom preset the user queued. When present the encode runs
   *  at ITS geometry, fps and bitrates; `preset` stays the platform it was
   *  built on, which is what the advisory tables key off. The whole preset
   *  travels with the job, so a job already handed to main keeps its
   *  dimensions even if the preset is deleted while the batch runs. */
  customPreset?: CustomPreset | null
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
