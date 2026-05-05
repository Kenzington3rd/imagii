import { contextBridge, ipcRenderer } from 'electron'
import type { ImagiiApi, SettingsKey } from '../shared/api'
import type { ExportJobSpec, ExportProgress } from '../shared/clip'

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
  }
}

contextBridge.exposeInMainWorld('api', api)
