import { spawn, type ChildProcess } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { ffmpegPath } from './paths'
import {
  buildAudioSpeedFilter,
  buildVideoFilter,
  even,
  EVEN_PICTURE,
  type FilterClip,
  type SourceDimensions
} from './filters'
import { probeVideo } from './probe'
import { cancelledOr, killAsCancelled } from './cancelMark'
import { CancelLatch, type LatchRun } from './cancelLatch'
import { discardPartialOutput } from './partialOutput'
import { ensureOutputDir, nextFreePath } from './outputPath'
import { assertDefined } from '../../shared/assert'
import { clipSpeed, type ClipRecipe, type CompileSegment } from '../../shared/clip'
import { COMPILE_FPS, compileFps } from '../../shared/compileFps'
import { FFMPEG_EMPTY_OUTPUT, clipNameForSentence } from './noPicture'

// The fallback rate lives in shared (the Compile card derives the same rate from the same probe); main keeps exporting it by this name.
export { COMPILE_FPS }

export interface ConcatJobSpec {
  jobId: string
  sourcePath: string
  outDir: string
  /** Each segment is its clip: the range, and the recipe the clip was built with
   *  (T-96 its crop, T-105 the rest), made exactly as a platform export makes it. */
  segments: CompileSegment[]
  fadeMs: number
  width: number
  height: number
  /** The display name of the video the compilation is made from, safe for a path (T-125 (22)); absent: the source file's own name. */
  sourceName?: string
}

/** A segment is Matroska with PCM sound (T-125 (1)): nothing in it for a stream-copy join to misplace. */
export const SEGMENT_EXTENSION = 'mkv'
export const SEGMENT_AUDIO_CODEC = 'pcm_s16le'

type SegmentClip = Pick<CompileSegment, 'startSec' | 'endSec'> & Partial<ClipRecipe>

/** What the concat demuxer says (exit 0, both majors, measured) when it cannot open a listed segment, and stops there. */
export const FFMPEG_UNREADABLE_PART = /Impossible to open/

// FFMPEG_EMPTY_OUTPUT moved to ./noPicture with the other runners' guards (T-132 (4)); the name stays importable from here.
export { FFMPEG_EMPTY_OUTPUT }

/** The refusal for a segment ffmpeg wrote nothing for (T-131 (1), named by T-132 (12)): its place only when it has no name to give. */
export function emptySegmentMessage(seg: { name?: unknown } | undefined, index: number): string {
  const name = clipNameForSentence(seg)
  const who = name ? `The clip "${name}"` : `Clip ${index + 1} of the compilation`
  return `${who} has no picture in the video (check its start and end), so nothing was saved.`
}

/**
 * The refusal for a join that could not open one of its segments (T-131 (1), T-132 (12)): which clip, when ffmpeg's line says which, and
 * what to do - the segment is the runner's own scratch file, so the cause is usually something holding it (an antivirus scan, a full
 * temp folder) for a moment, and trying again is the honest first step; a clip that fails every time is the one to leave out.
 */
export function lostPartMessage(seg: { name?: unknown } | undefined): string {
  const name = clipNameForSentence(seg)
  const lead = 'The compilation could not be put together because'
  return name
    ? `${lead} the clip "${name}" could not be read, so nothing was saved. Try again, and if it keeps happening, leave that clip out.`
    : `${lead} one of its clips could not be read, so nothing was saved. Try again, and if it keeps happening, compile fewer clips at a time.`
}

/** Which segment the concat demuxer could not open: the index in `seg-<job>-<index>.mkv` on its "Impossible to open" line, or null. */
export function unreadableSegmentIndex(stderr: string, jobId: string): number | null {
  const escaped = jobId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = new RegExp(`Impossible to open[^\\n]*?seg-${escaped}-(\\d+)\\.${SEGMENT_EXTENSION}`).exec(stderr)
  return found?.[1] === undefined ? null : Number(found[1])
}

