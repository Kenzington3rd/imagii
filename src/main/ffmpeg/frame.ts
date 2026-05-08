import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { ffmpegPath } from './paths'
import { assert } from '../../shared/assert'
import { sanitizeFilename } from '../../shared/filename'

/**
 * Phase 4D: extract a single JPEG frame at a given time. Used by the
 * Clip Kit orchestration to produce thumbnail candidates from the source
 * video at clip-relative timestamps.
 *
 * Single fast pass: -ss {time} -frames:v 1 -q:v 2 → high quality JPG,
 * typically completes in <500ms.
 */
export async function extractFrame(
  sourcePath: string,
  timeSec: number,
  outputPath: string
): Promise<{ outputPath: string }> {
  assert(typeof sourcePath === 'string' && sourcePath.length > 0, 'sourcePath required')
  assert(Number.isFinite(timeSec) && timeSec >= 0, 'timeSec must be finite >= 0')
  assert(typeof outputPath === 'string' && outputPath.length > 0, 'outputPath required')

  const dir = path.dirname(outputPath)
  await mkdir(dir, { recursive: true })

  const args = [
    '-y',
    '-ss',
    timeSec.toFixed(3),
    '-i',
    sourcePath,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    '-update',
    '1',
    outputPath
  ]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => {
      stderr += c
      if (stderr.length > 16384) stderr = stderr.slice(-16384)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`extractFrame exit ${code}: ${stderr.slice(-500)}`))
    })
  })

  return { outputPath }
}

/**
 * Phase 4D: create the named subfolder a Clip Kit will be written into.
 * Sanitizes the clip name to filesystem-safe characters and stamps the
 * folder with a date suffix so re-running the kit on the same clip
 * doesn't clobber prior exports.
 */
export async function makeKitDir(parentDir: string, clipName: string): Promise<string> {
  assert(typeof parentDir === 'string' && parentDir.length > 0, 'parentDir required')
  assert(typeof clipName === 'string' && clipName.length > 0, 'clipName required')
  const safe = sanitizeFilename(clipName)
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const subDir = `${safe}-kit-${stamp}`
  const fullPath = path.join(parentDir, subDir)
  await mkdir(fullPath, { recursive: true })
  return fullPath
}
