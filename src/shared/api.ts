import type { ExportJobSpec, ExportProgress, ExportResult } from './clip'
import type {
  AudioProbe,
  AudioExportSpec,
  AudioJobProgress,
  AudioJobResult,
  AudioMuxSpec,
  ChainSpec
} from './audio'
import type { SearchResponse, MoodBoardCollection, SearchResult } from './search'
import type {
  CaptionsInstallStatus,
  CaptionsProgress,
  TranscribeRequest,
  TranscribeResult,
  BurnInRequest
} from './captions'
import type {
  ImagiiProject,
  ChainPreset,
  RecordingSource,
  RecordingSpec,
  RecordingResult
} from './workspace'
import type { CustomPreset } from './customPresets'

export type SettingsKey =
  | 'theme'
  | 'lastRoute'
  | 'welcomeSeen'
  | 'tutorialSeen.video'
  | 'tutorialSeen.audio'
  | 'tutorialSeen.image'
  | 'tutorialSeen.ai'
  | 'streamerHandle'
  | 'filenameTemplate'
  | 'recentFiles.video'
  | 'recentFiles.audio'
  | 'recentFiles.image'

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
    cancelAll(): Promise<void>
    revealInFolder(filePath: string): Promise<void>
    onProgress(handler: (p: ExportProgress) => void): Unsubscribe
    onJobComplete(handler: (info: { jobId: string; outputPath: string }) => void): Unsubscribe
    reframe(params: {
      sourcePath: string
      outDir: string
      position: 'left' | 'center' | 'right' | 'smart'
      startSec: number
      endSec: number
      targetWidth: number
      targetHeight: number
    }): Promise<{ outputPath: string }>
    onReframeProgress(
      handler: (p: { jobId: string; phase: string; percent: number }) => void
    ): Unsubscribe
    findHighlights(sourcePath: string): Promise<
      Array<{ startSec: number; endSec: number; peakDb: number; reason: string }>
    >
    analyzeClipHook(params: {
      sourcePath: string
      startSec: number
      durationSec?: number
    }): Promise<{ audioEnergyDb: number }>
    extractFrame(params: {
      sourcePath: string
      timeSec: number
      outputPath: string
    }): Promise<{ outputPath: string }>
    makeKitDir(params: { parentDir: string; clipName: string }): Promise<string>
    onHighlightProgress(
      handler: (p: { jobId: string; phase: string; percent: number }) => void
    ): Unsubscribe
    exportGif(params: {
      sourcePath: string
      outDir: string
      startSec: number
      endSec: number
      width: number
      fps: number
      speed: number
    }): Promise<{ outputPath: string }>
    listCustomPresets(): Promise<CustomPreset[]>
    saveCustomPreset(preset: Omit<CustomPreset, 'id'>): Promise<CustomPreset>
    deleteCustomPreset(id: string): Promise<void>
    concat(params: {
      sourcePath: string
      outDir: string
      segments: Array<{ startSec: number; endSec: number; name: string }>
      fadeMs: number
      width: number
      height: number
    }): Promise<{ outputPath: string }>
    pipComposite(params: {
      basePath: string
      overlayPath: string
      outDir: string
      overlayWidth: number
      position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
      margin: number
    }): Promise<{ outputPath: string }>
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
    listPresets(): Promise<ChainPreset[]>
    savePreset(name: string, chain: ChainSpec): Promise<ChainPreset>
    deletePreset(id: string): Promise<void>
  }
  search: {
    images(query: string): Promise<SearchResponse>
  }
  captions: {
    status(): Promise<CaptionsInstallStatus>
    transcribe(req: TranscribeRequest): Promise<TranscribeResult>
    burnIn(req: BurnInRequest): Promise<{ outputPath: string }>
    saveSrt(srtPath: string, defaultName: string): Promise<string | null>
    pickBurnInOutput(defaultName: string): Promise<string | null>
    openBinFolder(): Promise<void>
    openModelsFolder(): Promise<void>
    onProgress(handler: (p: CaptionsProgress) => void): Unsubscribe
  }
  moodboard: {
    list(): Promise<MoodBoardCollection[]>
    create(name: string): Promise<MoodBoardCollection>
    delete(id: string): Promise<void>
    rename(id: string, name: string): Promise<MoodBoardCollection | null>
    addItem(collectionId: string, result: SearchResult): Promise<MoodBoardCollection | null>
    removeItem(collectionId: string, itemId: string): Promise<MoodBoardCollection | null>
    prune(): Promise<void>
  }
  project: {
    save(project: ImagiiProject, defaultName?: string): Promise<string | null>
    load(): Promise<
      | { ok: true; project: ImagiiProject; filePath: string }
      | { ok: false; reason: string }
      | null
    >
  }
  autosave: {
    write(
      project: ImagiiProject
    ): Promise<{ ok: true; sizeBytes: number } | { ok: false; reason: string }>
    read(): Promise<{
      ok: boolean
      reason?: string
      project?: ImagiiProject
      info?: { exists: boolean; filePath: string; savedAt?: number; ageMs?: number; sizeBytes?: number }
    }>
    info(): Promise<{
      exists: boolean
      filePath: string
      savedAt?: number
      ageMs?: number
      sizeBytes?: number
    }>
    clear(): Promise<void>
  }
  recording: {
    listSources(): Promise<RecordingSource[]>
    save(spec: RecordingSpec): Promise<RecordingResult | null>
  }
}

declare global {
  interface Window {
    api: ImagiiApi
  }
}
