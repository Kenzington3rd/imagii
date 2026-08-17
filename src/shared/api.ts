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
  ModelInstallProgress,
  TranscribeRequest,
  TranscribeResult,
  BurnInRequest
} from './captions'
import type {
  ImagiiProject,
  ChainPreset,
  RecordingSource,
  RecordingSpec,
  RecordingFinalizeSpec,
  RecordingResult
} from './workspace'
import type { CustomPreset } from './customPresets'

export type SettingsKey =
  | 'theme'
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
  | 'record.webcamCorner'
  // INIT-E (round 15): persist the last-used output folders so a user
  // exporting many clips doesn't have to re-pick on every batch.
  | 'export.lastOutputDir'
  | 'clipKit.lastOutputDir'
  // T-47: the window's own geometry, written by main on move/resize/close
  // and validated against the connected displays on the next launch.
  | 'windowBounds'
  // T-20 (round 23): the posting diary used to live in renderer
  // localStorage, so it died with the Chromium profile and never reached a
  // project file. Settings store keeps it with the rest of the app state.
  | 'postingDiary'

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
    /** Round 20: transcode a non-native container to an mp4 working copy. */
    convertForImport(filePath: string): Promise<string>
    pickOutputDir(): Promise<string | null>
    fileUrl(filePath: string): string
    exportBatch(jobs: ExportJobSpec[]): Promise<ExportResult[]>
    cancel(jobId: string): Promise<boolean>
    cancelAll(): Promise<void>
    revealInFolder(filePath: string): Promise<void>
    onProgress(handler: (p: ExportProgress) => void): Unsubscribe
    onJobComplete(handler: (info: { jobId: string; outputPath: string }) => void): Unsubscribe
    reframe(params: {
      jobId?: string
      sourcePath: string
      outDir: string
      position: 'left' | 'center' | 'right' | 'smart'
      startSec: number
      endSec: number
      targetWidth: number
      targetHeight: number
    }): Promise<{ outputPath: string }>
    // Round 17 B1-B5: per-job cancel buttons in each long-running panel.
    cancelReframe(jobId: string): Promise<boolean>
    cancelGif(jobId: string): Promise<boolean>
    cancelConcat(jobId: string): Promise<boolean>
    cancelPip(jobId: string): Promise<boolean>
    cancelHighlight(): Promise<boolean>
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
      jobId?: string
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
      jobId?: string
      sourcePath: string
      outDir: string
      segments: Array<{ startSec: number; endSec: number; name: string }>
      fadeMs: number
      width: number
      height: number
    }): Promise<{ outputPath: string }>
    pipComposite(params: {
      jobId?: string
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
    copySrtTo(params: {
      srcPath: string
      destPath: string
    }): Promise<{ ok: true } | { ok: false; reason: string }>
    pickBurnInOutput(defaultName: string): Promise<string | null>
    openBinFolder(): Promise<void>
    openModelsFolder(): Promise<void>
    // Round 17 B6
    cancelBurnIn(): Promise<boolean>
    onProgress(handler: (p: CaptionsProgress) => void): Unsubscribe
    installModel(): Promise<{ ok: true; path: string } | { ok: false; reason: string }>
    cancelInstall(): Promise<boolean>
    onModelProgress(handler: (p: ModelInstallProgress) => void): Unsubscribe
  }
  moodboard: {
    list(): Promise<MoodBoardCollection[]>
    create(name: string): Promise<MoodBoardCollection>
    delete(id: string): Promise<void>
    rename(id: string, name: string): Promise<MoodBoardCollection | null>
    addItem(collectionId: string, result: SearchResult): Promise<MoodBoardCollection | null>
    removeItem(collectionId: string, itemId: string): Promise<MoodBoardCollection | null>
    /** T-58 — make the boards on disk match this list exactly. The inverse
     *  the references undo history steps through; see restoreCollections. */
    restore(collections: MoodBoardCollection[]): Promise<void>
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
    /**
     * T-47: register the provider main calls for a final snapshot on quit.
     * Return null to save nothing (a restore in flight, or an empty
     * session). Fire-and-forget by design — the reply carries a project,
     * never an outcome, so no IPC error text can reach a quitting UI.
     */
    onQuitFlush(provider: () => ImagiiProject | null): Unsubscribe
  }
  recording: {
    listSources(): Promise<RecordingSource[]>
    save(spec: RecordingSpec): Promise<RecordingResult | null>
    // Round 18 H1: streaming save protocol. begin opens a temp-file write
    // stream in main; appendChunk streams each MediaRecorder chunk as it
    // arrives (call order = byte order); finalize closes the stream and
    // runs the same dialog + convert/copy flow as save; abandon reaps a
    // partial temp file on failure/discard paths.
    begin(): Promise<{ id: string }>
    appendChunk(id: string, chunk: ArrayBuffer): Promise<void>
    finalize(id: string, spec: RecordingFinalizeSpec): Promise<RecordingResult | null>
    abandon(id: string): Promise<boolean>
    // M6 fix (round 15): expose conversion progress + cancel to the renderer.
    cancelSave(): Promise<boolean>
    onProgress(
      handler: (info: { percent: number; message?: string }) => void
    ): Unsubscribe
  }
}

declare global {
  interface Window {
    api: ImagiiApi
  }
}
