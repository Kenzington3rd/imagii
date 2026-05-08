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

/**
 * Phase 4A.2: named one-click caption styling presets. Each is a complete
 * CaptionStyle the renderer can apply with a single click — most users
 * will never touch the underlying sliders. Order is "most expected first":
 * TikTok-style is the default people reach for; accessibility is the most
 * conservative; subtle is for podcast-style content where captions should
 * never dominate; reels-minimal is the muted take.
 */
export interface CaptionStylePreset {
  id: 'tiktok-bold' | 'reels-minimal' | 'subtle-subtitle' | 'big-outline-accessibility'
  label: string
  hint: string
  style: CaptionStyle
}

export const CAPTION_STYLE_PRESETS: readonly CaptionStylePreset[] = [
  {
    id: 'tiktok-bold',
    label: 'TikTok bold',
    hint: 'Big white text, thick black outline, mid-frame — what dominates short-form right now.',
    style: {
      fontSize: 56,
      position: 'middle',
      primaryColor: '#ffffff',
      outlineColor: '#000000'
    }
  },
  {
    id: 'reels-minimal',
    label: 'Reels minimal',
    hint: 'Smaller, lower-third, muted — fits Reels/IG aesthetics that punish loud captions.',
    style: {
      fontSize: 28,
      position: 'bottom',
      primaryColor: '#f5f5f5',
      outlineColor: '#222222'
    }
  },
  {
    id: 'subtle-subtitle',
    label: 'Subtle subtitle',
    hint: 'Classic small bottom subtitle. Use for podcasts/long-form where captions should never dominate.',
    style: {
      fontSize: 24,
      position: 'bottom',
      primaryColor: '#ffffff',
      outlineColor: '#000000'
    }
  },
  {
    id: 'big-outline-accessibility',
    label: 'Big-outline accessibility',
    hint: 'High-contrast yellow with thick black outline — maximum readability for low-vision viewers.',
    style: {
      fontSize: 48,
      position: 'bottom',
      primaryColor: '#ffff00',
      outlineColor: '#000000'
    }
  }
] as const

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

/** Phase 4E: Whisper model auto-install progress events. */
export interface ModelInstallProgress {
  phase: 'starting' | 'downloading' | 'verifying' | 'done' | 'failed'
  bytesDownloaded?: number
  totalBytes?: number
  percent?: number
  message?: string
}

/** The model file imagii ships against. Pinned to base.en for English-only,
 *  reasonable accuracy, ~141 MB on disk. Changing this requires updating
 *  WHISPER_MODEL_URL together. */
export const WHISPER_MODEL_FILENAME = 'ggml-base.en.bin'

/** Canonical download URL. Hugging Face mirror is used because GitHub LFS
 *  for the same file is rate-limited per IP and unreliable. */
export const WHISPER_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'

/** Sanity-check bounds. Real file is ~141 MB; reject anything outside this
 *  range as either incomplete or wrong-file-served. */
export const WHISPER_MODEL_MIN_BYTES = 100 * 1024 * 1024
export const WHISPER_MODEL_MAX_BYTES = 200 * 1024 * 1024
