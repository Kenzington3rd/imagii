import type { Clip, WatermarkSpec } from './clip'
import type { ChainSpec } from './audio'
import type { CanvasDocument } from './canvas'

/**
 * Schema versions:
 *   1 — initial
 *   2 — adds optional videoStudio.srtPath (path to a previously-transcribed
 *       SRT file). Migration is automatic on load: v1 projects get an
 *       implicit srtPath: undefined and are bumped to v2 in memory.
 */
export interface ImagiiProject {
  schemaVersion: 1 | 2
  savedAt: number
  appVersion: string
  videoStudio?: {
    sourcePath: string | null
    clips: Clip[]
    selectedClipId: string | null
    watermark?: WatermarkSpec | null
    /** Phase 4-tech-debt: persisted across sessions so Clip Kit can
     *  bundle SRT and the user doesn't lose the transcribed file. */
    srtPath?: string | null
  }
  audioStudio?: {
    sourcePath: string | null
    fromVideoPath?: string | null
    chain: ChainSpec
  }
  imageCanvas?: {
    doc: CanvasDocument
  }
}

export interface ChainPreset {
  id: string
  name: string
  chain: ChainSpec
  createdAt: number
}

export interface RecordingSource {
  id: string
  name: string
  thumbnailDataUrl: string
  type: 'screen' | 'window'
}

export interface RecordingSpec {
  webmBytes: ArrayBuffer
  filename: string
  sourceLabel?: string
  durationMs?: number
  convertToMp4: boolean
}

export interface RecordingResult {
  outputPath: string
  sizeBytes: number
  format: 'webm' | 'mp4'
  durationMs: number
}
