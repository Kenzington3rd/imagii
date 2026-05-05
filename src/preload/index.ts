import { contextBridge, ipcRenderer } from 'electron'
import type { ImagiiApi, SettingsKey } from '../shared/api'

const api: ImagiiApi = {
  settings: {
    get: (key: SettingsKey) => ipcRenderer.invoke('settings:get', key),
    set: (key: SettingsKey, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },
  app: {
    quit: () => ipcRenderer.send('app:quit'),
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  }
}

contextBridge.exposeInMainWorld('api', api)
