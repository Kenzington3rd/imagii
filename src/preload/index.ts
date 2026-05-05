import { contextBridge, ipcRenderer } from 'electron'
import type { ImagiiApi, SettingsKey } from '../shared/api'
import type { ExportJobSpec, ExportProgress } from '../shared/clip'
import type { AudioExportSpec, AudioJobProgress, AudioMuxSpec } from '../shared/audio'

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
  }
}

contextBridge.exposeInMainWorld('api', api)
