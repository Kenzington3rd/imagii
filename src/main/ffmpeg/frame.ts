import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { ffmpegPath } from './paths'
import { cropToFrame } from './filters'
import { probeVideo } from './probe'
import { cancelledOr, killAsCancelled } from './cancelMark'
import { CancelLatch } from './cancelLatch'
import { discardPartialOutput } from './partialOutput'
import { nextFreePath } from './outputPath'
import { assert } from '../../shared/assert'
import type { CropRect } from '../../shared/clip'
import { localDate, sanitizeFilename } from '../../shared/filename'

// B4 fix (round 16): single-slot tracker for the in-flight extractFrame
// process. extractFrame is sequential (Clip Kit awaits one before the next),
// so one slot is enough. Lets before-quit and Clip Kit cancel hard-kill the
// in-flight ffmpeg child instead of orphaning it.
let activeFrame: ChildProcess | null = null
// T-98: Clip Kit's three thumbnails are extractFrame calls, so its Cancel has to
// reach them: `video:cancelAll` calls cancelAllFrameJobs, which kills the live
// extract AND marks one that has not spawned yet (it creates its folder first).
const latch = new CancelLatch()

export function cancelAllFrameJobs(): void {
  latch.cancelAll()
  if (activeFrame && activeFrame.exitCode === null) killAsCancelled(activeFrame)
  activeFrame = null
}

/**
 * Phase 4D: extract a single JPEG frame at a given time. Used by the
 * Clip Kit orchestration to produce thumbnail candidates from the source
 * video at clip-relative timestamps.
 *
 * Single fast pass: -ss {time} -frames:v 1 -q:v 2 → high quality JPG,
 * typically completes in <500ms.
 *
 * T-130 (t): `cropRect` is the clip's manual crop. The kit's thumbnails are the
 * clip as the platform files show it, and the crop is the new frame of that clip
 * (T-83) — taken from the whole source they were three pictures of everything
 * the crop had thrown away. The stage is `cropToFrame`'s, the one every other
 * runner builds (even pixels for libx264/yuv420p, clamped inside the frame), and
 * it is the ONLY filter: the thumbnail is the crop at the source's own pixels, so
 * there is no scale for it to come before. Its numbers are pixels of the source,
 * so the source is probed first — only for a crop, so a clip without one runs the
 * command it always did, with no probe.
 */
export async function extractFrame(
  sourcePath: string,
  timeSec: number,
  outputPath: string,
  cropRect?: CropRect | null
): Promise<{ outputPath: string }> {
  assert(typeof sourcePath === 'string' && sourcePath.length > 0, 'sourcePath required')
  assert(Number.isFinite(timeSec) && timeSec >= 0, 'timeSec must be finite >= 0')
  assert(typeof outputPath === 'string' && outputPath.length > 0, 'outputPath required')

  const run = latch.begin()
  let spawnedAt: number | null = null
  try {
    await run.guard(mkdir(path.dirname(outputPath), { recursive: true }))

    const crop: string[] = []
    if (cropRect) {
      const probe = await run.guard(probeVideo(sourcePath))
      crop.push('-vf', cropToFrame(cropRect, { width: probe.width, height: probe.height }, null).join(','))
    }

    const args = [
      '-y',
      '-ss',
      timeSec.toFixed(3),
      '-i',
      sourcePath,
      ...crop,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      '-update',
      '1',
      outputPath
    ]

    await new Promise<void>((resolve, reject) => {
      run.check()
      const child = spawn(ffmpegPath, args, { windowsHide: true })
      spawnedAt = Date.now()
      activeFrame = child
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (c: string) => {
        stderr += c
        if (stderr.length > 16384) stderr = stderr.slice(-16384)
      })
      child.on('error', (err) => {
        if (activeFrame === child) activeFrame = null
        reject(cancelledOr(child, err))
      })
      child.on('close', (code, signal) => {
        if (activeFrame === child) activeFrame = null
        if (code === 0) resolve()
        else {
          reject(
            cancelledOr(child, new Error(`extractFrame exit ${code ?? signal}: ${stderr.slice(-500)}`))
          )
        }
      })
    })
  } catch (err) {
    // T-100: half a JPEG is not a thumbnail.
    await discardPartialOutput(outputPath, spawnedAt)
    throw err
  } finally {
    run.end()
  }

  return { outputPath }
}

/**
 * Phase 4D: create the named subfolder a Clip Kit will be written into.
 * Sanitizes the clip name to filesystem-safe characters and stamps the
 * folder with a date suffix.
 *
 * T-106: the date alone only kept a kit from a DIFFERENT day apart — the second
 * kit of the day wrote into the first one's folder, and the same-named files in
 * it were silently replaced. A kit is a set (five videos, three thumbnails, a
 * caption file), so the unit that must not be mixed with an earlier one is the
 * folder: a second kit gets `<name>-kit-<date> (2)`.
 */
export async function makeKitDir(parentDir: string, clipName: string): Promise<string> {
  assert(typeof parentDir === 'string' && parentDir.length > 0, 'parentDir required')
  assert(typeof clipName === 'string' && clipName.length > 0, 'clipName required')
  const safe = sanitizeFilename(clipName)
  // T-117: the person's calendar day, not UTC's (a kit made at 9 pm in Pacific time is today's).
  const stamp = localDate().replace(/-/g, '')
  const subDir = `${safe}-kit-${stamp}`
  await mkdir(parentDir, { recursive: true })
  const fullPath = await nextFreePath(path.join(parentDir, subDir), { directory: true })
  await mkdir(fullPath)
  return fullPath
}

/**
 * T-112 — a kit that was canceled or failed before it wrote anything does not
 * leave its empty folder behind.
 *
 * `makeKitDir` creates the folder before the first job, so a Cancel or a failure
 * in the probe left `<name>-kit-<date>` on disk with nothing in it, next to the
 * toast that says nothing was made. This is a plain, NON-recursive `rmdir`: it
 * can only ever remove an EMPTY directory, so a folder holding even one finished
 * file survives whatever the caller asked, and no path a renderer sends can
 * delete someone's files. Every failure (not empty, already gone, locked) is a
 * console note and nothing more — the failure the user needs to hear about is
 * the kit's own, the same rule `discardPartialOutput` follows.
 */
export async function removeKitDir(kitDir: string): Promise<void> {
  assert(typeof kitDir === 'string' && kitDir.length > 0, 'kitDir required')
  try {
    await rmdir(kitDir)
  } catch (err) {
    console.info(`[imagii] kit folder left in place (${kitDir}):`, err)
  }
}
