import Store from 'electron-store'
import type { SettingsKey } from '../shared/api'

interface SettingsSchema {
  ageVerified?: boolean
  ageVerifiedAt?: number
  theme?: 'dark' | 'light'
  lastRoute?: string
}

export const store = new Store<SettingsSchema>({
  name: 'config',
  defaults: {
    theme: 'dark'
  }
})

export function getSetting<T = unknown>(key: SettingsKey): T | undefined {
  return store.get(key) as T | undefined
}

export function setSetting<T = unknown>(key: SettingsKey, value: T): void {
  store.set(key, value as SettingsSchema[typeof key])
}
