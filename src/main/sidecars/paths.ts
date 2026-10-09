import { app } from 'electron'
import path from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { CAPTIONS_DIR_NAME } from '../../shared/captions'

const isPackaged = (): boolean => app.isPackaged

function resourcePath(...parts: string[]): string {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', ...parts)
  }
  return path.join(process.cwd(), 'resources', ...parts)
}

function userDataPath(...parts: string[]): string {
  return path.join(app.getPath('userData'), ...parts)
}

export interface BinaryStatus {
  path: string
  exists: boolean
  sizeBytes: number
}

function probe(p: string): BinaryStatus {
  if (!existsSync(p)) return { path: p, exists: false, sizeBytes: 0 }
  try {
    const stat = statSync(p)
    return { path: p, exists: true, sizeBytes: stat.size }
  } catch {
    return { path: p, exists: false, sizeBytes: 0 }
  }
}

// Round 18: sdExePath()/nudenetOnnxPath()/sdModelPath() removed — vestiges
// of a pulled AI-generation feature with zero callers (and PRODUCT_GUIDE
// explicitly scopes generation out). Same unreferenced-export sweep that
// removed logsDir()/aiOutputDir() in round 17.

export function modelsDir(): string {
  return userDataPath('models')
}

export function moodboardsDir(): string {
  return userDataPath('moodboards')
}

export function thumbsCacheDir(): string {
  return userDataPath('cache', 'thumbs')
}

// Round 17: logsDir() and aiOutputDir() removed — neither was referenced
// anywhere in main/renderer (verified via grep). Keep the file lean so a
// future reader doesn't think a logs/ or ai-output/ tree exists.

/**
 * The names the captions engine goes by, in the order they are looked for.
 * Current whisper.cpp builds ship `whisper-cli.exe`; older ones shipped the
 * same program as `whisper.exe` (and later builds keep a `whisper.exe` that
 * only prints a deprecation notice). Both names are accepted — a user who put
 * either in the folder is set up — and the new one wins when both are there.
 * T-89: the setup card told people to fetch a file current releases do not
 * contain.
 */
export const WHISPER_EXE_NAMES = ['whisper-cli.exe', 'whisper.exe'] as const

/**
 * Where the captions engine is. The first name in `WHISPER_EXE_NAMES` that
 * exists wins; when none does, the answer is the PREFERRED name's path (not
 * found), because that is the file the setup card asks the user to put there.
 */
export function whisperExePath(): BinaryStatus {
  for (const name of WHISPER_EXE_NAMES) {
    const found = probe(resourcePath('bin', name))
    if (found.exists) return found
  }
  return probe(resourcePath('bin', WHISPER_EXE_NAMES[0]))
}

export function whisperModelPath(modelFile = 'ggml-base.en.bin'): BinaryStatus {
  return probe(userDataPath('models', modelFile))
}

export function captionsOutputDir(): string {
  return userDataPath(CAPTIONS_DIR_NAME)
}
