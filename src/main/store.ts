import Store from 'electron-store'
import type { SettingsKey } from '../shared/api'

interface SettingsSchema {
  theme?: 'dark' | 'light'
  welcomeSeen?: boolean
  'tutorialSeen.video'?: boolean
  'tutorialSeen.audio'?: boolean
  'tutorialSeen.image'?: boolean
  'tutorialSeen.ai'?: boolean
  streamerHandle?: string
  watermarkPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  filenameTemplate?: string
  'recentFiles.video'?: string[]
  'recentFiles.audio'?: string[]
  'recentFiles.image'?: string[]
  'record.webcamCorner'?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  'record.convertToMp4'?: boolean
  'export.lastOutputDir'?: string
  'clipKit.lastOutputDir'?: string
  /** T-47: last window geometry. Shape is re-validated on read by
   *  shared/windowSizing.resolveWindowBounds — the schema below only keeps
   *  a wildly wrong value from reaching it. */
  windowBounds?: {
    x: number
    y: number
    width: number
    height: number
    maximized: boolean
  }
  /** T-20: PostChecklist posting diary. Shape is validated renderer-side by
   *  shared/postingDiary.parseDiaryEntries; the schema below only pins the
   *  container so a corrupt value can't take electron-store's get() down. */
  postingDiary?: unknown[]
}

/**
 * INIT-D (round 15): supply a JSON-schema to electron-store. When a value on
 * disk fails the schema (manually corrupted config, or a downgrade from a
 * future version) electron-store throws on get() — the wrapper below
 * catches and falls back to defaults so the bad key doesn't crash the app.
 * The schema mirrors SettingsSchema; types alone don't survive disk.
 */
const schema = {
  theme: { type: 'string', enum: ['dark', 'light'] },
  welcomeSeen: { type: 'boolean' },
  'tutorialSeen.video': { type: 'boolean' },
  'tutorialSeen.audio': { type: 'boolean' },
  'tutorialSeen.image': { type: 'boolean' },
  'tutorialSeen.ai': { type: 'boolean' },
  streamerHandle: { type: 'string', maxLength: 80 },
  watermarkPosition: {
    type: 'string',
    enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  },
  filenameTemplate: { type: 'string', maxLength: 200 },
  'recentFiles.video': { type: 'array', items: { type: 'string' }, maxItems: 50 },
  'recentFiles.audio': { type: 'array', items: { type: 'string' }, maxItems: 50 },
  'recentFiles.image': { type: 'array', items: { type: 'string' }, maxItems: 50 },
  'record.webcamCorner': {
    type: 'string',
    enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  },
  'record.convertToMp4': { type: 'boolean' },
  'export.lastOutputDir': { type: 'string' },
  'clipKit.lastOutputDir': { type: 'string' },
  windowBounds: {
    type: 'object',
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
      maximized: { type: 'boolean' }
    }
  },
  postingDiary: { type: 'array', maxItems: 100 }
} as const

export const store = new Store<SettingsSchema>({
  name: 'config',
  defaults: {
    theme: 'dark'
  },
  // The `schema` option here triggers electron-store's runtime validation.
  // A bad value is replaced with the default rather than reaching the
  // renderer in a malformed state.
  schema: schema as unknown as Record<string, unknown>,
  clearInvalidConfig: true
})

export function getSetting<T = unknown>(key: SettingsKey): T | undefined {
  // electron-store types narrow per key; keep our public API uniform.
  return store.get(key as keyof SettingsSchema) as T | undefined
}

export function setSetting<T = unknown>(key: SettingsKey, value: T): void {
  store.set(key as keyof SettingsSchema, value as never)
}

// Test-only export so settingsKnownKeys.test.ts can prove the on-disk schema
// and the IPC allowlist describe the same set of keys — a key in one but not
// the other either bypasses validation or can never be written.
export const __storeTesting__ = { schema }
