import { spawn } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { nanoid } from 'nanoid'
import { ffmpegPath } from './paths'

export interface ConcatJobSpec {
  jobId: string
  sourcePath: string
  outDir: string
  segments: Array<{ startSec: number; endSec: number; name: string }>
  fadeMs: number
  width: number
  height: number
}

function escapeForConcatList(p: string): string {
  return p.replace(/'/g, "'\\''")
}

export async function runConcat(spec: ConcatJobSpec): Promise<{ outputPath: string }> {
  const tempDir = path.join(tmpdir(), 'imagii-concat')
  const fs = await import('node:fs/promises')
  await fs.mkdir(tempDir, { recursive: true })
  const segmentPaths: string[] = []
  const fade = Math.max(0, Math.min(2, spec.fadeMs / 1000))

  for (let i = 0; i < spec.segments.length; i++) {
    const seg = spec.segments[i]
    const segPath = path.join(tempDir, `seg-${spec.jobId}-${i}.mp4`)
    const dur = Math.max(0.1, seg.endSec - seg.startSec)
    const fadeIn = i === 0 ? 0 : fade
    const fadeOut = i === spec.segments.length - 1 ? 0 : fade
    const filters: string[] = [
      `scale=${spec.width}:${spec.height}:flags=lanczos,setsar=1`
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

    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath, args, { windowsHide: true })
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (c: string) => (stderr += c))
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`segment ${i} exit ${code}: ${stderr.slice(-500)}`))
      })
    })
    segmentPaths.push(segPath)
  }

  const listFile = path.join(tempDir, `list-${spec.jobId}.txt`)
  const listContent = segmentPaths
    .map((p) => `file '${escapeForConcatList(p)}'`)
    .join('\n')
  await writeFile(listFile, listContent, 'utf8')

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
        listFile,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outputPath
      ],
      { windowsHide: true }
    )
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => (stderr += c))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`concat exit ${code}: ${stderr.slice(-500)}`))
    })
  })

  for (const p of segmentPaths) {
    try {
      await unlink(p)
    } catch {
      /* ignore */
    }
  }
  try {
    await unlink(listFile)
  } catch {
    /* ignore */
  }

  return { outputPath }
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
        outputPath
      ],
      { windowsHide: true }
    )
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => (stderr += c))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`pip exit ${code}: ${stderr.slice(-500)}`))
    })
  })

  void jobId
  return { outputPath }
}
