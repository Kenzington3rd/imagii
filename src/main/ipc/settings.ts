import { ipcMain, app } from 'electron'
import path from 'node:path'
import { getSetting, setSetting } from '../store'
import type { SettingsKey } from '../../shared/api'
import { folderVerdict } from '../ffmpeg/outputPath'
import { isSafeAbsolutePath } from '../../shared/pathSafety'

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
  // T-175 (2): is the FOLDER of this file there? An importer drops a Recent entry whose file failed to open as "can't find" only when it is (the file itself is
  // gone); an unplugged drive takes its folder with it and the entry must stay. Only a local stat, under the same deadline as the remembered-folder read: 'unknown'
  // (a stat that did not answer) and 'not-a-folder' are both "not there". A path that is not a safe absolute one answers false rather than throwing.
  ipcMain.handle('settings:folderOfFilePresent', async (_e, filePath: unknown): Promise<boolean> => {
    if (!isSafeAbsolutePath(filePath)) return false
    return (await folderVerdict(path.dirname(filePath))) === 'folder'
  })
  ipcMain.handle('app:getVersion', () => app.getVersion())
}

// Test-only export of the known-keys list so settings.test.ts can verify
// the validation surface without re-declaring it.
export const __settingsTesting__ = { KNOWN_SETTINGS_KEYS, assertKnownKey, FOLDER_SETTINGS }
