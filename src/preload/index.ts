import { contextBridge, ipcRenderer } from 'electron'
import type { ImagiiApi, SettingsKey } from '../shared/api'
import type { ExportJobSpec, ExportProgress } from '../shared/clip'
import type { AudioExportSpec, AudioJobProgress, AudioMuxSpec } from '../shared/audio'
import type {
  AiJobProgress,
  Txt2ImgRequest,
  InpaintRequest,
  OutpaintRequest
} from '../shared/ai'
import type { SearchResult } from '../shared/search'
import type {
  CaptionsProgress,
  TranscribeRequest,
  BurnInRequest
} from '../shared/captions'

const api: ImagiiApi = {
  settings: {
    get: (key: SettingsKey) => ipcRenderer.invoke('settings:get', key),
    set: (key: SettingsKey, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },
  app: {
    quit: () => ipcRenderer.send('app:quit'),
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  },
  video: {
    probe: (filePath: string) => ipcRenderer.invoke('video:probe', filePath),
    pickFile: () => ipcRenderer.invoke('video:pickFile'),
    pickOutputDir: () => ipcRenderer.invoke('video:pickOutputDir'),
    fileUrl: (filePath: string) => {
      const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
      return `imagii-file://${encodeURI(normalized)}`
    },
    exportBatch: (jobs: ExportJobSpec[]) => ipcRenderer.invoke('video:exportBatch', jobs),
    cancel: (jobId: string) => ipcRenderer.invoke('video:cancel', jobId),
    revealInFolder: (filePath: string) => ipcRenderer.invoke('video:revealInFolder', filePath),
    onProgress: (handler: (p: ExportProgress) => void) => {
      const listener = (_e: unknown, p: ExportProgress): void => handler(p)
      ipcRenderer.on('video:progress', listener)
      return () => ipcRenderer.removeListener('video:progress', listener)
    },
    onJobComplete: (handler) => {
      const listener = (_e: unknown, info: { jobId: string; outputPath: string }): void =>
        handler(info)
      ipcRenderer.on('video:jobComplete', listener)
      return () => ipcRenderer.removeListener('video:jobComplete', listener)
    },
    reframe: (params) => ipcRenderer.invoke('video:reframe', params),
    onReframeProgress: (handler) => {
      const listener = (
        _e: unknown,
        p: { jobId: string; phase: string; percent: number }
      ): void => handler(p)
      ipcRenderer.on('video:reframeProgress', listener)
      return () => ipcRenderer.removeListener('video:reframeProgress', listener)
    },
    findHighlights: (sourcePath: string) =>
      ipcRenderer.invoke('video:findHighlights', sourcePath),
    onHighlightProgress: (handler) => {
      const listener = (
        _e: unknown,
        p: { jobId: string; phase: string; percent: number }
      ): void => handler(p)
      ipcRenderer.on('video:highlightProgress', listener)
      return () => ipcRenderer.removeListener('video:highlightProgress', listener)
    }
  },
  audio: {
    probe: (filePath: string) => ipcRenderer.invoke('audio:probe', filePath),
    pickFile: () => ipcRenderer.invoke('audio:pickFile'),
    pickOutputFile: (options) => ipcRenderer.invoke('audio:pickOutputFile', options),
    extractFromVideo: (videoPath: string) =>
      ipcRenderer.invoke('audio:extractFromVideo', videoPath),
    export: (spec: AudioExportSpec) => ipcRenderer.invoke('audio:export', spec),
    mux: (spec: AudioMuxSpec) => ipcRenderer.invoke('audio:mux', spec),
    cancel: (jobId: string) => ipcRenderer.invoke('audio:cancel', jobId),
    revealInFolder: (filePath: string) => ipcRenderer.invoke('audio:revealInFolder', filePath),
    suggestOutputName: (sourcePath: string, format: string) =>
      ipcRenderer.invoke('audio:suggestOutputName', sourcePath, format),
    onProgress: (handler: (p: AudioJobProgress) => void) => {
      const listener = (_e: unknown, p: AudioJobProgress): void => handler(p)
      ipcRenderer.on('audio:progress', listener)
      return () => ipcRenderer.removeListener('audio:progress', listener)
    }
  },
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    checkPrompt: (prompt: string) => ipcRenderer.invoke('ai:checkPrompt', prompt),
    txt2img: (req: Txt2ImgRequest) => ipcRenderer.invoke('ai:txt2img', req),
    inpaint: (req: InpaintRequest) => ipcRenderer.invoke('ai:inpaint', req),
    outpaint: (req: OutpaintRequest) => ipcRenderer.invoke('ai:outpaint', req),
    openModelsFolder: () => ipcRenderer.invoke('ai:openModelsFolder'),
    openBinFolder: () => ipcRenderer.invoke('ai:openBinFolder'),
    onProgress: (handler: (p: AiJobProgress) => void) => {
      const listener = (_e: unknown, p: AiJobProgress): void => handler(p)
      ipcRenderer.on('ai:progress', listener)
      return () => ipcRenderer.removeListener('ai:progress', listener)
    }
  },
  search: {
    images: (query: string) => ipcRenderer.invoke('search:images', query)
  },
  image: {
    savePdf: (spec) => ipcRenderer.invoke('image:savePdf', spec),
    revealInFolder: (filePath: string) => ipcRenderer.invoke('image:revealInFolder', filePath)
  },
  captions: {
    status: () => ipcRenderer.invoke('captions:status'),
    transcribe: (req: TranscribeRequest) => ipcRenderer.invoke('captions:transcribe', req),
    burnIn: (req: BurnInRequest) => ipcRenderer.invoke('captions:burnIn', req),
    saveSrt: (srtPath: string, defaultName: string) =>
      ipcRenderer.invoke('captions:saveSrt', srtPath, defaultName),
    pickBurnInOutput: (defaultName: string) =>
      ipcRenderer.invoke('captions:pickBurnInOutput', defaultName),
    openBinFolder: () => ipcRenderer.invoke('captions:openBinFolder'),
    openModelsFolder: () => ipcRenderer.invoke('captions:openModelsFolder'),
    onProgress: (handler: (p: CaptionsProgress) => void) => {
      const listener = (_e: unknown, p: CaptionsProgress): void => handler(p)
      ipcRenderer.on('captions:progress', listener)
      return () => ipcRenderer.removeListener('captions:progress', listener)
    }
  },
  moodboard: {
    list: () => ipcRenderer.invoke('moodboard:list'),
    create: (name: string) => ipcRenderer.invoke('moodboard:create', name),
    delete: (id: string) => ipcRenderer.invoke('moodboard:delete', id),
    rename: (id: string, name: string) => ipcRenderer.invoke('moodboard:rename', id, name),
    addItem: (collectionId: string, result: SearchResult) =>
      ipcRenderer.invoke('moodboard:addItem', collectionId, result),
    removeItem: (collectionId: string, itemId: string) =>
      ipcRenderer.invoke('moodboard:removeItem', collectionId, itemId),
    prune: () => ipcRenderer.invoke('moodboard:prune')
  }
}

contextBridge.exposeInMainWorld('api', api)
