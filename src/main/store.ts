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
  /** T-124 (21): where the GIF, Compile, Reframe and picture-in-picture panels write (one key for the four). */
  'video.lastOutputDir'?: string
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
 * INIT-D (round 15): supply a JSON-schema to electron-store, so a value of the wrong shape is refused when it
 * is WRITTEN: `set` throws a "Config schema violation", the settings IPC rejects, and nothing reaches disk.
 * The schema mirrors SettingsSchema; types alone do not survive the IPC bridge or the disk.
 *
 * T-120: it is NESTED, one object per dotted group. Conf nests a dotted key (`record.convertToMp4` is
 * `{ record: { convertToMp4 } }` on disk), and a schema property named `'record.convertToMp4'` matches
 * nothing in that layout: for rounds the eleven dotted keys were unvalidated (a string stored as the
 * convert choice, a non-array as the recent videos, which `useRecentFiles` then crashed on) while the
 * flat keys beside them were checked. Conf's dotted `get`/`set`/`delete` work over the nested layout
 * unchanged, and the file on disk is the same. `settingsKnownKeys.test.ts` flattens this object and holds
 * it to the IPC allowlist, and `settingsClear.test.ts` drives the dotted refusals through the real store.
 *
 * What it does NOT do: replace a bad value on read. `clearInvalidConfig` (below) resets the file only when
 * it cannot be PARSED. A `config.json` that parses but breaks the schema (hand-edited, or written by a newer
 * build) fails Conf's validation when the store opens, which stops the launch. That was always so for the
 * scalar keys (`streamerHandle: 5`); the dotted ones now share it.
 * simplification: no recovery from a schema-invalid config.json. The upgrade is to catch the open, move the
 * file aside and start from the defaults, which wants a test that corrupts a real file and a decision about
 * keeping the old copy.
 */
const schema = {
  theme: { type: 'string', enum: ['dark', 'light'] },
  welcomeSeen: { type: 'boolean' },
  tutorialSeen: {
    type: 'object',
    properties: {
      video: { type: 'boolean' },
      audio: { type: 'boolean' },
      image: { type: 'boolean' },
      ai: { type: 'boolean' }
    }
  },
  streamerHandle: { type: 'string', maxLength: 80 },
  watermarkPosition: {
    type: 'string',
    enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  },
  filenameTemplate: { type: 'string', maxLength: 200 },
  recentFiles: {
    type: 'object',
    properties: {
      video: { type: 'array', items: { type: 'string' }, maxItems: 50 },
      audio: { type: 'array', items: { type: 'string' }, maxItems: 50 },
      image: { type: 'array', items: { type: 'string' }, maxItems: 50 }
    }
  },
  record: {
    type: 'object',
    properties: {
      webcamCorner: {
        type: 'string',
        enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right']
      },
      convertToMp4: { type: 'boolean' }
    }
  },
  export: { type: 'object', properties: { lastOutputDir: { type: 'string' } } },
  clipKit: { type: 'object', properties: { lastOutputDir: { type: 'string' } } },
  video: { type: 'object', properties: { lastOutputDir: { type: 'string' } } },
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
  // The `schema` option turns on electron-store's runtime validation: a write of the wrong shape throws (see
  // the schema's comment above for what a bad file on disk does).
  schema: schema as unknown as Record<string, unknown>,
  // Resets config.json to the defaults only when the file cannot be PARSED (Conf's SyntaxError case), not when
  // it parses and fails the schema.
  clearInvalidConfig: true
})

export function getSetting<T = unknown>(key: SettingsKey): T | undefined {
  // electron-store types narrow per key; keep our public API uniform.
  return store.get(key as keyof SettingsSchema) as T | undefined
}

export function setSetting<T = unknown>(key: SettingsKey, value: T): void {
  // T-119: `undefined` clears the key. electron-store refuses it from `set` ("Use `delete()` to clear
  // values"), so a renderer that wanted a saved value gone had no way to say so; the Export panel's blank
  // watermark is the first (it forgets the handle and corner, so Clip Kit stamps nothing). Any other value
  // is stored as before, `null` included, and the schema still judges it.
  if (value === undefined) store.delete(key as keyof SettingsSchema)
  else store.set(key as keyof SettingsSchema, value as never)
}

// Test-only export so settingsKnownKeys.test.ts can prove the on-disk schema
// and the IPC allowlist describe the same set of keys — a key in one but not
// the other either bypasses validation or can never be written.
export const __storeTesting__ = { schema }
