export type SettingsKey = 'ageVerified' | 'ageVerifiedAt' | 'theme' | 'lastRoute'

export interface ImagiiApi {
  settings: {
    get<T = unknown>(key: SettingsKey): Promise<T | undefined>
    set<T = unknown>(key: SettingsKey, value: T): Promise<void>
  }
  app: {
    quit(): void
    getVersion(): Promise<string>
  }
}

declare global {
  interface Window {
    api: ImagiiApi
  }
}
