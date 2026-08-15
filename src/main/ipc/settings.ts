import { ipcMain, app } from 'electron'
import { getSetting, setSetting } from '../store'
import type { SettingsKey } from '../../shared/api'

// Round 17 phase-4: the renderer-supplied `key` reaches electron-store, which
// happily creates whatever top-level field it's handed. A hostile or buggy
// renderer could pollute the store with hundreds of junk keys (or shadow
// future legitimate keys). Gate every settings:get/set against the union
// from src/shared/api.ts. Per-value shape stays loose — electron-store and
// the per-feature read sites already coerce as needed.
const KNOWN_SETTINGS_KEYS: readonly SettingsKey[] = [
  'theme',
  'lastRoute',
  'welcomeSeen',
  'tutorialSeen.video',
  'tutorialSeen.audio',
  'tutorialSeen.image',
  'tutorialSeen.ai',
  'streamerHandle',
  'filenameTemplate',
  'recentFiles.video',
  'recentFiles.audio',
  'recentFiles.image',
  'record.webcamCorner',
  'export.lastOutputDir',
  'clipKit.lastOutputDir',
  'postingDiary'
]
const KNOWN_KEYS_SET = new Set<string>(KNOWN_SETTINGS_KEYS)
function assertKnownKey(key: unknown): asserts key is SettingsKey {
  if (typeof key !== 'string' || !KNOWN_KEYS_SET.has(key)) {
    throw new Error(`settings key not recognized: ${String(key)}`)
  }
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', (_e, key: unknown) => {
    assertKnownKey(key)
    return getSetting(key)
  })
  ipcMain.handle('settings:set', (_e, key: unknown, value: unknown) => {
    assertKnownKey(key)
    setSetting(key, value)
  })
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.on('app:quit', () => {
    app.quit()
  })
}

// Test-only export of the known-keys list so settings.test.ts can verify
// the validation surface without re-declaring it.
export const __settingsTesting__ = { KNOWN_SETTINGS_KEYS, assertKnownKey }
