import { ipcMain, app } from 'electron'
import { getSetting, setSetting } from '../store'
import type { SettingsKey } from '../../shared/api'
import { folderVerdict } from '../ffmpeg/outputPath'

// Round 17 phase-4: the renderer-supplied `key` reaches electron-store, which
// happily creates whatever top-level field it's handed. A hostile or buggy
// renderer could pollute the store with hundreds of junk keys (or shadow
// future legitimate keys). Gate every settings:get/set against the union
// from src/shared/api.ts. Per-value shape stays loose — electron-store and
// the per-feature read sites already coerce as needed.
const KNOWN_SETTINGS_KEYS: readonly SettingsKey[] = [
  'theme',
  'welcomeSeen',
  'tutorialSeen.video',
  'tutorialSeen.audio',
  'tutorialSeen.image',
  'tutorialSeen.ai',
  'streamerHandle',
  'watermarkPosition',
  'filenameTemplate',
  'recentFiles.video',
  'recentFiles.audio',
  'recentFiles.image',
  'record.webcamCorner',
  'record.convertToMp4',
  'export.lastOutputDir',
  'clipKit.lastOutputDir',
  'video.lastOutputDir',
  'postingDiary',
  'windowBounds'
]
const KNOWN_KEYS_SET = new Set<string>(KNOWN_SETTINGS_KEYS)
function assertKnownKey(key: unknown): asserts key is SettingsKey {
  if (typeof key !== 'string' || !KNOWN_KEYS_SET.has(key)) {
    throw new Error(`settings key not recognized: ${String(key)}`)
  }
}

/**
 * The settings that remember a FOLDER the person chose (T-125 (10)). A stored path can outlive its folder (deleted, renamed, a drive
 * that is not plugged in), and every reader used it as if it were there: the panels' buttons showed it, the writers wrote into it and
 * the failure said "a file imagii needs isn't there". The read answers `undefined` for one that is not a folder now, for all of them at
 * once, and leaves the stored value alone (the drive may come back; the next folder written replaces it). T-126 (10): the stat is
 * shared between concurrent reads and has a deadline (`folderVerdict`), so a path that never answers cannot hold the thread pool.
 */
const FOLDER_SETTINGS: ReadonlySet<string> = new Set(['export.lastOutputDir', 'clipKit.lastOutputDir', 'video.lastOutputDir'])

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', async (_e, key: unknown) => {
    assertKnownKey(key)
    const value = getSetting(key)
    // T-126 (10): only a folder that is KNOWN not to be one is hidden. A stat that has not answered by the deadline (an unreachable
    // share) is "can't tell", and the stored value is answered: the real write is guarded by `ensureOutputDir` regardless.
    if (FOLDER_SETTINGS.has(key) && (await folderVerdict(value)) === 'not-a-folder') return undefined
    return value
  })
  ipcMain.handle('settings:set', (_e, key: unknown, value: unknown) => {
    assertKnownKey(key)
    setSetting(key, value)
  })
  ipcMain.handle('app:getVersion', () => app.getVersion())
}

// Test-only export of the known-keys list so settings.test.ts can verify
// the validation surface without re-declaring it.
export const __settingsTesting__ = { KNOWN_SETTINGS_KEYS, assertKnownKey, FOLDER_SETTINGS }
