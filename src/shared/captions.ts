export interface CaptionsInstallStatus {
  exeInstalled: boolean
  exePath: string
  modelInstalled: boolean
  modelPath: string
  modelsDir: string
  ready: boolean
}

export interface CaptionSegment {
  startSec: number
  endSec: number
  text: string
}

export interface TranscribeRequest {
  jobId: string
  sourcePath: string
  language?: string
}

export interface TranscribeResult {
  jobId: string
  srtPath: string
  segments: CaptionSegment[]
  durationMs: number
}

export type CaptionPosition = 'top' | 'middle' | 'bottom'

export interface CaptionStyle {
  /** Pixel font size used directly in libass force_style. Min 16, max 96. */
  fontSize: number
  /** Vertical placement: top/middle/bottom of the frame. */
  position: CaptionPosition
  /** Hex `#RRGGBB` for the text fill. Translated to ASS &Hbbggrr&. */
  primaryColor: string
  /** Hex `#RRGGBB` for the outline. Translated to ASS &Hbbggrr&. */
  outlineColor: string
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontSize: 32,
  position: 'bottom',
  primaryColor: '#ffffff',
  outlineColor: '#000000'
}

export interface BurnInRequest {
  jobId: string
  videoPath: string
  srtPath: string
  outputPath: string
  /** Legacy field — when style.fontSize is provided, that wins. */
  fontSizePct: number
  /** Phase 3.1: optional libass style overrides. */
  style?: CaptionStyle
  /** Phase 3.1: when set, burn captions only over the trimmed range. */
  startSec?: number
  endSec?: number
}

export interface CaptionsProgress {
  jobId: string
  phase: 'extracting' | 'transcribing' | 'building-srt' | 'burning-in' | 'done'
  percent: number
  message?: string
}