/**
 * The video filter that makes ONE compilation segment (T-96, T-105): the clip's
 * whole recipe, through the SAME builder a platform export uses
 * (`buildVideoFilter`) — speed, the crop and the centered cut of it to the
 * compilation's shape (T-83: the crop is the new frame, so nothing is
 * stretched), hype shake, the scale that normalizes every segment to one size so
 * the stream-copy join below sees identical streams, color grade, auto zoom and
 * text overlays. The compilation is "a preset" with its own size, 16:9 and the rate of its source (T-130 (q): `compileFps`, up to 60;
 * `fps` is that rate, and `COMPILE_FPS` - 30 - when the caller has none to give).
 *
 * Why the builder and not a copy of its stages: a compilation that carried only
 * the crop (T-96) compiled a 2x clip at 1x with its color, text and zoom gone,
 * and every stage added to the export since would have been missed the same way.
 * The overlays' clock is the segment's — `-ss` is an input option, so the
 * segment's frames start at 0 and the builder rebases the stored source-absolute
 * seconds by `startSec`, exactly as for an export.
 */
export function buildSegmentFilter(
  seg: SegmentClip,
  source: SourceDimensions,
  width: number,
  height: number,
  fps: number = COMPILE_FPS
): string {
  // M4 fix (round 15): even W/H so libx264 doesn't reject the encode.
  // The IPC validator already enforces 16..16384 but doesn't snap to even.
  const w = even(width)
  const h = even(height)
  const clip: FilterClip = {
    startSec: seg.startSec,
    cropRect: seg.cropRect ?? null,
    textOverlays: seg.textOverlays ?? [],
    speedMultiplier: seg.speedMultiplier,
    colorGrade: seg.colorGrade,
    autoZoom: seg.autoZoom,
    hypeShake: seg.hypeShake
  }
  return buildVideoFilter(clip, { width: w, height: h, aspectRatio: w / h, fps }, source)
}

/**
 * Both filter chains for one segment — its picture (`buildSegmentFilter`, then
 * its fade in and fade out) and its sound (`atempo` for the clip's speed, then
 * its fade in and fade out) — with the fades placed on the clip's length in the OUTPUT. A clip
 * at 2x is half as long as its range, and a fade-out that starts 0.3 s before the
 * end of the RANGE would start after the clip is over.
 *
 * T-131 (1): the sound's LAST stage is `apad=whole_dur=<the clip's length in the
 * output>`. A segment is written with `-shortest` (below), so a source whose
 * sound does not cover the range (a Record take whose microphone dropped, a sound
 * that starts late) used to end the segment where the SOUND ended, and a range
 * wholly past it came out as an empty stub that the join dropped along with every
 * segment after it. The pad extends the sound with silence up to the picture's
 * length, so `-shortest` ends the segment at the picture. The length is finite
 * and exact on purpose: a bare `apad` is endless, hangs `-c:v copy` on the
 * bundled 7.0.2, and brought the join drift back on 6.1.1. A source with no
 * sound stream ignores the filter. So `audio` is never ''.
 */
