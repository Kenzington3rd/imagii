import { app } from 'electron'
import path from 'node:path'
import { existsSync, statSync } from 'node:fs'

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

export function sdExePath(): BinaryStatus {
  return probe(resourcePath('bin', 'sd.exe'))
}

export function nudenetOnnxPath(): BinaryStatus {
  return probe(resourcePath('bin', 'nudenet.onnx'))
}

export function sdModelPath(modelFile = 'v1-5-pruned-emaonly.safetensors'): BinaryStatus {
  return probe(userDataPath('models', modelFile))
}

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

export function whisperExePath(): BinaryStatus {
  return probe(resourcePath('bin', 'whisper.exe'))
}

export function whisperModelPath(modelFile = 'ggml-base.en.bin'): BinaryStatus {
  return probe(userDataPath('models', modelFile))
}

export function captionsOutputDir(): string {
  return userDataPath('captions')
}
