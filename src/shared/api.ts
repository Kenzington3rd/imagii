import type { ExportJobSpec, ExportProgress, ExportResult } from './clip'
import type {
  AudioProbe,
  AudioExportSpec,
  AudioJobProgress,
  AudioJobResult,
  AudioMuxSpec
} from './audio'
import type {
  AiInstallStatus,
  Txt2ImgRequest,
  InpaintRequest,
  OutpaintRequest,
  GenerationResult,
  AiJobProgress
} from './ai'
import type { SafetyResult } from './safety'
import type { SearchResponse, MoodBoardCollection, SearchResult } from './search'
import type {
  CaptionsInstallStatus,
  CaptionsProgress,
  TranscribeRequest,
  TranscribeResult,
  BurnInRequest
} from './captions'

export type SettingsKey =
  | 'theme'
  | 'lastRoute'
  | 'welcomeSeen'
  | 'tutorialSeen.video'
  | 'tutorialSeen.audio'
  | 'tutorialSeen.image'
  | 'tutorialSeen.ai'
  | 'streamerHandle'

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
    onHighlightProgress(
      handler: (p: { jobId: string; phase: string; percent: number }) => void
    ): Unsubscribe
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
  ai: {
    status(): Promise<AiInstallStatus>
    checkPrompt(prompt: string): Promise<SafetyResult>
    txt2img(req: Txt2ImgRequest): Promise<GenerationResult>
    inpaint(req: InpaintRequest): Promise<GenerationResult>
    outpaint(req: OutpaintRequest): Promise<GenerationResult>
    openModelsFolder(): Promise<void>
    openBinFolder(): Promise<void>
    onProgress(handler: (p: AiJobProgress) => void): Unsubscribe
  }
  search: {
    images(query: string): Promise<SearchResponse>
  }
  image: {
    savePdf(spec: {
      pages: Array<{ pngBase64: string; widthPx: number; heightPx: number }>
      dpi: number
      title?: string
      defaultName?: string
    }): Promise<{ outputPath: string; sizeBytes: number } | null>
    revealInFolder(filePath: string): Promise<void>
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
}

declare global {
  interface Window {
    api: ImagiiApi
  }
}