export function buildSegmentFilters(
  seg: SegmentClip,
  source: SourceDimensions,
  width: number,
  height: number,
  fadeIn: number,
  fadeOut: number,
  fps: number = COMPILE_FPS
): { video: string; audio: string } {
  const speed = clipSpeed(seg)
  const outSec = Math.max(0.1, (seg.endSec - seg.startSec) / speed)
  const fadeOutStart = Math.max(0, outSec - fadeOut).toFixed(3)
  const video = [buildSegmentFilter(seg, source, width, height, fps)]
  const audio: string[] = []
  const tempo = buildAudioSpeedFilter(speed)
  if (tempo) audio.push(tempo)
  if (fadeIn > 0) {
    video.push(`fade=t=in:st=0:d=${fadeIn}`)
    audio.push(`afade=t=in:st=0:d=${fadeIn}`)
  }
  if (fadeOut > 0) {
    video.push(`fade=t=out:st=${fadeOutStart}:d=${fadeOut}`)
    audio.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOut}`)
  }
  // simplification: the pad is at the END only. A source whose sound starts AFTER the segment's start (a clip taken from before the sound
  // begins) keeps the gap, so that segment's sound is shorter than its picture by the picture's excess (measured: 60 ms for a 1.6 s gap)
  // and the join pulls the next segment's sound earlier by the same. Upgrade: `aresample=async=1:first_pts=0` ahead of the pad fills the start.
  audio.push(`apad=whole_dur=${outSec.toFixed(3)}`)
  return { video: video.join(','), audio: audio.join(',') }
}

// M3 fix (round 15): register every spawn so a renderer-initiated cancel or
// app-quit can hard-kill them. Mirrors ffmpeg/export.ts activeJobs. Keys are
// the per-spawn jobId; runConcat splits its key into "<jobId>:seg-N" and
// "<jobId>:concat" so the segment loop can cancel one at a time, and a
// global cancelAllConcatJobs takes the lot.
const activeJobs = new Map<string, ChildProcess>()
// T-98: a compilation probes the source, then spawns one child per segment and
// one to join them; between any two of those no child is alive to kill, so a
// Cancel marks the run and the next spawn asks it first.
const latch = new CancelLatch()

function escapeForConcatList(p: string): string {
  return p.replace(/'/g, "'\\''")
}

export function cancelConcatJob(jobId: string): boolean {
  let killed = latch.cancel(jobId)
  // Cancel any sub-keyed children too (segment-N, concat).
  for (const [key, child] of activeJobs) {
    if (key === jobId || key.startsWith(`${jobId}:`)) {
      killAsCancelled(child)
      activeJobs.delete(key)
      killed = true
    }
  }
  return killed
}

export function cancelAllConcatJobs(): void {
  latch.cancelAll()
  for (const [, child] of activeJobs) killAsCancelled(child)
  activeJobs.clear()
}

export async function runConcat(spec: ConcatJobSpec): Promise<{ outputPath: string }> {
  const run = latch.begin(spec.jobId)
  try {
    return await stitch(spec, run)
  } finally {
    run.end()
  }
}

async function stitch(spec: ConcatJobSpec, run: LatchRun): Promise<{ outputPath: string }> {
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
  // T-125 (10): the output folder first. A remembered folder that was deleted (or lives on an unplugged drive) used to be found out
  // only at the join, after every segment had been encoded.
  await run.guard(ensureOutputDir(spec.outDir))
  // The crop is a fraction of the frame, so the frame's pixels are needed once
  // for every segment (main reads them, as a platform export does).
  const probe = await run.guard(probeVideo(spec.sourcePath))
  const source = { width: probe.width, height: probe.height, colorSpace: probe.colorSpace }
  // T-130 (q): the compilation is written at its source's rate up to 60 (a compilation is one source, so the fastest of its clips is
  // that source's), the fps stage and `-r` both. A source that states no rate is `COMPILE_FPS`.
  const fps = compileFps([probe.fps])
  const segCount = spec.segments.length
  for (let i = 0; i < segCount; i++) {
    run.check()
    const seg = assertDefined(spec.segments[i], `segments[${i}]`)
    // Defense in depth: IPC layer also validates this, but reject reversed
    // ranges here too so any non-IPC caller (tests, future scripts) can't
    // produce a -ss > -to ffmpeg invocation that fails silently.
    if (seg.endSec <= seg.startSec) {
      throw new Error(`segments[${i}] range invalid (endSec must exceed startSec)`)
    }
    const segPath = path.join(tempDir, `seg-${spec.jobId}-${i}.${SEGMENT_EXTENSION}`)
    const fadeIn = i === 0 ? 0 : fade
    const fadeOut = i === segCount - 1 ? 0 : fade
    const filters = buildSegmentFilters(seg, source, spec.width, spec.height, fadeIn, fadeOut, fps)

    const args = [
      '-y',
      '-ss',
      seg.startSec.toFixed(3),
      '-to',
      seg.endSec.toFixed(3),
      '-i',
      spec.sourcePath,
      '-vf',
      filters.video
    ]
    args.push('-af', filters.audio)
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-pix_fmt',
      'yuv420p',
      // T-125 (1): the sound of a SEGMENT is uncompressed. An AAC segment carries 1024 samples of priming and about 8 ms of
      // end padding, an MP4 honors one edit list (the first), and the stream-copy join below laid every segment's priming
      // into the middle of the sound: +29.3 ms of delay PER JOIN (eight segments: 0 / 30 / 59 / 88 / 118 / 147 / 176 /
      // 206 ms, measured through this runner on both majors, invisible to a duration check). PCM has neither, so the
      // segments join sample-exact and the sound is encoded ONCE, at the join. (MPEG-TS would also join clean, but
      // the bundled 7.0.2 segfaults on it - see `shared/mediaFormats.ts`.)
      '-c:a',
      SEGMENT_AUDIO_CODEC,
      '-r',
      String(fps),
      // T-127 (4): a segment ends where its SHORTER stream does. A length that is not a whole number of frames wrote one or two extra
      // video frames (the fps stage, a fractional -ss, the EOF fill), the join's concat demuxer offsets the next segment by the
      // container's picture-led length, and the join's AAC encode swallows the gap in the sound: the picture fell further behind it at
      // every join (eight fractional segments of a 25 fps source, through this runner on both majors: 3 / 57 / 83 / 112 / 125 / 161 /
      // 194 / 194 ms, a flat 3 / -3 / 7 / 0 / 0 / 0 / 0 / 0 with this line) while every duration check stayed green.
      // T-131 (1): "its shorter stream" is the picture ONLY because the `-af` above ends in `apad=whole_dur=<the segment's length>`
      // (`buildSegmentFilters`). Without it a source whose sound is shorter than the range ended the segment at the sound.
      '-shortest',
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
      let wroteNothing = false
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (c: string) => {
        stderr += c
        wroteNothing ||= FFMPEG_EMPTY_OUTPUT.test(stderr)
        // Round 18: cap like every other spawn site (round-16 lesson) — a
        // long many-segment compilation otherwise grows this unboundedly.
        if (stderr.length > 16384) stderr = stderr.slice(-16384)
      })
      child.on('error', (err) => {
        activeJobs.delete(childKey)
        reject(cancelledOr(child, err))
      })
      child.on('close', (code) => {
        activeJobs.delete(childKey)
        // T-131 (1): an empty segment is an exit-0 stub the join would silently drop, with every segment after it.
        if (code === 0 && wroteNothing) {
          reject(new Error(emptySegmentMessage(seg, i)))
        } else if (code === 0) resolve()
        else reject(cancelledOr(child, new Error(`segment ${i} exit ${code}: ${stderr.slice(-500)}`)))
      })
    })
  }

  const listFilePath = path.join(tempDir, `list-${spec.jobId}.txt`)
  listFile = listFilePath
  const listContent = segmentPaths
    .map((p) => `file '${escapeForConcatList(p)}'`)
    .join('\n')
  await writeFile(listFilePath, listContent, 'utf8')

  const base = spec.sourceName ?? path.parse(spec.sourcePath).name
  // T-106: `<source>_compilation.mp4` is the name WANTED; a compilation already
  // there is the user's, and this one is written beside it.
  const outputPath = await run.guard(
    nextFreePath(path.join(spec.outDir, `${base}_compilation.mp4`))
  )

  let spawnedAt: number | null = null
  await new Promise<void>((resolve, reject) => {
    // The last pre-spawn await was the choosing of the output's name.
    run.check()
    spawnedAt = Date.now()
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
        // The picture is copied (it is already the one encode it needs); the sound is the compilation's one AAC encode.
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        outputPath
      ],
      { windowsHide: true }
    )
    const childKey = `${spec.jobId}:concat`
    activeJobs.set(childKey, child)
    let stderr = ''
    let lostAPart = false
    // T-132 (12): which segment, read off the same line, while it is still in the kept tail (a sticky fact, like `lostAPart`).
    let lostIndex: number | null = null
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => {
      stderr += c
      lostAPart ||= FFMPEG_UNREADABLE_PART.test(stderr)
      if (lostIndex === null) lostIndex = unreadableSegmentIndex(stderr, spec.jobId)
      // Round 18: cap like every other spawn site (round-16 lesson).
      if (stderr.length > 16384) stderr = stderr.slice(-16384)
    })
    child.on('error', (err) => {
      activeJobs.delete(childKey)
      reject(cancelledOr(child, err))
    })
    child.on('close', (code) => {
      activeJobs.delete(childKey)
      // T-131 (1): a segment the join cannot open ends the join THERE and ffmpeg still exits 0: a shorter file, "Saved". The catch
      // below removes it like any failed join's output.
      if (code === 0 && lostAPart) {
        reject(new Error(lostPartMessage(lostIndex === null ? undefined : spec.segments[lostIndex])))
      } else if (code === 0) resolve()
      else reject(cancelledOr(child, new Error(`concat exit ${code}: ${stderr.slice(-500)}`)))
    })
  }).catch(async (err: unknown) => {
    // T-100: the segments go in the `finally` below; the joined file is this job's too.
    await discardPartialOutput(outputPath, spawnedAt)
    throw err
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

/**
 * `wantedPath` is the name the composite should have (T-106): a file already
 * there is not replaced — the result's `outputPath` is the one written. Choosing
 * it is a wait before the spawn, so PiP holds a run like the other runners
 * (T-98); `cancelConcatJob` (its cancel) marks it.
 */
export async function runPipComposite(
  jobId: string,
  basePath: string,
  overlayPath: string,
  wantedPath: string,
  options: {
    overlayWidth: number
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    margin: number
  }
): Promise<{ outputPath: string }> {
  const run = latch.begin(jobId)
  try {
    return await compositePip(run, jobId, basePath, overlayPath, wantedPath, options)
  } finally {
    run.end()
  }
}

async function compositePip(
  run: LatchRun,
  jobId: string,
  basePath: string,
  overlayPath: string,
  wantedPath: string,
  options: {
    overlayWidth: number
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    margin: number
  }
): Promise<{ outputPath: string }> {
  const { position, margin, overlayWidth } = options
  const x = position.includes('left') ? margin : `main_w-overlay_w-${margin}`
  const y = position.includes('top') ? margin : `main_h-overlay_h-${margin}`
  // T-114: the output is sized by the base, and libx264 + yuv420p die at exit 187 on an odd
  // edge, so the base is evened first (an even one passes through untouched).
  const filter =
    `[0:v]${EVEN_PICTURE}[base];` +
    `[1:v]scale=${overlayWidth}:-1[ov];` +
    `[base][ov]overlay=${x}:${y}[v]`

  // T-125 (10): the folder is there before the name is chosen.
  await run.guard(ensureOutputDir(path.dirname(wantedPath)))
  // T-131 (2): the output is the base's length (the overlay follows its frames), and the base's sound is padded to it below. A base whose
  // length cannot be read (a recording with no duration) is not padded: the output ends where its sound does, as it always did.
  const baseSec = await run.guard(probeVideo(basePath).then((p) => p.duration, () => null))
  const outputPath = await run.guard(nextFreePath(wantedPath))
  let spawnedAt: number | null = null
  await new Promise<void>((resolve, reject) => {
    run.check()
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
        // T-121: keep each frame at its own time (see the convert, T-120). The base is often a Record WebM
        // whose container rate reads 1000/1, and the mp4 muxer's default constant rate wrote a frame per
        // millisecond; the overlay follows the base's frames, so they are the ones that matter.
        '-fps_mode',
        'vfr',
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
        // T-131 (2): `-shortest` ended the output where a SHORTER base sound did (a Record take whose microphone dropped at 5 s of 12 came
        // out 5.0 s long). The sound is padded with silence to the base's length (finite: a bare `apad` hangs), so `-shortest` ends at the
        // picture whichever stream is shorter. It stays: it is also what ends the output when the overlay outlasts the base.
        ...(baseSec === null ? [] : ['-af', `apad=whole_dur=${baseSec.toFixed(3)}`]),
        '-shortest',
        // B5 fix (round 15): PiP composite MP4 needs faststart so web players
        // don't stall while seeking the moov atom.
        '-movflags',
        '+faststart',
        outputPath
      ],
      { windowsHide: true }
    )
    spawnedAt = Date.now()
    // M3 fix (round 15): register the child so app-quit can SIGKILL it.
    // The IPC layer now passes a real jobId (was `_jobId`).
    activeJobs.set(jobId, child)
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => {
      stderr += c
      // Round 18: cap like every other spawn site (round-16 lesson).
      if (stderr.length > 16384) stderr = stderr.slice(-16384)
    })
    child.on('error', (err) => {
      activeJobs.delete(jobId)
      reject(cancelledOr(child, err))
    })
    child.on('close', (code) => {
      activeJobs.delete(jobId)
      if (code === 0) resolve()
      else reject(cancelledOr(child, new Error(`pip exit ${code}: ${stderr.slice(-500)}`)))
    })
  }).catch(async (err: unknown) => {
    await discardPartialOutput(outputPath, spawnedAt)
    throw err
  })

  return { outputPath }
}
