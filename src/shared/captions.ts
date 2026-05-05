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

export interface BurnInRequest {
  jobId: string
  videoPath: string
  srtPath: string
  outputPath: string
  fontSizePct: number
}

export interface CaptionsProgress {
  jobId: string
  phase: 'extracting' | 'transcribing' | 'building-srt' | 'burning-in' | 'done'
  percent: number
  message?: string
}
