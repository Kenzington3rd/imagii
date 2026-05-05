import type { Clip, WatermarkSpec } from './clip'
import type { ChainSpec } from './audio'
import type { CanvasDocument } from './canvas'

export interface ImagiiProject {
  schemaVersion: 1
  savedAt: number
  appVersion: string
  videoStudio?: {
    sourcePath: string | null
    clips: Clip[]
    selectedClipId: string | null
    watermark?: WatermarkSpec | null
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
