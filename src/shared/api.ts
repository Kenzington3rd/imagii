import type { ExportJobSpec, ExportProgress, ExportResult } from './clip'
import type {
  AudioProbe,
  AudioExportSpec,
  AudioJobProgress,
  AudioJobResult,
  AudioMuxSpec
} from './audio'

export type SettingsKey = 'ageVerified' | 'ageVerifiedAt' | 'theme' | 'lastRoute'

export interface VideoProbe {
  duration: number
  width: number
  height: number
  fps: number
  videoCodec: string
  audioCodec: string | null
  bitrate: number
  sizeBytes: number
}

export type Unsubscribe = () => void

export interface ImagiiApi {
  settings: {
    get<T = unknown>(key: SettingsKey): Promise<T | undefined>
    set<T = unknown>(key: SettingsKey, value: T): Promise<void>
  }
  app: {
    quit(): void
    getVersion(): Promise<string>
  }
  video: {
    probe(filePath: string): Promise<VideoProbe>
    pickFile(): Promise<string | null>
    pickOutputDir(): Promise<string | null>
    fileUrl(filePath: string): string
    exportBatch(jobs: ExportJobSpec[]): Promise<ExportResult[]>
    cancel(jobId: string): Promise<boolean>
    revealInFolder(filePath: string): Promise<void>
    onProgress(handler: (p: ExportProgress) => void): Unsubscribe
    onJobComplete(handler: (info: { jobId: string; outputPath: string }) => void): Unsubscribe
  }
  audio: {
    probe(filePath: string): Promise<AudioProbe>
    pickFile(): Promise<string | null>
    pickOutputFile(options: { defaultName?: string; format: string }): Promise<string | null>
    extractFromVideo(videoPath: string): Promise<string>
    export(spec: AudioExportSpec): Promise<AudioJobResult>
    mux(spec: AudioMuxSpec): Promise<AudioJobResult>
    cancel(jobId: string): Promise<boolean>
    revealInFolder(filePath: string): Promise<void>
    suggestOutputName(sourcePath: string, format: string): Promise<string>
    onProgress(handler: (p: AudioJobProgress) => void): Unsubscribe
  }
}

declare global {
  interface Window {
    api: ImagiiApi
  }
}
