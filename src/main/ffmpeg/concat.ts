import { spawn, type ChildProcess } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { ffmpegPath } from './paths'
import { even } from './filters'
import { assertDefined } from '../../shared/assert'

export interface ConcatJobSpec {
  jobId: string
  sourcePath: string
  outDir: string
  segments: Array<{ startSec: number; endSec: number; name: string }>
  fadeMs: number
  width: number
  height: number
}

// M3 fix (round 15): register every spawn so a renderer-initiated cancel or
// app-quit can hard-kill them. Mirrors ffmpeg/export.ts activeJobs. Keys are
// the per-spawn jobId; runConcat splits its key into "<jobId>:seg-N" and
// "<jobId>:concat" so the segment loop can cancel one at a time, and a
// global cancelAllConcatJobs takes the lot.
const activeJobs = new Map<string, ChildProcess>()

function escapeForConcatList(p: string): string {
  return p.replace(/'/g, "'\\''")
}

export function cancelConcatJob(jobId: string): boolean {
  let killed = false
  // Cancel any sub-keyed children too (segment-N, concat).
  for (const [key, child] of activeJobs) {
    if (key === jobId || key.startsWith(`${jobId}:`)) {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      activeJobs.delete(key)
      killed = true
    }
  }
  return killed
}

export function cancelAllConcatJobs(): void {
  for (const [, child] of activeJobs) {
    try {
      child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
  activeJobs.clear()
}

export async function runConcat(spec: ConcatJobSpec): Promise<{ outputPath: string }> {
  const tempDir = path.join(tmpdir(), 'imagii-concat')
  const fs = await import('node:fs/promises')
  await fs.mkdir(tempDir, { recursive: true })
  // Bug fix: track all paths we create so try/finally can clean them up
  // on every exit path, including a failure mid-loop. Previously, a
  // segment-encode failure left N partially-encoded mp4s in %TEMP%
  // until the OS reaped them.
  const segmentPaths: string[] = []
  let listFile: string | null = null
  const fade = Math.max(0, Math.min(2, spec.fadeMs / 1000))

  try {
  const segCount = spec.segments.length
  for (let i = 0; i < segCount; i++) {
    const seg = assertDefined(spec.segments[i], `segments[${i}]`)
    // Defense in depth: IPC layer also validates this, but reject reversed
    // ranges here too so any non-IPC caller (tests, future scripts) can't
    // produce a -ss > -to ffmpeg invocation that fails silently.
    if (seg.endSec <= seg.startSec) {
      throw new Error(`segments[${i}] range invalid (endSec must exceed startSec)`)
    }
    const segPath = path.join(tempDir, `seg-${spec.jobId}-${i}.mp4`)
    const dur = Math.max(0.1, seg.endSec - seg.startSec)
    const fadeIn = i === 0 ? 0 : fade
    const fadeOut = i === segCount - 1 ? 0 : fade
    // M4 fix (round 15): even W/H so libx264 doesn't reject the encode.
    // The IPC validator already enforces 16..16384 but doesn't snap to even.
    const filters: string[] = [
      `scale=${even(spec.width)}:${even(spec.height)}:flags=lanczos,setsar=1`
    ]
    if (fadeIn > 0) filters.push(`fade=t=in:st=0:d=${fadeIn}`)
    if (fadeOut > 0)
      filters.push(`fade=t=out:st=${(dur - fadeOut).toFixed(3)}:d=${fadeOut}`)

    const audioFilters: string[] = []
    if (fadeIn > 0) audioFilters.push(`afade=t=in:st=0:d=${fadeIn}`)
    if (fadeOut > 0)
      audioFilters.push(`afade=t=out:st=${(dur - fadeOut).toFixed(3)}:d=${fadeOut}`)

    const args = [
      '-y',
      '-ss',
      seg.startSec.toFixed(3),
      '-to',
      seg.endSec.toFixed(3),
      '-i',
      spec.sourcePath,
      '-vf',
      filters.join(',')
    ]
    if (audioFilters.length > 0) args.push('-af', audioFilters.join(','))
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-r',
      '30',
      segPath
    )

    // Track the segment path BEFORE starting ffmpeg so a partial-write
    // failure mid-encode still gets cleaned up by the outer finally.
    segmentPaths.push(segPath)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath, args, { windowsHide: true })
      const childKey = `${spec.jobId}:seg-${i}`
      activeJobs.set(childKey, child)
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (c: string) => (stderr += c))
      child.on('error', (err) => {
        activeJobs.delete(childKey)
        reject(err)
      })
      child.on('close', (code) => {
        activeJobs.delete(childKey)
        if (code === 0) resolve()
        else reject(new Error(`segment ${i} exit ${code}: ${stderr.slice(-500)}`))
      })
    })
  }

  const listFilePath = path.join(tempDir, `list-${spec.jobId}.txt`)
  listFile = listFilePath
  const listContent = segmentPaths
    .map((p) => `file '${escapeForConcatList(p)}'`)
    .join('\n')
  await writeFile(listFilePath, listContent, 'utf8')

  const base = path.parse(spec.sourcePath).name
  const outputPath = path.join(spec.outDir, `${base}_compilation.mp4`)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFilePath,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outputPath
      ],
      { windowsHide: true }
    )
    const childKey = `${spec.jobId}:concat`
    activeJobs.set(childKey, child)
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => (stderr += c))
    child.on('error', (err) => {
      activeJobs.delete(childKey)
      reject(err)
    })
    child.on('close', (code) => {
      activeJobs.delete(childKey)
      if (code === 0) resolve()
      else reject(new Error(`concat exit ${code}: ${stderr.slice(-500)}`))
    })
  })

  return { outputPath }
  } finally {
    // Cleanup runs on every exit path: success, failure mid-loop, or a
    // throw before listFile was created. Each unlink ignores ENOENT so
    // partial state is fine.
    for (const p of segmentPaths) {
      try {
        await unlink(p)
      } catch {
        /* ignore */
      }
    }
    if (listFile !== null) {
      try {
        await unlink(listFile)
      } catch {
        /* ignore */
      }
    }
  }
}

export async function runPipComposite(
  jobId: string,
  basePath: string,
  overlayPath: string,
  outputPath: string,
  options: {
    overlayWidth: number
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    margin: number
  }
): Promise<{ outputPath: string }> {
  const { position, margin, overlayWidth } = options
  const x = position.includes('left') ? margin : `main_w-overlay_w-${margin}`
  const y = position.includes('top') ? margin : `main_h-overlay_h-${margin}`
  const filter =
    `[1:v]scale=${overlayWidth}:-1[ov];` +
    `[0:v][ov]overlay=${x}:${y}[v]`

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        '-y',
        '-i',
        basePath,
        '-i',
        overlayPath,
        '-filter_complex',
        filter,
        '-map',
        '[v]',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        // B5 fix (round 15): PiP composite MP4 needs faststart so web players
        // don't stall while seeking the moov atom.
        '-movflags',
        '+faststart',
        outputPath
      ],
      { windowsHide: true }
    )
    // M3 fix (round 15): register the child so app-quit can SIGKILL it.
    // The IPC layer now passes a real jobId (was `_jobId`).
    activeJobs.set(jobId, child)
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => (stderr += c))
    child.on('error', (err) => {
      activeJobs.delete(jobId)
      reject(err)
    })
    child.on('close', (code) => {
      activeJobs.delete(jobId)
      if (code === 0) resolve()
      else reject(new Error(`pip exit ${code}: ${stderr.slice(-500)}`))
    })
  })

  return { outputPath }
}
