import Store from 'electron-store'
import type { SettingsKey } from '../shared/api'

interface SettingsSchema {
  theme?: 'dark' | 'light'
  lastRoute?: string
  welcomeSeen?: boolean
  'tutorialSeen.video'?: boolean
  'tutorialSeen.audio'?: boolean
  'tutorialSeen.image'?: boolean
  'tutorialSeen.ai'?: boolean
  streamerHandle?: string
  filenameTemplate?: string
  'recentFiles.video'?: string[]
  'recentFiles.audio'?: string[]
  'recentFiles.image'?: string[]
  'record.webcamCorner'?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}

export const store = new Store<SettingsSchema>({
  name: 'config',
  defaults: {
    theme: 'dark'
  }
})

export function getSetting<T = unknown>(key: SettingsKey): T | undefined {
  // electron-store types narrow per key; keep our public API uniform.
  return store.get(key as keyof SettingsSchema) as T | undefined
}

export function setSetting<T = unknown>(key: SettingsKey, value: T): void {
  store.set(key as keyof SettingsSchema, value as never)
}
