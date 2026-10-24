import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, rm, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ffmpegPath, ffprobePath } from '../../src/main/ffmpeg/paths'
import { runExportJob, cancelAllExportJobs } from '../../src/main/ffmpeg/export'
import { runGifExport, cancelGifJob } from '../../src/main/ffmpeg/gif'
import {
  runAudioExport,
  runAudioMux,
  runAudioReattach,
  cancelAudioJob
} from '../../src/main/audio/process'
import { buildChain } from '../../src/main/audio/chain'
import { outputFolderRefusal } from '../../src/main/ffmpeg/outputPath'
import { probeVideo } from '../../src/main/ffmpeg/probe'
import { probeAudio } from '../../src/main/audio/probe'
import {
  convertForImport,
  convertToMp4,
  remuxWebm,
  cancelConverts,
  cancelAllConverts,
  ConvertCancelledError
} from '../../src/main/ffmpeg/convert'
import { drainRuns } from '../../src/main/ffmpeg/cancelLatch'
import { extractAudioFromVideo, cancelAllExtractions } from '../../src/main/audio/extract'
import { readPeaks, cancelPeaksJob } from '../../src/main/audio/peaks'
import { runReframe, cancelReframeJob } from '../../src/main/ffmpeg/reframe'
import {
  runConcat,
  runPipComposite,
  cancelConcatJob,
  buildSegmentFilters,
  SEGMENT_AUDIO_CODEC,
  SEGMENT_EXTENSION,
  FFMPEG_EMPTY_OUTPUT,
  FFMPEG_UNREADABLE_PART,
  unreadableSegmentIndex,
  type ConcatJobSpec
} from '../../src/main/ffmpeg/concat'
import {
  EBUR128_SCAN_FILTER,
  __testing__ as highlightsTesting,
  analyzeClipHook,
  findHighlights,
  cancelActiveHighlightScan
} from '../../src/main/ffmpeg/highlights'
import { extractFrame, cancelAllFrameJobs } from '../../src/main/ffmpeg/frame'
import { BURN_IN_NO_PICTURE_MESSAGE, PictureFrames } from '../../src/main/ffmpeg/noPicture'
import { isCancelledError } from '../../src/shared/cancel'
import { killAsCancelled } from '../../src/main/ffmpeg/cancelMark'
import { runBurnIn, cancelBurnIn } from '../../src/main/sidecars/whisperManager'
import type {
  Clip,
  ExportJobSpec,
  PlatformId,
  TextOverlay,
  WatermarkSpec
} from '../../src/shared/clip'
import type { CustomPreset } from '../../src/shared/customPresets'
import {
  DEFAULT_CHAIN_SPEC,
  NoUsableDurationError,
  PEAK_BUCKETS,
  WAVEFORM_READ_FAILED,
  audioFileExtension,
  type AudioExportSpec,
  type ChainSpec
} from '../../src/shared/audio'
import {
  DEFAULT_CAPTION_STYLE,
  escapeSubtitlesPath,
  shiftSrtToRange,
  tsToSeconds,
  TRANSCRIPTION_AUDIO
} from '../../src/shared/captions'
import { ALL_PRESET_IDS, PLATFORM_PRESETS } from '../../src/main/ffmpeg/presets'
import { buildWatermark, watermarkInset } from '../../src/shared/watermark'
import { OVERLAY_FONTS } from '../../src/shared/textOverlay'
import { buildKitQueue } from '../../src/renderer/src/modules/video-studio/clipKit'

/**
 * Layer 5: real-media integration tests.
 *
 * Every other test layer stops short of spawning ffmpeg. This one drives the
 * actual production job runners (runExportJob, runAudioExport, runGifExport,
 * runAudioMux) against tiny generated sources and asserts on the bytes that
 * come out — dimensions, codecs, faststart layout, loudness, duration. It is
 * the layer that catches "the filter string parses in a unit test but ffmpeg
 * rejects the graph at runtime".
 *
 * Run with: npm run test:media   (not part of `npm run verify` — see
 * vitest.integration.config.ts for why).
 */

let workDir = ''
let landscapeSrc = '' // 1920x1080 + stereo audio
let oddSrc = '' // 1919x1079 (odd dims) + audio
let portraitSrc = '' // 1080x1920 + audio
let noAudioSrc = '' // 1280x720, video only
let voiceWav = '' // 8s mono 44.1k tone bursts (speech stand-in)
let musicWav = '' // 8s stereo 44.1k constant 3 kHz tone (secondary stand-in)
// 640x480 @ 24fps, 20s. Every frame is a flat gray whose value encodes its
// own timestamp (luma = 12 * t), so any cut/concat output can be checked for
// "does this frame come from the second we asked for". Audio is a quiet
// 440 Hz bed with one unmistakable 1.5s burst at 10.0-11.5s.
let rampSrc = ''
// Flat green 640x360, video only — the PiP overlay fixture. A single flat
// color makes "is the overlay actually in the output" a pixel readback.
let pipOverlaySrc = ''
const PIP_OVERLAY_RGB: readonly [number, number, number] = [30, 223, 74]
// Flat mid-gray 1920x1080 + stereo audio — the drawtext fixture (T-51).
// Featureless on purpose: see the block comment on the drawtext describe.
let flatGraySrc = ''

function ff(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += String(b)))
    child.stderr.on('data', (b) => (stderr += String(b)))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-800)}`))
    })
  })
}

function ffprobeJson(file: string): Promise<{
  streams: Array<{
    codec_type: string
    codec_name?: string
    codec_tag_string?: string
    width?: number
    height?: number
    pix_fmt?: string
    sample_rate?: string
    channels?: number
    avg_frame_rate?: string
    r_frame_rate?: string
    nb_frames?: string
    sample_aspect_ratio?: string
    display_aspect_ratio?: string
    duration?: string
    start_time?: string
    color_space?: string
  }>
  format: { duration?: string; format_name?: string }
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      file
    ])
    let out = ''
    child.stdout.on('data', (b) => (out += String(b)))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffprobe exit ${code} for ${file}`))
      else resolve(JSON.parse(out))
    })
  })
}

/**
 * The presentation time (`pts_time`) of every video packet of `file`, in seconds, sorted. T-122: the
 * timestamps a cut re-attach WROTE, read back the way a player's seek bar reads them - two packets with one
 * time are two frames on one instant, and a time that is not where the survivor belongs is a frame shown early.
 */
async function videoPacketTimes(file: string): Promise<number[]> {
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffprobePath, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file
    ])
    let text = ''
    child.stdout.on('data', (b) => (text += String(b)))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(`ffprobe exit ${code} for ${file}`))))
  })
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map(Number)
    .sort((a, b) => a - b)
}

/** moov atom must precede mdat for a faststart (streamable) MP4. */
async function assertFaststart(file: string): Promise<void> {
  const buf = await readFile(file)
  const moov = buf.indexOf('moov')
  const mdat = buf.indexOf('mdat')
  expect(moov, `moov atom present in ${path.basename(file)}`).toBeGreaterThan(-1)
  expect(mdat, `mdat atom present in ${path.basename(file)}`).toBeGreaterThan(-1)
  expect(moov, `moov before mdat (faststart) in ${path.basename(file)}`).toBeLessThan(mdat)
}

/**
 * Integrated LUFS of a file, measured with ebur128. `dualMono` (T-123 (11)) is the meter a STEREO PLAYBACK of a mono file
 * reads: R128 counts a mono file as one channel, but both speakers carry it, 3 LU hotter. An export of a mono source is
 * judged on that one (a mono file has the same plain reading whatever the playback does), a stereo file on the plain one.
 */
async function measureLufs(file: string, dualMono = false): Promise<number> {
  const { stderr } = await ff([
    '-hide_banner',
    '-i',
    file,
    '-af',
    dualMono ? 'ebur128=dualmono=true:framelog=verbose' : 'ebur128=framelog=verbose',
    '-f',
    'null',
    '-'
  ])
  const m = stderr.match(/I:\s+(-?[\d.]+)\s+LUFS/g)
  if (!m || m.length === 0) throw new Error('no ebur128 summary found')
  const last = m[m.length - 1]
  const v = last.match(/(-?[\d.]+)/)
  if (!v) throw new Error('unparseable ebur128 summary')
  return Number(v[1])
}

/**
 * Mean volume (dB) of `file` in [start, start+len), band-passed around
 * `freqHz` so a single tone can be isolated out of a mix.
 */
async function bandMeanVolume(
  file: string,
  start: number,
  len: number,
  freqHz: number
): Promise<number> {
  const { stderr } = await ff([
    '-hide_banner',
    '-ss',
    String(start),
    '-t',
    String(len),
    '-i',
    file,
    '-af',
    `bandpass=f=${freqHz}:width_type=q:w=5,volumedetect`,
    '-f',
    'null',
    '-'
  ])
  const m = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/)
  if (!m) throw new Error('no volumedetect output')
  return Number(m[1])
}

/**
 * Raw pixel bytes of `crop` (an ffmpeg crop= argument) at `timeSec`, decoded
 * to `pixFmt`. Written to a scratch file rather than piped, because the `ff`
 * helper accumulates stdout as a string and would mangle binary.
 */
let pixelSampleSeq = 0
async function samplePixels(
  file: string,
  timeSec: number,
  crop: string,
  pixFmt: 'gray' | 'rgb24'
): Promise<Buffer> {
  const raw = path.join(workDir, `sample-${pixelSampleSeq++}.raw`)
  // A still image (a Clip Kit thumbnail, T-130) has no clock: `-ss 0` on a JPEG decodes nothing at all.
  const stillImage = /\.(jpe?g|png)$/i.test(file)
  await ff([
    '-y',
    ...(stillImage ? [] : ['-ss', String(timeSec)]),
    '-i', file,
    '-vf', `${crop},format=${pixFmt}`,
    '-frames:v', '1',
    '-f', 'rawvideo',
    raw
  ])
  return readFile(raw)
}

/** Mean luma (0-255) of a centered 8x8 patch — reads the ramp fixture's clock. */
async function meanLuma(file: string, timeSec: number): Promise<number> {
  const buf = await samplePixels(file, timeSec, 'crop=8:8:(iw-8)/2:(ih-8)/2', 'gray')
  let sum = 0
  for (const b of buf) sum += b
  return sum / buf.length
}

/** Mean R/G/B of the 2x2 patch whose top-left corner is (x, y). */
async function meanRgb(
  file: string,
  timeSec: number,
  x: number,
  y: number
): Promise<[number, number, number]> {
  const buf = await samplePixels(file, timeSec, `crop=2:2:${x}:${y}`, 'rgb24')
  const acc = [0, 0, 0]
  for (let i = 0; i < buf.length; i += 3) {
    acc[0] += buf[i] ?? 0
    acc[1] += buf[i + 1] ?? 0
    acc[2] += buf[i + 2] ?? 0
  }
  const n = buf.length / 3
  return [acc[0] / n, acc[1] / n, acc[2] / n] as [number, number, number]
}

/**
 * min / max / mean luma (0-255) over an arbitrary crop region of one frame.
 * On the flat-gray fixture an untouched region reports min === max, so a
 * spread is proof that something was painted there.
 */
async function regionLuma(
  file: string,
  timeSec: number,
  crop: string
): Promise<{ min: number; max: number; mean: number }> {
  const buf = await samplePixels(file, timeSec, crop, 'gray')
  let min = 255
  let max = 0
  let sum = 0
  for (const v of buf) {
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  return { min, max, mean: sum / buf.length }
}

/**
 * How many pixels in `crop` are unmistakably tinted toward `dominant`
 * (0=R, 1=G, 2=B) — that channel more than 60 levels above BOTH the others.
 * The gray fixture is achromatic by construction, so a region with no
 * coloured text scores exactly 0 and any nonzero count is glyph pixels that
 * carry the overlay's own `colorHex`.
 */
async function countTintedPixels(
  file: string,
  timeSec: number,
  crop: string,
  dominant: 0 | 1 | 2
): Promise<number> {
  const buf = await samplePixels(file, timeSec, crop, 'rgb24')
  let n = 0
  for (let i = 0; i + 2 < buf.length; i += 3) {
    const r = buf[i]
    const g = buf[i + 1]
    const b = buf[i + 2]
    const lead = dominant === 0 ? r : dominant === 1 ? g : b
    const rest = Math.max(dominant === 0 ? g : r, dominant === 2 ? g : b)
    if (lead - rest > 60) n++
  }
  return n
}

/**
 * The horizontal extent, in pixels, of the pixels in `crop` that are unmistakably tinted toward
 * `dominant` (the same test as `countTintedPixels`): last tinted column minus first, plus one -
 * 0 when there are none. `cropWidth` is the crop's width, which the rows are read against. A
 * line of the same text in two typefaces has two widths, and a width does not depend on how
 * many pixels a thin stem happens to cover.
 */
async function tintedExtentX(
  file: string,
  timeSec: number,
  crop: string,
  cropWidth: number,
  dominant: 0 | 1 | 2
): Promise<number> {
  const buf = await samplePixels(file, timeSec, crop, 'rgb24')
  let first = -1
  let last = -1
  for (let i = 0; i + 2 < buf.length; i += 3) {
    const r = buf[i] ?? 0
    const g = buf[i + 1] ?? 0
    const b = buf[i + 2] ?? 0
    const lead = dominant === 0 ? r : dominant === 1 ? g : b
    const rest = Math.max(dominant === 0 ? g : r, dominant === 2 ? g : b)
    if (lead - rest <= 60) continue
    const x = (i / 3) % cropWidth
    if (first === -1 || x < first) first = x
    if (x > last) last = x
  }
  return first === -1 ? 0 : last - first + 1
}

/**
 * Bounding box of the bright (> 128 luma) region of the WHOLE frame of `file`
 * at `timeSec` (`width` x `height` is the frame's known size, so a short read
 * fails loudly instead of measuring a different picture). The marker fixtures
 * (T-83, T-96) are black frames carrying a white square; a square that comes
 * out non-square was resampled by different factors on its two axes.
 */
async function brightBox(
  file: string,
  timeSec: number,
  width: number,
  height: number
): Promise<{ w: number; h: number; cx: number; cy: number }> {
  const buf = await samplePixels(file, timeSec, 'null', 'gray')
  expect(buf.length, 'the whole output frame was decoded').toBe(width * height)
  let minX = width
  let maxX = -1
  let minY = height
  let maxY = -1
  for (let i = 0; i < buf.length; i++) {
    if ((buf[i] ?? 0) <= 128) continue
    const x = i % width
    const y = (i - x) / width
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  expect(maxX, 'a bright marker exists in the output at all').toBeGreaterThan(-1)
  return { w: maxX - minX + 1, h: maxY - minY + 1, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

/**
 * Every filter name compiled into the bundled ffmpeg, parsed out of the
 * `-filters` table (`flags name in->out description`). Asking the binary
 * what it can do is the only way to tell a per-platform capability gap from
 * a bug in our own filter string.
 */
async function ffFilterNames(): Promise<Set<string>> {
  const { stdout } = await ff(['-hide_banner', '-filters'])
  const names = new Set<string>()
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*[A-Z.]{3}\s+(\S+)\s+\S+->\S+/)
    if (m) names.add(m[1])
  }
  return names
}

/** Largest per-channel absolute difference between two RGB samples. */
function rgbDelta(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
}

/**
 * Average PSNR (dB) between the same `crop` region of two same-size videos.
 * Identical regions report `inf`, normalized here to 99. Low PSNR means the
 * region genuinely differs; high means it is untouched.
 */
async function regionPsnr(fileA: string, fileB: string, crop: string): Promise<number> {
  const { stderr } = await ff([
    '-hide_banner',
    '-i', fileA,
    '-i', fileB,
    '-lavfi', `[0:v]${crop}[a];[1:v]${crop}[b];[a][b]psnr`,
    '-f', 'null',
    '-'
  ])
  const m = stderr.match(/average:\s*(inf|[\d.]+)/)
  if (!m) throw new Error(`no psnr summary for ${path.basename(fileA)}`)
  return m[1] === 'inf' ? 99 : Number(m[1])
}

/**
 * Decode every stream of `file` to /dev/null and report how much raw output
 * each produced. `-xerror` turns any decode error into a non-zero exit, so
 * `ff` rejects; a non-zero audio figure proves the audio stream really
 * decoded rather than merely being listed by ffprobe.
 */
async function decodeSizes(file: string): Promise<{ videoKiB: number; audioKiB: number }> {
  const { stderr } = await ff(['-hide_banner', '-xerror', '-i', file, '-f', 'null', '-'])
  // Both unit spellings, deliberately: ffmpeg 7 prints the decode summary
  // as `KiB` (IEC), ffmpeg 6 as `kB` — and ffmpeg-static ships 7.0.2 on
  // linux but 6.1.1 (gyan.dev) on win32, the shipping platform. Both mean
  // 1024 bytes here; the v1.5.0 release run (the only win32 execution of
  // this suite) caught the 7-only regex returning "no decode summary" for
  // every PiP/concat output. Same per-platform-builder split documented in
  // shared/mediaFormats.ts.
  const v = stderr.match(/video:\s*(\d+)\s*[kK]i?B/)
  const a = stderr.match(/audio:\s*(\d+)\s*[kK]i?B/)
  if (!v || !a) throw new Error(`no decode summary for ${path.basename(file)}`)
  return { videoKiB: Number(v[1]), audioKiB: Number(a[1]) }
}

/**
 * Count the ebur128 momentary-loudness samples ffmpeg prints for a window,
 * using `framelog=info` — the setting that actually reaches stderr at the
 * default log level. Used to prove the highlight fixtures carry a real
 * loudness contrast independent of what highlights.ts manages to parse.
 */
async function momentaryLoudness(
  file: string,
  startSec: number,
  lenSec: number
): Promise<number[]> {
  const { stderr } = await ff([
    '-hide_banner',
    '-ss', String(startSec),
    '-t', String(lenSec),
    '-i', file,
    '-vn',
    '-af', 'ebur128=metadata=1:framelog=info:peak=true',
    '-f', 'null',
    '-'
  ])
  const out: number[] = []
  const re = /M:\s*(-?[\d.]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stderr)) !== null) {
    const v = Number(m[1])
    if (Number.isFinite(v)) out.push(v)
  }
  return out
}

/** `actual` is within `tolerance` of `expected`, saying what was measured when it is not. */
function near(actual: number, expected: number, tolerance: number, what: string): void {
  expect(Math.abs(actual - expected), `${what}: ${actual} s, expected ${expected} s`).toBeLessThanOrEqual(tolerance)
}

/** Where the last packet of the file's `select` stream ends, in seconds (T-131): what a player reaches, whatever the container's header says. */
async function packetsEnd(file: string, select: string): Promise<number> {
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffprobePath, ['-v', 'error', '-select_streams', select, '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', file])
    let text = ''
    child.stdout.on('data', (b) => (text += String(b)))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(`ffprobe exit ${code} for ${file}`))))
  })
  return Math.max(...out.split('\n').filter((l) => l.trim() !== '').map((l) => { const [t, d] = l.split(','); return Number(t) + Number(d) }))
}

/**
 * When each flash of a picture starts (T-125 (1)): the `pts_time` of every frame whose mean luma crosses 128 going up, read
 * through `signalstats` the way a player's clock reads them. The fixture's flashes are whole frames, so this is exact to a frame.
 */
async function flashStarts(file: string): Promise<number[]> {
  const { stdout } = await ff([
    '-v', 'error', '-i', file, '-an',
    '-vf', 'scale=8:8,format=gray,signalstats,metadata=print:file=-',
    '-f', 'null', '-'
  ])
  const starts: number[] = []
  let t = 0
  let high = false
  for (const line of stdout.split('\n')) {
    const at = line.match(/pts_time:([\d.]+)/)
    if (at) t = Number(at[1])
    const y = line.match(/YAVG=([\d.]+)/)
    if (y) {
      const now = Number(y[1]) > 128
      if (now && !high) starts.push(t)
      high = now
    }
  }
  return starts
}

/**
 * When each burst of sound in `file` starts (T-125), in seconds: the first sample louder than `threshold` in each burst (bursts
 * further apart than `gapSec`).
 *
 * The default reads the DECODER'S OWN samples, in the order the file holds them, plus the sound stream's `start_time`, with nothing
 * inserted or dropped to make them fit a clock: a drift between joins (item 1) is a sound that is late IN the file, and
 * `aresample=async=1` would pad and trim a drift of 100 ms or more and read it back as small.
 *
 * `onContainerClock` instead reads them the way a player places them: `aresample=async=1:first_pts=0` pads a sound that starts
 * after the container's zero with silence (and trims one that starts before it, an encoder's priming), so sample N is container time
 * N / 48000. For a single-pass file with no drift inside it (item 2: a sound that STARTS late), this is where the burst is heard.
 *
 * Written to a scratch file, not piped, for the same reason `samplePixels` is.
 */
let pcmSampleSeq = 0
async function soundBurstStarts(
  file: string,
  threshold: number,
  gapSec: number,
  onContainerClock = false
): Promise<number[]> {
  const startSec = onContainerClock
    ? 0
    : Number((await ffprobeJson(file)).streams.find((s) => s.codec_type === 'audio')?.start_time ?? 0)
  const raw = path.join(workDir, `pcm-${pcmSampleSeq++}.raw`)
  await ff([
    '-v', 'error', '-y', '-i', file, '-vn',
    ...(onContainerClock ? ['-af', 'aresample=async=1:first_pts=0'] : []),
    '-ac', '1', '-ar', '48000', '-f', 'f32le', raw
  ])
  const buf = await readFile(raw)
  const samples = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const starts: number[] = []
  let last = -Infinity
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i] ?? 0) <= threshold) continue
    if (i - last > gapSec * 48000) starts.push(startSec + i / 48000)
    last = i
  }
  return starts
}

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip1',
    name: 'test clip',
    startSec: 1,
    endSec: 4,
    cropRect: null,
    textOverlays: [],
    selectedPresets: ['youtube'],
    ...overrides
  }
}

function makeJob(
  sourcePath: string,
  preset: PlatformId,
  clip: Clip,
  jobId: string
): ExportJobSpec {
  return { jobId, sourcePath, outDir: workDir, clip, preset }
}

/** The stand-in box, in the same band the glyphs it replaces would occupy. */
const STAND_IN_BOX_W = 200
const STAND_IN_BOX_H = 120

/**
 * T-74 — run a REAL export with `drawtext` swapped for `drawbox`.
 *
 * The bundled linux ffmpeg has no drawtext (see the T-51 block), so the one
 * thing a text overlay's `enable` window can be proven against on this
 * platform is a filter every build has. The swap is the filter NAME and
 * nothing else: the chain is still whatever the production `buildVideoFilter`
 * returned, the `enable` expression is carried across byte for byte, the box
 * takes the x/y and the colour out of the drawtext string it replaces, and
 * the command around it — above all the `-ss` before `-i` that makes the
 * graph's clock clip-relative — is `runExportJob`'s own. A regression in
 * either half fails the tests that use this; a hand-written ffmpeg command in
 * the test would only ever prove what ffmpeg does, not what we ask it.
 */
async function withDrawboxStandIn<T>(run: () => Promise<T>): Promise<T> {
  vi.resetModules()
  vi.doMock('../../src/main/ffmpeg/filters', async () => {
    const real = await vi.importActual<typeof import('../../src/main/ffmpeg/filters')>(
      '../../src/main/ffmpeg/filters'
    )
    return {
      ...real,
      buildVideoFilter: (...args: Parameters<typeof real.buildVideoFilter>): string => {
        const chain = real.buildVideoFilter(...args)
        let swapped = 0
        const standIn = chain.replace(
          /drawtext=([\s\S]*?):x=(-?\d+):y=(-?\d+):enable='(between\(t,[-\d.]+,[-\d.]+\))'/g,
          (_all: string, head: string, x: string, y: string, enable: string): string => {
            const color = /fontcolor=([^:]+)/.exec(head)
            if (!color) throw new Error(`drawbox stand-in: no fontcolor in "${head}"`)
            swapped += 1
            return `drawbox=x=${x}:y=${y}:w=${STAND_IN_BOX_W}:h=${STAND_IN_BOX_H}:color=${color[1]}@1:t=fill:enable='${enable}'`
          }
        )
        const expected = args[0].textOverlays.length
        if (swapped !== expected) {
          throw new Error(
            `drawbox stand-in: swapped ${swapped} of ${expected} overlays in "${chain}"`
          )
        }
        return standIn
      }
    }
  })
  try {
    return await run()
  } finally {
    vi.doUnmock('../../src/main/ffmpeg/filters')
    vi.resetModules()
  }
}

async function exportWithDrawboxStandIn(job: ExportJobSpec): Promise<string> {
  return withDrawboxStandIn(async () => {
    const { runExportJob: run } = await import('../../src/main/ffmpeg/export')
    const res = await run(job, () => {})
    return res.outputPath
  })
}

/**
 * T-105 — the same swap for a COMPILATION. A compiled segment is built by
 * production's own `buildVideoFilter` now (one implementation of "what a clip's
 * recipe is"), so the stand-in reaches it the same way: the filter name is the
 * only thing replaced, and the `-ss` before `-i` that makes each segment's
 * graph clock clip-relative is `runConcat`'s own.
 */
async function compileWithDrawboxStandIn(spec: ConcatJobSpec): Promise<string> {
  return withDrawboxStandIn(async () => {
    const { runConcat: run } = await import('../../src/main/ffmpeg/concat')
    const res = await run(spec)
    return res.outputPath
  })
}

/**
 * T-125 (9) - the same swap for a REFRAME. The strip is built by production's own `buildVideoFilter` (the stand-in reaches it the
 * way it reaches an export's and a compilation's); `runReframe`'s own `-ss` before `-i` is what makes its graph clock clip-relative.
 */
async function reframeWithDrawboxStandIn(spec: Parameters<typeof runReframe>[0]): Promise<string> {
  return withDrawboxStandIn(async () => {
    const { runReframe: run } = await import('../../src/main/ffmpeg/reframe')
    const res = await run(spec, () => {})
    return res.outputPath
  })
}

/** sha256 of a file's bytes — "the earlier export is exactly what it was". */
async function fileSha(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'imagii-media-'))

  landscapeSrc = path.join(workDir, 'land.mp4')
  await ff([
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-shortest', landscapeSrc
  ])

  // Odd-dimension source: yuv444p lets libx264 encode 1919x1079 so we can
  // prove the even() crop handling end-to-end.
  oddSrc = path.join(workDir, 'odd.mp4')
  await ff([
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1919x1079:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv444p',
    '-c:a', 'aac', '-shortest', oddSrc
  ])

  portraitSrc = path.join(workDir, 'portrait.mp4')
  await ff([
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', portraitSrc
  ])

  noAudioSrc = path.join(workDir, 'noaudio.mp4')
  await ff([
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    noAudioSrc
  ])

  // Primary: 300 Hz bursts — on 0-2s and 4-6s, silent 2-4s and 6-8s. Noisy
  // enough for denoise/loudnorm to have something to chew on.
  voiceWav = path.join(workDir, 'voice.wav')
  await ff([
    '-y',
    '-f', 'lavfi',
    '-i',
    "sine=frequency=300:sample_rate=44100:duration=8,volume='if(lt(mod(t,4),2),1,0.001)':eval=frame",
    voiceWav
  ])

  // Secondary: constant 3 kHz tone, isolable with a bandpass.
  musicWav = path.join(workDir, 'music.wav')
  await ff([
    '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=3000:sample_rate=44100:duration=8',
    '-ac', '2', musicWav
  ])

  // Self-timestamping source: geq paints every frame a flat gray equal to
  // 12 * T, so meanLuma(file, t) reads back the second that frame came from.
  // That turns "did the cut/concat start where we asked" into an arithmetic
  // assertion instead of an eyeball. Deliberately 640x480 @ 24 fps mono
  // 44.1k — every property differs from the 1280x720 @ 30 fps stereo 48k
  // shape the concat runner normalizes to.
  rampSrc = path.join(workDir, 'ramp.mp4')
  await ff([
    '-y',
    '-f', 'lavfi',
    '-i', "color=c=black:s=640x480:r=24:d=20,format=gray,geq=lum='clip(12*T,0,255)'",
    '-f', 'lavfi',
    '-i',
    "sine=frequency=440:sample_rate=44100:duration=20,volume='if(between(t,10,11.5),1,0.02)':eval=frame",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '1', '-shortest', rampSrc
  ])

  // PiP overlay: flat green, no audio (a real webcam feed is a separate
  // file; the composite maps audio from input 0 only).
  pipOverlaySrc = path.join(workDir, 'pip-overlay.mp4')
  await ff([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x1fe04a:size=640x360:rate=30:duration=6',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    pipOverlaySrc
  ])

  // T-51: featureless mid-gray at the youtube preset's own geometry, so the
  // export's crop/scale stage is a no-op and the ONLY thing that can change
  // a pixel is drawtext. Every other fixture here is testsrc2, whose busy
  // pattern makes x264 re-allocate bits the moment a watermark appears — on
  // that, "the rest of the frame is untouched" can only ever be a PSNR band.
  // On flat frames an untouched region re-encodes bit-identically (measured
  // on a control render: min == max == 128 in all four quadrants), which
  // turns it into an exact assertion.
  // 6 s rather than the 4 s it was: since T-74 every clip cut from it starts
  // at CLIP_START = 2, which is the whole point of that block.
  flatGraySrc = path.join(workDir, 'flat-gray.mp4')
  await ff([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x808080:size=1920x1080:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-shortest', flatGraySrc
  ])
}, 240_000)

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

describe('video export presets (real ffmpeg)', () => {
  it.each(ALL_PRESET_IDS)('%s preset produces upload-ready mp4', async (presetId) => {
    const preset = PLATFORM_PRESETS[presetId]
    const clip = makeClip({ selectedPresets: [presetId] })
    const res = await runExportJob(makeJob(landscapeSrc, presetId, clip, `job-${presetId}`), () => {})
    expect(existsSync(res.outputPath)).toBe(true)

    const info = await ffprobeJson(res.outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    expect(v?.codec_name).toBe('h264')
    expect(v?.pix_fmt).toBe('yuv420p')
    expect(v?.width).toBe(preset.width)
    expect(v?.height).toBe(preset.height)
    // T-130 (q): the preset's own rate (30 on the platforms, 60 on YouTube 1080p60) - from a 30 fps source either way.
    expect(v?.avg_frame_rate).toBe(`${preset.fps}/1`)
    expect(a?.codec_name).toBe('aac')
    const dur = Number(info.format.duration)
    expect(dur).toBeGreaterThan(2.5)
    expect(dur).toBeLessThan(3.6)
    await assertFaststart(res.outputPath)
  })

  it('survives an odd-dimension source (1919x1079)', async () => {
    const clip = makeClip()
    const res = await runExportJob(makeJob(oddSrc, 'youtube', clip, 'job-odd'), () => {})
    const info = await ffprobeJson(res.outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1920)
    expect(v?.height).toBe(1080)
    expect(v?.pix_fmt).toBe('yuv420p')
  })

  it('auto-crops portrait source to landscape preset', async () => {
    const clip = makeClip({ startSec: 0.5, endSec: 3 })
    const res = await runExportJob(makeJob(portraitSrc, 'youtube', clip, 'job-p2l'), () => {})
    const info = await ffprobeJson(res.outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1920)
    expect(v?.height).toBe(1080)
  })

  it('an auto-crop that cannot land on the exact target aspect still ships square pixels', async () => {
    // T-65. `autoCropForAspect` snaps the crop to even pixels, so a 16:9
    // target off a 1080x1920 source crops 1080x606 — 1.7822:1, not
    // 1.7778:1. `scale` alone preserves the SOURCE display aspect, so
    // ffmpeg banked that ~0.25% as SAR 405:404 and every player stretched
    // the "1920x1080" upload back to 1.782:1. Same disease T-12 fixed in
    // runReframe, one table over; only a real encode can see it, which is
    // why it survived every string-shape unit test on this path.
    const clip = makeClip({ startSec: 0.5, endSec: 3 })
    const res = await runExportJob(makeJob(portraitSrc, 'youtube', clip, 'job-p2l-sar'), () => {})
    const info = await ffprobeJson(res.outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1920)
    expect(v?.height).toBe(1080)
    expect(v?.sample_aspect_ratio).toBe('1:1')
    expect(v?.display_aspect_ratio).toBe('16:9')
  })

  it('speed 2x halves output duration and keeps audio in sync', async () => {
    const clip = makeClip({ speedMultiplier: 2, startSec: 0, endSec: 4 })
    const res = await runExportJob(makeJob(landscapeSrc, 'youtube', clip, 'job-speed'), () => {})
    const info = await ffprobeJson(res.outputPath)
    const dur = Number(info.format.duration)
    expect(dur).toBeGreaterThan(1.6)
    expect(dur).toBeLessThan(2.4)
    expect(info.streams.some((s) => s.codec_type === 'audio')).toBe(true)
  })

  it('speed change on a source with no audio stream still exports', async () => {
    const clip = makeClip({ speedMultiplier: 2, startSec: 0, endSec: 3 })
    const res = await runExportJob(makeJob(noAudioSrc, 'youtube', clip, 'job-speed-noaudio'), () => {})
    const info = await ffprobeJson(res.outputPath)
    const dur = Number(info.format.duration)
    expect(dur).toBeGreaterThan(1.2)
    expect(dur).toBeLessThan(1.8)
  })

  it('autoZoom export keeps the preset dimensions on a portrait preset', async () => {
    const clip = makeClip({ autoZoom: true, selectedPresets: ['tiktok'] })
    const res = await runExportJob(makeJob(landscapeSrc, 'tiktok', clip, 'job-zoom'), () => {})
    const info = await ffprobeJson(res.outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1080)
    expect(v?.height).toBe(1920)
    // T-65: this is the auto-crop path too (1920x1080 -> 9:16 snaps to a
    // 606x1080 crop), and zoompan runs AFTER the setsar. Pin square pixels
    // here so a filter appended past the scale can't undo them.
    expect(v?.sample_aspect_ratio).toBe('1:1')
  })

  it('autoZoom export succeeds on a landscape preset too', async () => {
    // Pre-round-18 the zoompan expression used a `t` variable that doesn't
    // exist in zoompan's evaluator, so EVERY autoZoom export failed — this
    // pins the fixed `time`-based expression against real ffmpeg.
    const clip = makeClip({ autoZoom: true })
    const res = await runExportJob(makeJob(landscapeSrc, 'youtube', clip, 'job-zoom-land'), () => {})
    const info = await ffprobeJson(res.outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1920)
    expect(v?.height).toBe(1080)
  })

  it('hypeShake export succeeds and keeps preset dimensions', async () => {
    const clip = makeClip({ hypeShake: true })
    const res = await runExportJob(makeJob(landscapeSrc, 'youtube', clip, 'job-shake'), () => {})
    const info = await ffprobeJson(res.outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1920)
    expect(v?.height).toBe(1080)
  })

  it('color grade + custom crop rect export succeeds', async () => {
    const clip = makeClip({
      cropRect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      colorGrade: { brightness: 0.05, contrast: 1.1, saturation: 1.2, temperature: 0.3 }
    })
    const res = await runExportJob(makeJob(landscapeSrc, 'youtube', clip, 'job-grade'), () => {})
    const info = await ffprobeJson(res.outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1920)
    expect(v?.height).toBe(1080)
  })
})

/**
 * T-83 — a manual crop is the new source frame, so nothing is ever stretched.
 *
 * The bug shipped with every dimension right: `buildVideoFilter` applied
 * `clip.cropRect` verbatim and then `scale` forced the preset's exact WxH, so
 * a 4:3 crop exported to Reels came out 1080x1920 with the picture squeezed
 * ~2.4x tall. ffprobe saw nothing wrong — a stretched file is a valid file.
 * The only instrument that can tell is a marker whose true shape is known.
 *
 * The fixtures are black frames carrying one white SQUARE, centered where
 * every crop below is centered. A square that comes out non-square was
 * resampled by different factors on its two axes, which is the definition of
 * a stretch; and because the square sits at the crop's centre, a sub-crop
 * that was centered keeps it at the output's centre (a sub-crop taken from
 * the corner would not). The output frame is decoded whole and the marker's
 * bounding box is measured from the pixels: no filter string is read, so the
 * test cannot agree with a wrong implementation about what it should say.
 *
 * Rect fractions carry a quarter-pixel nudge (`px(480, 1920)`) because
 * `cropToFilter` floors to an even pixel, and a fraction like 960 / 1080
 * lands a hair under 960 in floating point and would floor to 958.
 */
describe('manual crop exported to a mismatched preset (real ffmpeg, T-83)', () => {
  const MARKER = 160
  let markerSrc = '' // 1920x1080, marker centered at (960, 540)
  let oddMarkerSrc = '' // 1919x1079 yuv444p, same marker — odd source dimensions

  const px = (pixels: number, of: number): number => (pixels + 0.25) / of
  const cropOf = (x: number, y: number, w: number, h: number, srcW = 1920, srcH = 1080) => ({
    x: px(x, srcW),
    y: px(y, srcH),
    w: px(w, srcW),
    h: px(h, srcH)
  })

  beforeAll(async () => {
    markerSrc = path.join(workDir, 'marker.mp4')
    await ff([
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=black:s=1920x1080:r=30:d=3,drawbox=x=880:y=460:w=${MARKER}:h=${MARKER}:color=white:t=fill`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', markerSrc
    ])
    oddMarkerSrc = path.join(workDir, 'marker-odd.mp4')
    await ff([
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=black:s=1919x1079:r=30:d=3,format=yuv444p,drawbox=x=880:y=460:w=${MARKER}:h=${MARKER}:color=white:t=fill`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv444p', oddMarkerSrc
    ])
  }, 60_000)

  /** Bounding box of the bright (> 128 luma) region of the output's frame at 0.5 s. */
  const markerBox = (file: string, width: number, height: number) =>
    brightBox(file, 0.5, width, height)

  const CASES: ReadonlyArray<{
    label: string
    src: () => string
    srcW: number
    srcH: number
    /** The user's crop, in source pixels, centered on the marker. */
    crop: [number, number, number, number]
    preset: PlatformId
    /** The side of the marker once the crop's full width or height has been
     *  mapped onto the preset (derived by hand, not from the filter). */
    expectedMarker: number
  }> = [
    {
      // 4:3 crop -> 9:16 preset. The sub-crop is the crop's full height
      // (720 px) mapped onto 1920 px: 160 * 1920 / 720.
      label: '4:3 crop -> Reels',
      src: () => markerSrc,
      srcW: 1920,
      srcH: 1080,
      crop: [480, 180, 960, 720],
      preset: 'reels',
      expectedMarker: (MARKER * 1920) / 720
    },
    {
      // 9:16 crop -> 16:9 preset. The sub-crop is the crop's full width
      // (540 px) mapped onto 1920 px: 160 * 1920 / 540.
      label: '9:16 crop -> YouTube',
      src: () => markerSrc,
      srcW: 1920,
      srcH: 1080,
      crop: [690, 60, 540, 960],
      preset: 'youtube',
      expectedMarker: (MARKER * 1920) / 540
    },
    {
      // 1:1 crop -> 16:9 preset: a square crop is the worst case for a
      // stretch (1.78x on one axis).
      label: '1:1 crop -> X / Twitter',
      src: () => markerSrc,
      srcW: 1920,
      srcH: 1080,
      crop: [420, 0, 1080, 1080],
      preset: 'twitter',
      expectedMarker: (MARKER * 1280) / 1080
    },
    {
      // The control, and the identity the fix must not disturb: a crop that
      // already has the preset's shape is scaled and nothing else. Green on
      // the old code too; it is here so a fix that "solves" the mismatch by
      // cropping everything cannot pass.
      label: '16:9 crop -> YouTube (matching shape, untouched)',
      src: () => markerSrc,
      srcW: 1920,
      srcH: 1080,
      crop: [480, 270, 960, 540],
      preset: 'youtube',
      expectedMarker: (MARKER * 1920) / 960
    },
    {
      // Odd source dimensions: every crop in the chain has to land on an even
      // pixel or libx264 refuses the frame. 4:3 crop -> Reels again.
      label: '4:3 crop of an odd-sized source -> Reels',
      src: () => oddMarkerSrc,
      srcW: 1919,
      srcH: 1079,
      crop: [480, 180, 960, 720],
      preset: 'reels',
      expectedMarker: (MARKER * 1920) / 720
    }
  ]

  it.each(CASES)(
    '$label keeps the marker square, centered, and at the right scale',
    async ({ src, srcW, srcH, crop, preset, expectedMarker }) => {
      const clip = makeClip({
        startSec: 0,
        endSec: 2,
        cropRect: cropOf(crop[0], crop[1], crop[2], crop[3], srcW, srcH),
        selectedPresets: [preset]
      })
      const res = await runExportJob(
        makeJob(src(), preset, clip, `job-t83-${preset}-${crop[2]}x${crop[3]}-${srcW}`),
        () => {}
      )
      const target = PLATFORM_PRESETS[preset]
      const info = await ffprobeJson(res.outputPath)
      const v = info.streams.find((s) => s.codec_type === 'video')
      expect(v?.width).toBe(target.width)
      expect(v?.height).toBe(target.height)
      expect(v?.sample_aspect_ratio).toBe('1:1')

      const box = await markerBox(res.outputPath, target.width, target.height)
      const message = `marker came out ${box.w}x${box.h} (expected a ${Math.round(expectedMarker)}px square)`
      // The squareness is the point: a stretch scales the two axes differently.
      expect(box.w / box.h, message).toBeGreaterThan(0.97)
      expect(box.w / box.h, message).toBeLessThan(1.03)
      expect(box.w, message).toBeGreaterThan(expectedMarker * 0.97)
      expect(box.w, message).toBeLessThan(expectedMarker * 1.03)
      // A centered sub-crop of a crop centered on the marker keeps it central.
      expect(Math.abs(box.cx - target.width / 2), 'marker horizontal offset from centre').toBeLessThan(8)
      expect(Math.abs(box.cy - target.height / 2), 'marker vertical offset from centre').toBeLessThan(8)
    },
    120_000
  )
})

/**
 * T-96 — a clip cropped in the editor is cropped in the compilation and the GIF.
 *
 * Compile and GIF export took only a clip's start and end, so a clip the user
 * cropped to 9:16 for a vertical post came out at the full frame in both,
 * silently: the file opened, played and was the size it was asked to be. T-83
 * made the crop the frame an export starts from; these two runners now take the
 * crop through that same chain (`cropToFrame`, filters.ts).
 *
 * The fixture is a black 1920x1080 frame carrying a RED block that every crop
 * below excludes (x 100-300, y 100-300; the crops all start at x >= 480) and a
 * white SQUARE at the centre of every crop. "Honored" is therefore three
 * pixel facts, none of which reads a filter string: the red is gone (its
 * colour is not in the output at all), the white square is still SQUARE (a crop
 * that was stretched to fit would not be), and it has the hand-derived size
 * (the crop's full width, or the crop's shape, mapped onto the output). Each
 * case carries its control — the same source uncropped, where the red block IS
 * in the output — so a test that passes because the red was never visible
 * cannot.
 */
describe('a cropped clip compiled or GIF\'d keeps its crop (real ffmpeg, T-96)', () => {
  const MARKER = 160
  let src = '' // 1920x1080, 4 s: red block top-left, white MARKER square at the centre
  let fourThreeSrc = '' // 640x480, 3 s: white 120 px square at the centre

  const px = (pixels: number, of: number): number => (pixels + 0.25) / of
  const cropOf = (x: number, y: number, w: number, h: number, srcW = 1920, srcH = 1080) => ({
    x: px(x, srcW),
    y: px(y, srcH),
    w: px(w, srcW),
    h: px(h, srcH)
  })
  /** Pixels strongly red — R more than 60 levels above both G and B. */
  const redPixels = (file: string, timeSec: number): Promise<number> =>
    countTintedPixels(file, timeSec, 'null', 0)

  beforeAll(async () => {
    src = path.join(workDir, 't96-marker.mp4')
    await ff([
      '-y',
      '-f', 'lavfi',
      '-i',
      `color=c=black:s=1920x1080:r=30:d=4,drawbox=x=100:y=100:w=200:h=200:color=red:t=fill,drawbox=x=880:y=460:w=${MARKER}:h=${MARKER}:color=white:t=fill`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', src
    ])
    fourThreeSrc = path.join(workDir, 't96-four-three.mp4')
    await ff([
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=640x480:r=30:d=3,drawbox=x=260:y=180:w=120:h=120:color=white:t=fill',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', fourThreeSrc
    ])
  }, 60_000)

  // A crop centered on the marker, in source pixels, and what the marker
  // becomes in a 1280x720 compilation: the user's crop, cut to the
  // compilation's 16:9 (T-83's second stage), scaled to 1280 wide.
  const COMPILE_CASES: ReadonlyArray<{
    label: string
    crop: [number, number, number, number]
    /** Hand-derived: the cut's full width maps onto 1280 px. */
    expectedMarker: number
  }> = [
    // 4:3 crop -> cut to its widest 16:9 (960 x 540) -> 960 px onto 1280.
    { label: '4:3 crop', crop: [480, 180, 960, 720], expectedMarker: (MARKER * 1280) / 960 },
    // 9:16 crop -> cut to a 540 x 304 strip -> 540 px onto 1280.
    { label: '9:16 crop', crop: [690, 60, 540, 960], expectedMarker: (MARKER * 1280) / 540 },
    // The control for the chain's second stage: already 16:9, so it is only scaled.
    {
      label: '16:9 crop (the shape already matches)',
      crop: [480, 270, 960, 540],
      expectedMarker: (MARKER * 1280) / 960
    }
  ]

  it.each(COMPILE_CASES)(
    'compile: a $label segment leaves the red block out and stays square; the uncropped segment beside it keeps both',
    async ({ crop, expectedMarker }) => {
      const { outputPath } = await runConcat({
        jobId: `t96-compile-${crop[2]}x${crop[3]}`,
        sourcePath: src,
        outDir: workDir,
        segments: [
          { startSec: 0, endSec: 1.5, name: 'cropped', cropRect: cropOf(...crop) },
          { startSec: 2, endSec: 3.5, name: 'whole' }
        ],
        fadeMs: 0,
        width: 1280,
        height: 720
      })
      const info = await ffprobeJson(outputPath)
      const v = info.streams.find((s) => s.codec_type === 'video')
      expect([v?.width, v?.height]).toEqual([1280, 720])
      expect(v?.sample_aspect_ratio).toBe('1:1')

      // Segment 1 (output 0-1.5 s): cropped. The red is not in the frame at all.
      const croppedRed = await redPixels(outputPath, 0.5)
      expect(croppedRed, `the crop excludes the red block, but ${croppedRed} red pixels came out`).toBe(0)
      const box = await brightBox(outputPath, 0.5, 1280, 720)
      const message = `marker came out ${box.w}x${box.h} (expected a ${Math.round(expectedMarker)}px square)`
      expect(box.w / box.h, message).toBeGreaterThan(0.97)
      expect(box.w / box.h, message).toBeLessThan(1.03)
      expect(box.w, message).toBeGreaterThan(expectedMarker * 0.97)
      expect(box.w, message).toBeLessThan(expectedMarker * 1.03)
      expect(Math.abs(box.cx - 640), 'marker horizontal offset from centre').toBeLessThan(8)
      expect(Math.abs(box.cy - 360), 'marker vertical offset from centre').toBeLessThan(8)

      // Segment 2 (output 1.5-3 s): no crop, so the whole frame, red block
      // included — the control that makes the absence above mean something.
      const wholeRed = await redPixels(outputPath, 2.5)
      expect(wholeRed, 'the uncropped segment still has its red block').toBeGreaterThan(5000)
      const whole = await brightBox(outputPath, 2.5, 1280, 720)
      expect(whole.w / whole.h).toBeGreaterThan(0.97)
      expect(whole.w / whole.h).toBeLessThan(1.03)
      expect(whole.w).toBeGreaterThan(((MARKER * 1280) / 1920) * 0.97)
      expect(whole.w).toBeLessThan(((MARKER * 1280) / 1920) * 1.03)
    },
    120_000
  )

  it('compile: a segment that is not 16:9 and has no crop is cut to the compilation\'s shape, not stretched', async () => {
    // The same chain with the whole source as the frame (T-83's no-crop path):
    // 640x480 is cut to its widest 16:9 (640 x 360) and doubled. A plain
    // `scale=1280:720` — what this runner did — made the 120 px square
    // 240 wide by 180 tall.
    const { outputPath } = await runConcat({
      jobId: 't96-compile-uncropped-43',
      sourcePath: fourThreeSrc,
      outDir: workDir,
      segments: [{ startSec: 0, endSec: 2, name: 'whole' }],
      fadeMs: 0,
      width: 1280,
      height: 720
    })
    const box = await brightBox(outputPath, 0.5, 1280, 720)
    const message = `marker came out ${box.w}x${box.h} (expected a 240px square)`
    expect(box.w / box.h, message).toBeGreaterThan(0.97)
    expect(box.w / box.h, message).toBeLessThan(1.03)
    expect(box.w, message).toBeGreaterThan(240 * 0.97)
    expect(box.w, message).toBeLessThan(240 * 1.03)
  }, 120_000)

  // The GIF keeps the crop's own shape: there is no preset to cut it to, so the
  // chain stops after the user's crop and `scale=<width>:-1` sizes it.
  const GIF_CASES: ReadonlyArray<{
    label: string
    crop: [number, number, number, number]
    /** The crop's shape at the requested 320 px width. */
    size: [number, number]
  }> = [
    { label: '4:3 crop', crop: [480, 180, 960, 720], size: [320, 240] },
    { label: '9:16 crop', crop: [690, 60, 540, 960], size: [320, 569] }
  ]

  it.each(GIF_CASES)(
    'gif: a $label comes out in the crop\'s shape without the red block, and the uncropped GIF beside it keeps both',
    async ({ crop, size }) => {
      const cropped = await runGifExport({
        jobId: `t96-gif-${crop[2]}x${crop[3]}`,
        sourcePath: src,
        outDir: workDir,
        startSec: 0,
        endSec: 2,
        width: 320,
        fps: 10,
        speed: 1,
        cropRect: cropOf(...crop)
      })
      // The headline first: the red block the crop excludes is not in the GIF.
      const croppedRed = await redPixels(cropped.outputPath, 0.3)
      expect(croppedRed, `the crop excludes the red block, but ${croppedRed} red pixels came out`).toBe(0)
      const v = (await ffprobeJson(cropped.outputPath)).streams.find((s) => s.codec_type === 'video')
      expect(v?.codec_name).toBe('gif')
      expect(v?.width).toBe(size[0])
      expect(Math.abs((v?.height ?? 0) - size[1])).toBeLessThanOrEqual(1)
      // The marker is the crop's full width mapped onto 320 px: still square.
      const expected = (MARKER * 320) / crop[2]
      const box = await brightBox(cropped.outputPath, 0.3, size[0], v?.height ?? 0)
      const message = `marker came out ${box.w}x${box.h} (expected a ${Math.round(expected)}px square)`
      expect(box.w / box.h, message).toBeGreaterThan(0.94)
      expect(box.w / box.h, message).toBeLessThan(1.06)
      expect(box.w, message).toBeGreaterThan(expected * 0.94)
      expect(box.w, message).toBeLessThan(expected * 1.06)

      // The control: the same call with no crop is the whole frame.
      const whole = await runGifExport({
        jobId: `t96-gif-whole-${crop[2]}x${crop[3]}`,
        sourcePath: src,
        outDir: workDir,
        startSec: 0,
        endSec: 2,
        width: 320,
        fps: 10,
        speed: 1
      })
      const wv = (await ffprobeJson(whole.outputPath)).streams.find((s) => s.codec_type === 'video')
      expect([wv?.width, wv?.height]).toEqual([320, 180])
      expect(await redPixels(whole.outputPath, 0.3), 'the uncropped GIF still has its red block').toBeGreaterThan(300)
    },
    120_000
  )
})

/**
 * T-123 (13) - a crop that overshoots the frame by the validator's slack must still export.
 *
 * The editor stores a crop as `offsetWidth / pictureWidth`, and Chromium rounds a box to whole pixels: an 800 px box in a
 * 799.5 px parent reads 1.000625. `assertOptionalCropRect` accepts up to 1.01 so the editor's own crop is never refused,
 * and `manualCropRegion` used to scale and even-round that without a clamp: on a 3840x2160 source, `crop=3842:2160:0:0`,
 * and ffmpeg refused the whole export ("Invalid too big or non positive size") with no output. The platform export, the
 * compilation and the GIF share `cropToFrame`, so one case each runs the real runner. The marker is a white square at
 * the centre of a black frame: a crop that is the whole frame keeps it square and centred, whatever the clamp did.
 */
describe('a crop that overshoots the frame by the validator\'s slack still exports (real ffmpeg, T-123 (13))', () => {
  const MARKER = 400
  let uhd = '' // 3840x2160, 2 s: a white MARKER square at the centre of a black frame
  const MEASURED = 800 / 799.5 // Chromium's 800 px box in a 799.5 px parent

  beforeAll(async () => {
    uhd = path.join(workDir, 't123-uhd.mp4')
    await ff([
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=black:s=3840x2160:r=10:d=2,drawbox=x=${1920 - MARKER / 2}:y=${1080 - MARKER / 2}:w=${MARKER}:h=${MARKER}:color=white:t=fill`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', uhd
    ])
  }, 120_000)

  const WIDE = { x: 0, y: 0, w: MEASURED, h: 1 }
  // The height at 1.002: 4 px past a 2160 px frame (at 1.000625 the even() floor happens to land on 2160 for the height).
  const TALL = { x: 0, y: 0, w: 1, h: 1.002 }
  const CEILING = { x: 0, y: 0, w: 1.01, h: 1.01 }
  const OFFSET = { x: 0.5, y: 0, w: 0.505, h: 1 } // the right half, with the same slack past the edge

  it('the measured crop (w = 800/799.5) exports a 1080p file with the marker square and centred', async () => {
    const res = await runExportJob(
      makeJob(uhd, 'youtube', makeClip({ startSec: 0, endSec: 1, cropRect: WIDE }), 't123-crop-wide'),
      () => {}
    )
    const v = (await ffprobeJson(res.outputPath)).streams.find((s) => s.codec_type === 'video')
    expect([v?.width, v?.height]).toEqual([1920, 1080])
    const box = await brightBox(res.outputPath, 0.3, 1920, 1080)
    expect(Math.abs(box.w - MARKER / 2), `the marker came out ${box.w}x${box.h}`).toBeLessThan(8)
    expect(Math.abs(box.h - MARKER / 2)).toBeLessThan(8)
    expect(Math.abs(box.cx - 960)).toBeLessThan(8)
    expect(Math.abs(box.cy - 540)).toBeLessThan(8)
  }, 180_000)

  it.each([
    ['an overshoot on the height (1.002)', TALL],
    ['the validator\'s ceiling on both axes (1.01)', CEILING]
  ])('%s exports too', async (label, cropRect) => {
    const res = await runExportJob(
      makeJob(uhd, 'youtube', makeClip({ startSec: 0, endSec: 1, cropRect }), `t123-crop-${label.length}`),
      () => {}
    )
    const v = (await ffprobeJson(res.outputPath)).streams.find((s) => s.codec_type === 'video')
    expect([v?.width, v?.height]).toEqual([1920, 1080])
    const box = await brightBox(res.outputPath, 0.3, 1920, 1080)
    expect(Math.abs(box.cx - 960) + Math.abs(box.cy - 540)).toBeLessThan(12)
  }, 180_000)

  it('a crop whose offset plus width passes the edge keeps the half it names (the right half of the frame)', async () => {
    // The marker is centred on the frame, so the right half holds exactly its right half: 200 px wide and 400 tall, flush
    // left. The half is 1920x2160; the 16:9 cut takes its middle 1080 rows and scales 1920 px onto 1280 (x 2/3).
    const res = await runExportJob(
      makeJob(uhd, 'twitter', makeClip({ startSec: 0, endSec: 1, cropRect: OFFSET }), 't123-crop-offset'),
      () => {}
    )
    const v = (await ffprobeJson(res.outputPath)).streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1280)
    expect(res.outputPath).toMatch(/\.mp4$/)
    expect(v?.height).toBe(720)
    const box = await brightBox(res.outputPath, 0.3, 1280, 720)
    const message = `the marker's right half came out ${box.w}x${box.h} centred at ${box.cx}`
    expect(Math.abs(box.w - (200 * 2) / 3), message).toBeLessThan(8)
    expect(Math.abs(box.h - (400 * 2) / 3), message).toBeLessThan(8)
    expect(Math.abs(box.cx - (200 * 2) / 3 / 2), `${message}: flush against the left edge`).toBeLessThan(8)
  }, 180_000)

  it('Compile and GIF take the same crop (they share cropToFrame)', async () => {
    const { outputPath } = await runConcat({
      jobId: 't123-crop-compile',
      sourcePath: uhd,
      outDir: workDir,
      segments: [{ startSec: 0, endSec: 1, name: 'overshoot', cropRect: WIDE }],
      fadeMs: 0,
      width: 1280,
      height: 720
    })
    const cv = (await ffprobeJson(outputPath)).streams.find((s) => s.codec_type === 'video')
    expect([cv?.width, cv?.height]).toEqual([1280, 720])
    const gif = await runGifExport({
      jobId: 't123-crop-gif',
      sourcePath: uhd,
      outDir: workDir,
      startSec: 0,
      endSec: 1,
      width: 320,
      fps: 10,
      speed: 1,
      cropRect: WIDE
    })
    const gv = (await ffprobeJson(gif.outputPath)).streams.find((s) => s.codec_type === 'video')
    expect(gv?.codec_name).toBe('gif')
    expect([gv?.width, gv?.height]).toEqual([320, 180])
  }, 180_000)
})

/**
 * T-105 — a clip compiles as the clip the user built.
 *
 * Compile carried a clip's range and (since T-96) its crop, and nothing else:
 * a clip set to 2x compiled at 1x with its audio at 1x, and its color grade,
 * text overlays, Auto Zoom and Hype Shake were dropped without a word. A
 * compilation segment is now made by production's `buildVideoFilter` — the
 * builder a platform export uses — and its audio by `buildAudioSpeedFilter`,
 * so "what a clip's recipe is" has one implementation. Every assertion here is
 * on the decoded output, never on a filter string.
 *
 * What each case pins:
 *  - speed: the LENGTH of each stream (a video sped up with its audio left at
 *    1x is the original bug, and the concat demuxer would have joined them),
 *    the picture clock (the ramp fixture paints 12 x its own second), and where
 *    the 1.5 s audio burst sits — `atempo` keeps the pitch, so the burst's
 *    position IS the tempo. The 0.25x and 4x rows are the two that need TWO
 *    `atempo` stages (one stage covers 0.5-2.0).
 *  - grade: a dark gray half and a blue half in one frame, so one source shows
 *    brightness (every channel up), saturation (the blue's channels collapse
 *    together) and temperature on the shadows. Temperature on the MID-tones and
 *    highlights (T-109) has its own fixture: colorbalance's shadows band is gone
 *    by about 0x50, so a mid-gray frame did not move at all. The graded segments
 *    sit beside an ungraded control.
 *  - zoom and shake: the marker fixture's square grows with the pulse and is
 *    nudged off center by the shake; the control segment beside each is exactly
 *    where it was. Zoom also pins the clip's LENGTH — `zoompan` ignores its
 *    input's timestamps and counts frames at its own default 25 fps, so a 30 fps
 *    clip came out 20% long (and a 60 fps one 140% long) with the sound left at
 *    its own length; that has been wrong in platform exports since Auto Zoom
 *    shipped and would have put every compiled Auto Zoom clip out of step.
 *  - fades: a fade-out is placed on the SEGMENT'S length in the output, which at
 *    2x is half its source range.
 */
describe('a compiled clip is the clip the user built: speed, grade, zoom, shake and fades (real ffmpeg, T-105)', () => {
  let pairSrc = '' // 640x360 @ 30, 4 s: left half dark gray, right half blue; 440 Hz
  let markerSrc = '' // 640x360 @ 30, 4 s: black with one white 80 px square at the center
  let marker60Src = '' // the same at 60 fps, 2 s
  let offMarkerSrc = '' // 640x360 @ 30, 4 s: black with one white 80 px square up and to the left (T-109)
  let toneSrc = '' // 640x360 @ 30, 4 s: a mid-gray (0x80) half beside a light-gray (0xd0) half (T-109)

  beforeAll(async () => {
    toneSrc = path.join(workDir, 't109-tones.mp4')
    await ff([
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=0x808080:s=640x360:r=30:d=4,drawbox=x=320:y=0:w=320:h=360:color=0xd0d0d0:t=fill',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', toneSrc
    ])
    offMarkerSrc = path.join(workDir, 't109-marker-off-center.mp4')
    await ff([
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=640x360:r=30:d=4,drawbox=x=80:y=40:w=80:h=80:color=white:t=fill',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', offMarkerSrc
    ])
    pairSrc = path.join(workDir, 't105-pair.mp4')
    await ff([
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=0x303030:s=640x360:r=30:d=4,drawbox=x=320:y=0:w=320:h=360:color=0x4070c0:t=fill',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', pairSrc
    ])
    markerSrc = path.join(workDir, 't105-marker.mp4')
    await ff([
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=640x360:r=30:d=4,drawbox=x=280:y=140:w=80:h=80:color=white:t=fill',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', markerSrc
    ])
    marker60Src = path.join(workDir, 't105-marker-60.mp4')
    await ff([
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=640x360:r=60:d=2,drawbox=x=280:y=140:w=80:h=80:color=white:t=fill',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', marker60Src
    ])
  }, 120_000)

  const compile = (
    jobId: string,
    sourcePath: string,
    segments: ConcatJobSpec['segments'],
    options: { fadeMs?: number; width?: number; height?: number } = {}
  ): Promise<{ outputPath: string }> =>
    runConcat({
      jobId,
      sourcePath,
      outDir: workDir,
      segments,
      fadeMs: options.fadeMs ?? 0,
      width: options.width ?? 1280,
      height: options.height ?? 720
    })

  /** The container's length and each stream's own, in seconds. */
  async function lengths(file: string): Promise<{ total: number; video: number; audio: number }> {
    const info = await ffprobeJson(file)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    return {
      total: Number(info.format.duration),
      video: Number(v?.duration),
      audio: Number(a?.duration)
    }
  }

  const near = (actual: number, expected: number, tolerance: number, what: string): void => {
    expect(Math.abs(actual - expected), `${what}: ${actual} s, expected ${expected} s`).toBeLessThanOrEqual(
      tolerance
    )
  }

  // [source range] at [speed] -> where the picture and the burst (source 10.0-11.5 s,
  // everything else a -34 dB bed) land in the OUTPUT, worked out by hand.
  const SPEED_CASES: ReadonlyArray<{
    label: string
    speed: number
    range: [number, number]
    outSec: number
    /** A window wholly inside the burst, and windows wholly outside it. */
    loud: [number, number]
    quiet: Array<[number, number]>
    /** [output second, the ramp's luma there = 12 x the source second it came from] */
    luma: Array<[number, number]>
  }> = [
    { label: '2x', speed: 2, range: [8, 14], outSec: 3, loud: [1.1, 1.65], quiet: [[0.1, 0.8], [2.0, 2.9]], luma: [[0.5, 108], [2.8, 163]] },
    { label: '4x (two atempo stages)', speed: 4, range: [4, 12], outSec: 2, loud: [1.55, 1.85], quiet: [[0.1, 1.3]], luma: [[0.5, 72], [1.8, 134]] },
    { label: '0.5x', speed: 0.5, range: [9, 11], outSec: 4, loud: [2.2, 3.8], quiet: [[0.1, 1.8]], luma: [[0.4, 110], [3.6, 128]] },
    { label: '0.25x (two atempo stages)', speed: 0.25, range: [9.5, 10.5], outSec: 4, loud: [2.2, 3.8], quiet: [[0.1, 1.8]], luma: [] }
  ]

  it.each(SPEED_CASES)(
    'a clip at $label is that long, plays its picture and its sound at that speed, and the join still lines up',
    async ({ label, speed, range, outSec, loud, quiet, luma }) => {
      // The clip beside it is a plain 1 s excerpt (source 2-3 s): the total is
      // the sum of what each clip makes, and a segment of the wrong length
      // shifts it.
      const { outputPath } = await compile(`t105-speed-${speed}`, rampSrc, [
        { startSec: range[0], endSec: range[1], name: 'sped', speedMultiplier: speed },
        { startSec: 2, endSec: 3, name: 'control' }
      ])
      const len = await lengths(outputPath)
      near(len.total, outSec + 1, 0.3, `${label}: the compilation`)
      near(len.video, outSec + 1, 0.3, `${label}: the picture`)
      near(len.audio, outSec + 1, 0.3, `${label}: the sound`)

      // ramp.mp4's burst measures about -21 dB (the `sine` source is 1/8 amplitude) and
      // its bed 34 dB under that: anything between -30 and -45 separates them.
      const burst = await bandMeanVolume(outputPath, loud[0], loud[1] - loud[0], 440)
      expect(burst, `${label}: the burst is at ${loud[0]}-${loud[1]} s of the output (${burst} dB)`).toBeGreaterThan(-30)
      for (const [from, to] of quiet) {
        const bed = await bandMeanVolume(outputPath, from, to - from, 440)
        expect(bed, `${label}: only the quiet bed at ${from}-${to} s (${bed} dB)`).toBeLessThan(-40)
      }
      for (const [t, expected] of luma) {
        const got = await meanLuma(outputPath, t)
        expect(Math.abs(got - expected), `${label}: the picture at ${t} s is source frame ${expected / 12} s (luma ${got}, expected ${expected})`).toBeLessThan(14)
      }
    },
    120_000
  )

  it('a sped-up clip of a source with no sound still compiles, at its speed', async () => {
    const { outputPath } = await compile('t105-speed-silent', noAudioSrc, [
      { startSec: 0, endSec: 3, name: 'fast', speedMultiplier: 2 },
      { startSec: 1, endSec: 2, name: 'control' }
    ])
    const info = await ffprobeJson(outputPath)
    expect(info.streams.filter((s) => s.codec_type === 'audio')).toHaveLength(0)
    near(Number(info.format.duration), 2.5, 0.3, 'the compilation (1.5 s at 2x, then 1 s)')
  }, 120_000)

  it('a graded clip is graded in the compilation, and the clips beside it are not', async () => {
    const grade = (patch: Partial<{ brightness: number; saturation: number; temperature: number }>) => ({
      brightness: 0,
      contrast: 1,
      saturation: 1,
      temperature: 0,
      ...patch
    })
    const { outputPath } = await compile('t105-grade', pairSrc, [
      { startSec: 0, endSec: 1, name: 'control' },
      { startSec: 0, endSec: 1, name: 'bright', colorGrade: grade({ brightness: 0.3 }) },
      { startSec: 0, endSec: 1, name: 'desaturated', colorGrade: grade({ saturation: 0 }) },
      { startSec: 0, endSec: 1, name: 'warm', colorGrade: grade({ temperature: 1 }) }
    ])
    const GRAY: [number, number] = [200, 300] // the dark half, at 2x the source's coordinates
    const BLUE: [number, number] = [1000, 300]
    const rgb = (t: number, at: [number, number]) => meanRgb(outputPath, t, at[0], at[1])
    const spread = (c: readonly [number, number, number]): number => Math.max(...c) - Math.min(...c)

    const grayControl = await rgb(0.5, GRAY)
    const blueControl = await rgb(0.5, BLUE)
    // The fixture and the pipeline are what they say: an untouched segment is the source.
    expect(grayControl[0], `control gray ${grayControl}`).toBeGreaterThan(38)
    expect(grayControl[0], `control gray ${grayControl}`).toBeLessThan(56)
    expect(spread(grayControl), 'the dark half is neutral').toBeLessThan(6)
    expect(spread(blueControl), `the blue half is saturated (${blueControl})`).toBeGreaterThan(100)

    // Brightness: every channel of both halves rises.
    const grayBright = await rgb(1.5, GRAY)
    const blueBright = await rgb(1.5, BLUE)
    for (let c = 0; c < 3; c++) {
      expect(grayBright[c] ?? 0, `bright gray ${grayBright} vs ${grayControl}`).toBeGreaterThan((grayControl[c] ?? 0) + 40)
      expect(blueBright[c] ?? 0, `bright blue ${blueBright} vs ${blueControl}`).toBeGreaterThan((blueControl[c] ?? 0) + 40)
    }

    // Saturation 0: the blue's three channels collapse together.
    const blueDesat = await rgb(2.5, BLUE)
    expect(spread(blueDesat), `desaturated blue ${blueDesat} (control spread ${spread(blueControl)})`).toBeLessThan(15)

    // Temperature on the shadows: warm moves them toward red and away from blue. (The mid-tones
    // and highlights have their own test below, T-109.)
    const grayWarm = await rgb(3.5, GRAY)
    const control = (grayControl[0] ?? 0) - (grayControl[2] ?? 0)
    expect((grayWarm[0] ?? 0) - (grayWarm[2] ?? 0), `warm gray ${grayWarm} vs ${grayControl}`).toBeGreaterThan(control + 30)
  }, 180_000)

  // T-109: the Temperature slider promised a warmer or cooler picture and moved only the
  // SHADOWS — `colorbalance`'s shadows band is gone by about 0x50, so a mid-gray frame came
  // out within ~2 levels of itself at the slider's end (round 59 measured it). The test frame
  // is the case the slider is for: a mid-gray half and a light-gray half, no shadows in sight.
  // Warm must raise red and lower blue on both, cool the reverse, and neither may be a
  // different brightness (the cast is in the color, not the picture's lightness).
  it('Temperature warms and cools the mid-tones and highlights, not only the shadows', async () => {
    const grade = (temperature: number) => ({ brightness: 0, contrast: 1, saturation: 1, temperature })
    const { outputPath } = await compile('t109-temperature', toneSrc, [
      { startSec: 0, endSec: 1, name: 'control' },
      { startSec: 0, endSec: 1, name: 'warm', colorGrade: grade(1) },
      { startSec: 0, endSec: 1, name: 'cool', colorGrade: grade(-1) },
      { startSec: 0, endSec: 1, name: 'slightly-warm', colorGrade: grade(0.3) }
    ])
    const MID: [number, number] = [200, 300] // the 0x80 half, at 2x the source's coordinates
    const LIGHT: [number, number] = [1000, 300] // the 0xd0 half
    const at = (t: number, where: [number, number]) => meanRgb(outputPath, t, where[0], where[1])

    for (const [label, where, level] of [
      ['mid-tone', MID, 128],
      ['highlight', LIGHT, 208]
    ] as const) {
      const control = await at(0.5, where)
      expect(control[0], `the ${label} control is the source's ${level} (${control})`).toBeGreaterThan(level - 8)
      expect(control[0], `the ${label} control (${control})`).toBeLessThan(level + 8)
      expect(Math.abs(control[0] - control[2]), `the ${label} control is neutral (${control})`).toBeLessThan(6)

      const warm = await at(1.5, where)
      expect(warm[0], `warm ${label} ${warm} vs ${control}: red rises`).toBeGreaterThan(control[0] + 15)
      expect(warm[2], `warm ${label} ${warm} vs ${control}: blue falls`).toBeLessThan(control[2] - 10)
      expect(warm[0] - warm[2], `warm ${label} ${warm}: red over blue`).toBeGreaterThan(30)

      const cool = await at(2.5, where)
      expect(cool[2], `cool ${label} ${cool} vs ${control}: blue rises`).toBeGreaterThan(control[2] + 15)
      expect(cool[0], `cool ${label} ${cool} vs ${control}: red falls`).toBeLessThan(control[0] - 10)
      expect(cool[2] - cool[0], `cool ${label} ${cool}: blue over red`).toBeGreaterThan(30)

      // A small slider move is a small cast: it is between the control and the end of the slider.
      const slight = await at(3.5, where)
      expect(slight[0] - slight[2], `slightly warm ${label} ${slight}`).toBeGreaterThan(5)
      expect(slight[0] - slight[2], `slightly warm ${label} ${slight} vs warm ${warm}`).toBeLessThan(
        warm[0] - warm[2]
      )
    }
  }, 180_000)

  it('Auto Zoom pulses on the clip clock and does not stretch the clip', async () => {
    const { outputPath } = await compile('t105-zoom', markerSrc, [
      { startSec: 0, endSec: 2, name: 'zoom', autoZoom: true },
      { startSec: 0, endSec: 2, name: 'control' }
    ])
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect([v?.width, v?.height]).toEqual([1280, 720])
    // The length first: zoompan at its default 25 fps made the zoomed half 2.4 s.
    const len = await lengths(outputPath)
    near(len.total, 4, 0.2, 'the compilation')
    near(len.video, 4, 0.2, 'the picture')
    near(len.audio, 4, 0.2, 'the sound')

    // The marker is 80 px in the source, 160 px in the 1280x720 output.
    const control = await brightBox(outputPath, 3.4, 1280, 720)
    near(control.w, 160, 4, 'the control segment\'s marker')
    // The pulse starts at 1.0x on the clip's first frame...
    const first = await brightBox(outputPath, 0, 1280, 720)
    near(first.w / control.w, 1, 0.02, 'the zoom at the clip\'s first frame, against the control')
    // ...and by 1.4 s into the clip it is 1 + 0.05 x |sin(0.6 x 1.4)| = 1.037x.
    const zoomed = await brightBox(outputPath, 1.4, 1280, 720)
    expect(
      zoomed.w / control.w,
      `the marker is ${zoomed.w}px beside the control's ${control.w}px at 1.4 s`
    ).toBeGreaterThan(1.02)
    expect(zoomed.w / control.w).toBeLessThan(1.06)
  }, 180_000)

  // T-109: zoompan's x and y default to 0, so the zoom grew the picture out of its TOP-LEFT
  // corner. At 1.4 s (1.037x) a marker dead in the center of a 1280x720 frame had walked
  // ~24 px right and ~13 px down, and a marker anywhere else walked by its distance from
  // the corner instead of from the middle. The expected position is derived from the
  // geometry — the marker's own measured growth, about the frame's center — and not from
  // the filter's expression.
  it('Auto Zoom zooms about the CENTRE of the frame: a centred marker stays centred, an off-centre one moves away from the middle by exactly the zoom', async () => {
    const { outputPath } = await compile('t109-zoom-center', markerSrc, [
      { startSec: 0, endSec: 2, name: 'zoom', autoZoom: true },
      { startSec: 0, endSec: 2, name: 'control' }
    ])
    const control = await brightBox(outputPath, 3.4, 1280, 720)
    near(control.cx, 640, 1.5, 'the control marker\'s center x')
    near(control.cy, 360, 1.5, 'the control marker\'s center y')
    const first = await brightBox(outputPath, 0, 1280, 720)
    near(first.cx, 640, 1.5, 'the zoom\'s first frame, center x')
    const zoomed = await brightBox(outputPath, 1.4, 1280, 720)
    const zoom = zoomed.w / control.w
    expect(zoom, `the marker grew (${zoomed.w}px against ${control.w}px)`).toBeGreaterThan(1.02)
    expect(
      Math.abs(zoomed.cx - 640),
      `the zoomed marker is at (${zoomed.cx}, ${zoomed.cy}); a zoom about the centre leaves it at (640, 360)`
    ).toBeLessThan(2.5)
    expect(Math.abs(zoomed.cy - 360), `the zoomed marker's center y is ${zoomed.cy}`).toBeLessThan(2.5)

    // A marker up and to the left of the middle moves FURTHER from the middle by the zoom factor.
    const off = await compile('t109-zoom-off', offMarkerSrc, [
      { startSec: 0, endSec: 2, name: 'zoom', autoZoom: true },
      { startSec: 0, endSec: 2, name: 'control' }
    ])
    const offControl = await brightBox(off.outputPath, 3.4, 1280, 720)
    const offZoomed = await brightBox(off.outputPath, 1.4, 1280, 720)
    const r = offZoomed.w / offControl.w
    near(r, zoom, 0.01, 'the same clock, the same zoom')
    const expectedX = 640 - (640 - offControl.cx) * r
    const expectedY = 360 - (360 - offControl.cy) * r
    expect(
      Math.abs(offZoomed.cx - expectedX),
      `the off-center marker is at (${offZoomed.cx}, ${offZoomed.cy}); about the center it is (${expectedX.toFixed(1)}, ${expectedY.toFixed(1)})`
    ).toBeLessThan(2.5)
    expect(Math.abs(offZoomed.cy - expectedY), `the off-center marker's center y is ${offZoomed.cy}`).toBeLessThan(2.5)
  }, 180_000)

  it('Auto Zoom zooms about the center in a platform export too (the same builder)', async () => {
    const zoomed = await runExportJob(
      {
        ...makeJob(markerSrc, 'youtube', makeClip({ startSec: 0, endSec: 2, autoZoom: true }), 't109-export-zoom'),
        outputFilename: 't109-export-zoom.mp4'
      },
      () => {}
    )
    const preset = PLATFORM_PRESETS.youtube
    const box = await brightBox(zoomed.outputPath, 1.4, preset.width, preset.height)
    const first = await brightBox(zoomed.outputPath, 0, preset.width, preset.height)
    expect(box.w / first.w, `the marker grew by 1.4 s (${first.w}px to ${box.w}px)`).toBeGreaterThan(1.02)
    expect(
      Math.abs(box.cx - preset.width / 2),
      `the zoomed marker's center x is ${box.cx} in a ${preset.width}-wide frame`
    ).toBeLessThan(2.5)
    expect(Math.abs(box.cy - preset.height / 2), `center y is ${box.cy}`).toBeLessThan(2.5)
  }, 180_000)

  it('Auto Zoom keeps a clip\'s length whatever the source frame rate — a platform export and a compilation', async () => {
    // 30 fps: zoompan's default 25 fps made a 2 s clip 2.4 s. 60 fps: 4.8 s.
    for (const [label, src] of [['30 fps', markerSrc], ['60 fps', marker60Src]] as const) {
      const exported = await runExportJob(
        makeJob(src, 'youtube', makeClip({ startSec: 0, endSec: 2, autoZoom: true }), `t105-zoom-export-${label}`),
        () => {}
      )
      const e = await lengths(exported.outputPath)
      near(e.video, 2, 0.15, `${label} export: the picture`)
      near(e.audio, 2, 0.15, `${label} export: the sound`)

      const { outputPath } = await compile(`t105-zoom-compile-${label}`, src, [
        { startSec: 0, endSec: 2, name: 'zoom', autoZoom: true }
      ])
      const c = await lengths(outputPath)
      near(c.video, 2, 0.15, `${label} compilation: the picture`)
      near(c.audio, 2, 0.15, `${label} compilation: the sound`)
    }
  }, 240_000)

  it('Hype Shake is in the compilation: the first frame is off center, the clip beside it is not', async () => {
    const { outputPath } = await compile('t105-shake', markerSrc, [
      { startSec: 0, endSec: 2, name: 'shake', hypeShake: true },
      { startSec: 0, endSec: 2, name: 'control' }
    ])
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect([v?.width, v?.height]).toEqual([1280, 720])
    near((await lengths(outputPath)).total, 4, 0.2, 'the compilation')

    // The control segment's marker is dead center: (640, 360).
    const control = await brightBox(outputPath, 2.05, 1280, 720)
    near(control.cx, 640, 1.5, 'the control marker\'s center x')
    near(control.cy, 360, 1.5, 'the control marker\'s center y')
    // At t = 0 the shake crops at (3, 3 + 3cos 0) = (3, 6) of a 634x354 window,
    // which puts the marker about 6 px above center once it is scaled back up.
    const shaken = await brightBox(outputPath, 0, 1280, 720)
    expect(
      Math.abs(shaken.cy - 360),
      `the shaken marker is at (${shaken.cx}, ${shaken.cy}); the control's is dead centre`
    ).toBeGreaterThan(3)
  }, 180_000)

  it('a fade is placed on the clip\'s length in the output, picture and sound, not on its source range', async () => {
    // 4 source seconds at 2x are 2 output seconds, so the fade-out must start at
    // 1.6 s. Computed from the 4 s range it would start at 3.6 s, past the end.
    const { outputPath } = await compile(
      't105-fade',
      flatGraySrc,
      [
        { startSec: 2, endSec: 6, name: 'fast', speedMultiplier: 2 },
        { startSec: 2, endSec: 4, name: 'control' }
      ],
      { fadeMs: 400 }
    )
    near((await lengths(outputPath)).total, 4, 0.3, 'the compilation')
    const mid = await meanLuma(outputPath, 1.0)
    const fading = await meanLuma(outputPath, 1.9)
    expect(mid, `mid-clip is the source's gray (${mid})`).toBeGreaterThan(100)
    expect(fading, `the picture is mostly faded out 0.1 s before the clip ends (${fading})`).toBeLessThan(70)
    const loudBefore = await bandMeanVolume(outputPath, 0.5, 0.5, 440)
    const loudAtEnd = await bandMeanVolume(outputPath, 1.85, 0.13, 440)
    expect(loudAtEnd, `the sound fades out too (${loudAtEnd} dB against ${loudBefore} dB)`).toBeLessThan(loudBefore - 8)
  }, 180_000)

  it('the whole recipe at once — crop, speed, grade, zoom and shake — compiles into one valid file', async () => {
    // A 4:3 crop centered on the marker (480x360 at x=80), cut to 16:9, 2x,
    // graded, zoomed and shaken: every stage in one graph, accepted by ffmpeg,
    // the right shape, the right length, the marker still in the frame.
    const { outputPath } = await compile('t105-everything', markerSrc, [
      {
        startSec: 0,
        endSec: 4,
        name: 'everything',
        cropRect: { x: 80.25 / 640, y: 0, w: 480.25 / 640, h: 1 },
        speedMultiplier: 2,
        colorGrade: { brightness: 0.1, contrast: 1.2, saturation: 0.8, temperature: 0.5 },
        autoZoom: true,
        hypeShake: true
      }
    ])
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect([v?.width, v?.height]).toEqual([1280, 720])
    expect(v?.sample_aspect_ratio).toBe('1:1')
    const len = await lengths(outputPath)
    near(len.video, 2, 0.2, 'the picture (4 s at 2x)')
    near(len.audio, 2, 0.2, 'the sound (4 s at 2x)')
    const box = await brightBox(outputPath, 0.5, 1280, 720)
    expect(box.w, `the marker is in the frame (${box.w}x${box.h})`).toBeGreaterThan(150)
  }, 180_000)
})

/**
 * T-118 (6) - the temperature grade and a source tagged bt709.
 *
 * `colorbalance` is an RGB filter, so the frame goes YUV -> RGB -> YUV around it. On the shipped win32 ffmpeg
 * (6.1.1) the way back used the bt601 matrix and tagged the frame color_space=unknown, so a bt709-tagged source
 * (OBS's default) was ENCODED in the wrong matrix while every player decodes the file as bt709: a no-op grade
 * turned SMPTE green (0,157,0) into (0,130,0) and stripped the tag. The bundled linux 7.0.2 preserves both, so
 * THIS SUITE PASSES ON 7.0.2 WITH OR WITHOUT THE FIX: it is only red on a 6.1.1 binary (run the file against the
 * distro's ffmpeg through a scratch config that aliases ffmpeg-static, as TESTING.md describes), and the release
 * run on the real win32 binary is the standing check. The unit pins (`filters.test.ts`, `gradeMatrix.test.ts`)
 * are what fail on any machine if the stage or its wiring goes.
 *
 * T-119 (4) added the bt601-TAGGED half (smpte170m, bt470bg: OBS's Rec.601 profile, SD captures) to this block.
 * Same disclosure: GREEN ON 7.0.2 BY DESIGN, with the stage or without it (7.0.2 keeps the tag), red only on
 * 6.1.1 before the fix (the tag comes back `unknown`; the pixels were never wrong, which is why the stage there
 * is the tag alone). Its fixture is the same four bands keyed to the 601 matrix and tagged.
 *
 * Every other grade fixture here is an untagged lavfi gray, which is matrix-blind (a neutral gray is the same
 * in every matrix), so none of them could see it. This one is four SATURATED bands, converted into bt709 and
 * tagged, and it is measured the way a player sees it: `scale=in_color_matrix=bt709,format=rgb24`, against the
 * same job without a grade. A grade whose cast is negligible (temperature 0.01) isolates the matrix error from
 * the warmth it is there to add.
 */
describe('the temperature grade keeps a bt709-tagged source in bt709 (real ffmpeg, T-118)', () => {
  // Four vertical bands of a 640x360 frame: SMPTE-ish green, red, blue, and a mid-gray. [x, y] are the
  // band centers in the 640x360 source; `rgb` is the color each was drawn as.
  const BANDS = [
    { label: 'green', rgb: [0, 159, 0], hex: '0x009F00' },
    { label: 'red', rgb: [206, 46, 47], hex: '0xCE2E2F' },
    { label: 'blue', rgb: [45, 60, 200], hex: '0x2D3CC8' },
    { label: 'gray', rgb: [128, 128, 128], hex: '0x808080' }
  ] as const
  const paint = (): string =>
    `color=c=${BANDS[0].hex}:s=640x360:d=2:r=5,` +
    BANDS.slice(1)
      .map((b, i) => `drawbox=x=${(i + 1) * 160}:y=0:w=160:h=360:color=${b.hex}:t=fill`)
      .join(',')

  let taggedSrc = '' // converted into bt709 and tagged bt709/bt709/bt709
  let untaggedSrc = '' // the same bands as an ordinary untagged (bt601) encode
  // T-119 (4): the same bands converted with the 601 matrix and TAGGED as bt601, once per tag a 601 source carries.
  const BT601_TAGS = [
    { tag: 'smpte170m', primaries: 'smpte170m', trc: 'smpte170m' },
    { tag: 'bt470bg', primaries: 'bt470bg', trc: 'gamma28' }
  ] as const
  const tagged601Src: Record<string, string> = {}

  beforeAll(async () => {
    taggedSrc = path.join(workDir, 't118-bt709-bands.mp4')
    await ff([
      '-y',
      '-f', 'lavfi', '-i', `${paint()},format=yuv420p,scale=out_color_matrix=bt709`,
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv420p',
      taggedSrc
    ])
    untaggedSrc = path.join(workDir, 't118-untagged-bands.mp4')
    await ff([
      '-y',
      '-f', 'lavfi', '-i', `${paint()},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv420p',
      untaggedSrc
    ])
    for (const { tag, primaries, trc } of BT601_TAGS) {
      const file = path.join(workDir, `t119-${tag}-bands.mp4`)
      await ff([
        '-y',
        '-f', 'lavfi', '-i', `${paint()},format=yuv420p,scale=out_color_matrix=bt601`,
        '-colorspace', tag, '-color_primaries', primaries, '-color_trc', trc,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv420p',
        file
      ])
      tagged601Src[tag] = file
    }
  }, 120_000)

  /** Mean R/G/B of the 2x2 patch at (x, y) as a player decodes it: `matrix` says which matrix to trust. */
  async function playerRgb(
    file: string,
    x: number,
    y: number,
    matrix: 'bt709' | 'bt601'
  ): Promise<[number, number, number]> {
    const raw = path.join(workDir, `sample-${pixelSampleSeq++}.raw`)
    await ff([
      '-y', '-i', file,
      '-vf', `crop=2:2:${x}:${y},scale=in_color_matrix=${matrix},format=rgb24`,
      '-frames:v', '1', '-f', 'rawvideo', raw
    ])
    const buf = await readFile(raw)
    const acc = [0, 0, 0]
    for (let i = 0; i < buf.length; i += 3) {
      acc[0] += buf[i] ?? 0
      acc[1] += buf[i + 1] ?? 0
      acc[2] += buf[i + 2] ?? 0
    }
    const n = buf.length / 3
    return [acc[0] / n, acc[1] / n, acc[2] / n]
  }

  const colorSpaceOf = async (file: string): Promise<string | undefined> =>
    (await ffprobeJson(file)).streams.find((v) => v.codec_type === 'video')?.color_space

  /** The band centers in a `width`x`height` output. */
  const centers = (width: number, height: number): Array<[number, number]> =>
    BANDS.map((_b, i) => [Math.round(((i + 0.5) * width) / 4 / 2) * 2, Math.round(height / 4) * 2])

  const grade = (temperature: number) => ({ brightness: 0, contrast: 1, saturation: 1, temperature })

  // `extra`: more of the clip's recipe (T-120: Auto Zoom, the stage after the grade that the matrix stage has to survive).
  const exportClip = async (
    src: string,
    id: string,
    colorGrade?: ReturnType<typeof grade>,
    extra: Partial<Clip> = {}
  ): Promise<string> =>
    (
      await runExportJob(
        makeJob(src, 'youtube', makeClip({ startSec: 0, endSec: 1, colorGrade, ...extra }), id),
        () => {}
      )
    ).outputPath
  const compileClip = async (
    src: string,
    id: string,
    colorGrade?: ReturnType<typeof grade>,
    extra: Partial<Clip> = {}
  ): Promise<string> =>
    (
      await runConcat({
        jobId: id,
        sourcePath: src,
        outDir: workDir,
        segments: [{ startSec: 0, endSec: 1, name: 'a', colorGrade, ...extra }],
        fadeMs: 0,
        width: 1280,
        height: 720
      })
    ).outputPath

  const maxDelta = (a: readonly number[], b: readonly number[]): number =>
    Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? 0))))

  it('the fixture is what it says: tagged bt709, and its bands decode to the colors they were drawn as', async () => {
    expect(await colorSpaceOf(taggedSrc)).toBe('bt709')
    expect(await colorSpaceOf(untaggedSrc)).toBeUndefined()
    // The production probe reads the tag off the real file (the bundled ffprobe), which is the only way
    // the stage ever finds out.
    expect((await probeVideo(taggedSrc)).colorSpace).toBe('bt709')
    expect((await probeVideo(untaggedSrc)).colorSpace).toBeUndefined()
    const at = centers(640, 360)
    for (const [i, band] of BANDS.entries()) {
      const [x, y] = at[i] as [number, number]
      const got = await playerRgb(taggedSrc, x, y, 'bt709')
      expect(maxDelta(got, band.rgb), `${band.label} band ${got} vs drawn ${band.rgb}`).toBeLessThanOrEqual(8)
    }
  }, 120_000)

  it.each([
    ['a platform export (and so Clip Kit)', exportClip, 1920, 1080],
    ['a compilation segment', compileClip, 1280, 720]
  ] as const)(
    '%s of a bt709 source with a grade on: the graph runs, the file stays bt709, and every band decodes as the control does',
    async (_label, run, width, height) => {
      const tag = `${width}`
      const control = await run(taggedSrc, `t118-control-${tag}`)
      const graded = await run(taggedSrc, `t118-graded-${tag}`, grade(0.01))
      expect(await colorSpaceOf(control), 'the ungraded control keeps the tag').toBe('bt709')
      // Soft, so one red run reports the tag AND the pixels (the 6.1.1 evidence wants both).
      expect.soft(await colorSpaceOf(graded), 'the graded output is still tagged bt709').toBe('bt709')
      for (const [i, band] of BANDS.entries()) {
        const [x, y] = centers(width, height)[i] as [number, number]
        const want = await playerRgb(control, x, y, 'bt709')
        const got = await playerRgb(graded, x, y, 'bt709')
        // The control decodes to the drawn color (so the delta below is measured from the right place)...
        expect(maxDelta(want, band.rgb), `${band.label} control ${want} vs drawn ${band.rgb}`).toBeLessThanOrEqual(10)
        // ...and the near-zero grade leaves it where it was. Unfixed on 6.1.1: green (0,157,0) -> (0,130,0).
        expect(maxDelta(got, want), `${band.label} graded ${got} vs control ${want}`).toBeLessThanOrEqual(4)
      }
    },
    180_000
  )

  it('the stage does not undo the grade: a full warm grade still warms a bt709 source', async () => {
    const [x, y] = centers(1920, 1080)[3] as [number, number] // the mid-gray band
    const control = await playerRgb(await exportClip(taggedSrc, 't118-gray-control'), x, y, 'bt709')
    const warm = await exportClip(taggedSrc, 't118-gray-warm', grade(1))
    expect.soft(await colorSpaceOf(warm), 'the warm output is still tagged bt709').toBe('bt709')
    const got = await playerRgb(warm, x, y, 'bt709')
    expect(got[0] - got[2], `warm gray ${got} vs control ${control}: red over blue`).toBeGreaterThan(30)
    expect(got[0], `warm gray ${got} vs control ${control}: red rises`).toBeGreaterThan(control[0] + 15)
    expect(got[2], `warm gray ${got} vs control ${control}: blue falls`).toBeLessThan(control[2] - 10)
  }, 120_000)

  // ---- T-120 (15): the bt709 `scale`'s real job. Retag-only restores the pixels AND the tag of a graded bt709
  // source on its own, so on a plain grade the scale is not what holds the picture (this block's cases above
  // pass with it dropped, on 6.1.1 too). What it is FOR is a following Auto Zoom: `zoompan` drops the frame's
  // tags, so a frame still in RGB when it gets there is converted to YUV afterwards by whatever matrix an
  // untagged frame gets (bt601), while `scale=out_color_matrix=bt709` has already turned it into bt709 YUV, which
  // zoompan passes through. Measured on 6.1.1 (green band, control (0,157,0)): retag only + Auto Zoom
  // (0,133,0); scale + retag + Auto Zoom (0,155,0). 7.0.2 keeps the matrix through `colorbalance`, so this case
  // is green there with or without the scale, by design (the header's rule for this block); the red is 6.1.1's. ----
  it.each([
    ['a platform export (and so Clip Kit)', exportClip, 1920, 1080],
    ['a compilation segment', compileClip, 1280, 720]
  ] as const)(
    'a bt709 source, %s with a grade AND Auto Zoom on: every band decodes under bt709 as the Auto Zoom control does (T-120)',
    async (_label, run, width, height) => {
      const id = `t120-zoom-${width}`
      const control = await run(taggedSrc, `${id}-control`, undefined, { autoZoom: true })
      const graded = await run(taggedSrc, `${id}-graded`, grade(0.01), { autoZoom: true })
      for (const [i, band] of BANDS.entries()) {
        const [x, y] = centers(width, height)[i] as [number, number]
        const want = await playerRgb(control, x, y, 'bt709')
        const got = await playerRgb(graded, x, y, 'bt709')
        // The control decodes to the drawn color (the first frame has no zoom yet), so the delta is measured from
        // the right place...
        expect(maxDelta(want, band.rgb), `${band.label} control ${want} vs drawn ${band.rgb}`).toBeLessThanOrEqual(10)
        // ...and the near-zero grade, then Auto Zoom, leaves it there. Without the scale on 6.1.1: green
        // (0,133,0) against (0,157,0).
        expect(maxDelta(got, want), `${band.label} graded ${got} vs control ${want}`).toBeLessThanOrEqual(4)
      }
    },
    180_000
  )

  it('an UNTAGGED source needs no matrix stage: its grade is also within a few levels of its control', async () => {
    // The claim the stage's skip rests on: ffmpeg's round trip for an untagged frame is SYMMETRIC (swscale reads
    // it as bt601 and writes bt601 back), so the picture comes out as it went in and there is no tag to lose.
    // Measured with a bt601 decode, the matrix the round trip itself used. (NOT "players assume bt601": at HD a
    // tag-guessing player reads an untagged file as bt709, for the input and the output alike.) Both majors.
    const control = await exportClip(untaggedSrc, 't118-untagged-control')
    const graded = await exportClip(untaggedSrc, 't118-untagged-graded', grade(0.01))
    expect(await colorSpaceOf(graded)).toBeUndefined()
    for (const [i, band] of BANDS.entries()) {
      const [x, y] = centers(1920, 1080)[i] as [number, number]
      const want = await playerRgb(control, x, y, 'bt601')
      const got = await playerRgb(graded, x, y, 'bt601')
      expect(maxDelta(got, want), `${band.label} graded ${got} vs control ${want}`).toBeLessThanOrEqual(4)
    }
  }, 120_000)

  // ---- T-119 (4): the bt601-TAGGED half. Red on 6.1.1 without the tag-only stage (the tag comes back
  // `unknown`), green on 7.0.2 either way; see the block header. ----

  it.each(BT601_TAGS.map((t) => t.tag))(
    'the %s fixture is what it says: tagged, probed as tagged, and its bands decode to the colors they were drawn as under a 601 decode (T-119)',
    async (tag) => {
      const src = tagged601Src[tag] as string
      expect(await colorSpaceOf(src)).toBe(tag)
      expect((await probeVideo(src)).colorSpace).toBe(tag)
      const at = centers(640, 360)
      for (const [i, band] of BANDS.entries()) {
        const [x, y] = at[i] as [number, number]
        const got = await playerRgb(src, x, y, 'bt601')
        expect(maxDelta(got, band.rgb), `${band.label} band ${got} vs drawn ${band.rgb}`).toBeLessThanOrEqual(8)
      }
    },
    120_000
  )

  it.each(
    BT601_TAGS.flatMap(({ tag }) => [
      [tag, 'a platform export (and so Clip Kit)', exportClip, 1920, 1080],
      [tag, 'a compilation segment', compileClip, 1280, 720]
    ] as const)
  )(
    'a %s source, %s with a grade on: the graph runs, the file keeps its tag, and every band decodes as the control does under a 601 decode (T-119)',
    async (tag, _label, run, width, height) => {
      const src = tagged601Src[tag] as string
      const id = `t119-${tag}-${width}`
      const control = await run(src, `${id}-control`)
      const graded = await run(src, `${id}-graded`, grade(0.01))
      expect(await colorSpaceOf(control), 'the ungraded control keeps the tag').toBe(tag)
      // Soft, so one red run reports the tag AND the pixels (the 6.1.1 evidence wants both).
      expect.soft(await colorSpaceOf(graded), `the graded output is still tagged ${tag}`).toBe(tag)
      for (const [i, band] of BANDS.entries()) {
        const [x, y] = centers(width, height)[i] as [number, number]
        const want = await playerRgb(control, x, y, 'bt601')
        const got = await playerRgb(graded, x, y, 'bt601')
        expect(maxDelta(want, band.rgb), `${band.label} control ${want} vs drawn ${band.rgb}`).toBeLessThanOrEqual(10)
        // The pixels were never wrong for bt601 (the round trip is symmetric), and the tag-only stage must not move them.
        expect(maxDelta(got, want), `${band.label} graded ${got} vs control ${want}`).toBeLessThanOrEqual(4)
      }
    },
    180_000
  )

  it('the tag-only stage does not undo the grade: a full warm grade still warms a smpte170m source (T-119)', async () => {
    const src = tagged601Src.smpte170m as string
    const [x, y] = centers(1920, 1080)[3] as [number, number] // the mid-gray band
    const control = await playerRgb(await exportClip(src, 't119-gray-control'), x, y, 'bt601')
    const warm = await exportClip(src, 't119-gray-warm', grade(1))
    expect.soft(await colorSpaceOf(warm), 'the warm output is still tagged smpte170m').toBe('smpte170m')
    const got = await playerRgb(warm, x, y, 'bt601')
    expect(got[0] - got[2], `warm gray ${got} vs control ${control}: red over blue`).toBeGreaterThan(30)
    expect(got[0], `warm gray ${got} vs control ${control}: red rises`).toBeGreaterThan(control[0] + 15)
    expect(got[2], `warm gray ${got} vs control ${control}: blue falls`).toBeLessThan(control[2] - 10)
  }, 120_000)
})

/**
 * T-51 — watermark and text-overlay PIXELS.
 *
 * PER-PLATFORM CAVEAT, same class as the mpegts segfault further down:
 * ffmpeg-static ships binaries from DIFFERENT upstream builders per
 * platform, and the linux x64 one (johnvansickle 7.0.2-static) has no
 * `drawtext` filter at all (its `-buildconf` lists libfreetype and no
 * libharfbuzz; the distro's 6.1.1, which has both, has the filter) — the only
 * filter a watermark or a text overlay produces. Every dev box and every CI
 * run of this suite is linux, so until this block the pixels those two
 * features paint were proven on NO platform: the deepest coverage anywhere
 * asserted the command string, or (in the E2E) asserted that the export
 * FAILS naming drawtext. The shipped win32 binary (gyan.dev 6.1.1) has the
 * filter, and the release workflow — windows-latest, the de facto Windows
 * CI (LESSONS 2026-08-15) — now runs `npm run test:media`, so the gated
 * tests below execute exactly where the product ships. The linux pins at
 * the bottom fail the moment ffmpeg-static gains the filter, which is what
 * forces the gate to be lifted rather than left to rot.
 *
 * Technique: the caption burn-in bands (render, re-render the identical
 * pipeline without the thing under test, diff the regions), with the
 * fixture swapped for a featureless gray so "nothing else moved" is an
 * exact pixel assertion rather than an encoder-drift band. Region luma is
 * the primary evidence — it needs no font metrics, only "these pixels are
 * not the flat value" — and PSNR corroborates it on the named technique.
 *
 * Timebase note for the `enable` windows (rewritten by T-74): `-ss` before
 * `-i` is input seeking, so frames reach the filter graph starting at t=0 and
 * a drawtext `enable` window is CLIP-relative. What the editor STORES is
 * source-absolute, though, so `buildVideoFilter` converts — and until T-74 it
 * did not, which meant an overlay only ever appeared on a clip starting at
 * 0.00. These tests used to be written at `startSec: 0`, where the two
 * timebases coincide and the bug is invisible; every clip below now starts at
 * CLIP_START = 2 so they run in the regime that was broken. The overlays
 * carry the source-absolute numbers the editor would have written for such a
 * clip, and the probe times stay clip-relative because that is what the
 * output file's own clock is.
 */
describe('watermark + text-overlay pixels (drawtext, T-51)', () => {
  // The exact font files the filter graph hardcodes (src/main/ffmpeg/
  // filters.ts). Named here so a runner image without Arial fails as
  // "the font this filter demands is missing" instead of as "drawtext
  // painted nothing" — see the known-and-accepted note in LESSONS.
  const WATERMARK_FONT = 'C:/Windows/Fonts/arialbd.ttf'
  const OVERLAY_FONT = 'C:/Windows/Fonts/arial.ttf'

  // The values ExportPanel actually builds a WatermarkSpec with, so this
  // proves the shipped configuration rather than a synthetic one.
  const WATERMARK_TEXT = '@imagii_test'
  const WATERMARK_OPACITY = 0.85
  const WATERMARK_FONT_SIZE_PCT = 3.5

  const POSITIONS: readonly WatermarkSpec['position'][] = [
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right'
  ]
  // Quadrants of the 1920x1080 youtube export. A whole quadrant rather than
  // a tight box on purpose: containment must not depend on the substituted
  // font's metrics, only on which corner the text was anchored to.
  const QUADRANT: Record<WatermarkSpec['position'], string> = {
    'top-left': 'crop=960:540:0:0',
    'top-right': 'crop=960:540:960:0',
    'bottom-left': 'crop=960:540:0:540',
    'bottom-right': 'crop=960:540:960:540'
  }
  const DIAGONAL: Record<WatermarkSpec['position'], WatermarkSpec['position']> = {
    'top-left': 'bottom-right',
    'top-right': 'bottom-left',
    'bottom-left': 'top-right',
    'bottom-right': 'top-left'
  }

  // A clip that does NOT start at 0 (T-74). SAMPLE_T and the 2.5 s probe
  // below are positions in the 3-second OUTPUT, which starts at 0 whatever
  // the clip's source range is.
  const CLIP_START = 2
  const CLIP_END = 5
  const SAMPLE_T = 1.0

  function watermarkClip(): Clip {
    return makeClip({ startSec: CLIP_START, endSec: CLIP_END })
  }

  // The control: the identical export, identical encoder settings, no
  // drawtext in the chain. Every assertion below is a diff against this.
  let controlOut = ''
  let flatLuma = 0

  beforeAll(async () => {
    if (process.platform !== 'win32') return
    const res = await runExportJob(
      {
        ...makeJob(flatGraySrc, 'youtube', watermarkClip(), 'job-drawtext-control'),
        outputFilename: 'drawtext-control.mp4'
      },
      () => {}
    )
    controlOut = res.outputPath
    const whole = await regionLuma(controlOut, SAMPLE_T, 'crop=1920:1080:0:0')
    flatLuma = whole.min
  }, 180_000)

  it.skipIf(process.platform !== 'win32')(
    'preflight: this build has drawtext, the hardcoded fonts exist, and the control render is genuinely flat',
    async () => {
      const names = await ffFilterNames()
      expect(names.size, 'the -filters table parsed').toBeGreaterThan(100)
      expect(
        names.has('drawtext'),
        'the shipped win32 ffmpeg has drawtext (if false, the gated tests below prove nothing and the product is broken on its own platform)'
      ).toBe(true)
      expect(existsSync(WATERMARK_FONT), `watermark font present: ${WATERMARK_FONT}`).toBe(true)
      expect(existsSync(OVERLAY_FONT), `text-overlay font present: ${OVERLAY_FONT}`).toBe(true)

      // Everything below reads "differs from flat" as "text was painted".
      // That inference is only sound if the control really is flat.
      const whole = await regionLuma(controlOut, SAMPLE_T, 'crop=1920:1080:0:0')
      expect(
        whole.max - whole.min,
        `control render is featureless (luma ${whole.min}..${whole.max})`
      ).toBeLessThanOrEqual(2)
    },
    120_000
  )

  it.skipIf(process.platform !== 'win32')(
    'a watermark paints its own corner and leaves the other three untouched',
    async () => {
      for (const position of POSITIONS) {
        const watermark: WatermarkSpec = {
          text: WATERMARK_TEXT,
          position,
          opacity: WATERMARK_OPACITY,
          fontSizePct: WATERMARK_FONT_SIZE_PCT
        }
        const res = await runExportJob(
          {
            ...makeJob(flatGraySrc, 'youtube', watermarkClip(), `job-wm-${position}`),
            watermark,
            outputFilename: `watermark-${position}.mp4`
          },
          () => {}
        )

        // Its own corner carries BOTH halves of the watermark: white@0.85
        // glyphs well above the flat value, and the black@0.34 box behind
        // them well below it.
        const own = await regionLuma(res.outputPath, SAMPLE_T, QUADRANT[position])
        expect(
          own.max,
          `"${position}": white glyph pixels in the ${position} quadrant (max luma ${own.max}, flat ${flatLuma})`
        ).toBeGreaterThan(flatLuma + 60)
        expect(
          own.min,
          `"${position}": the watermark's dark box in the ${position} quadrant (min luma ${own.min}, flat ${flatLuma})`
        ).toBeLessThan(flatLuma - 15)

        // The other three quadrants are the flat value, full stop.
        for (const other of POSITIONS.filter((p) => p !== position)) {
          const q = await regionLuma(res.outputPath, SAMPLE_T, QUADRANT[other])
          expect(
            q.max,
            `"${position}": ${other} quadrant untouched (luma ${q.min}..${q.max}, flat ${flatLuma})`
          ).toBeLessThanOrEqual(flatLuma + 4)
          expect(
            q.min,
            `"${position}": ${other} quadrant untouched (luma ${q.min}..${q.max}, flat ${flatLuma})`
          ).toBeGreaterThanOrEqual(flatLuma - 4)
        }

        // Same claim in the caption tests' currency. The watermark covers a
        // few percent of a quadrant, so its band sits far higher than a
        // burned-in caption's ~18 dB — the separation is what carries the
        // assertion, not the absolute number.
        const ownPsnr = await regionPsnr(res.outputPath, controlOut, QUADRANT[position])
        const farPsnr = await regionPsnr(res.outputPath, controlOut, QUADRANT[DIAGONAL[position]])
        expect(
          ownPsnr,
          `"${position}": its own quadrant differs from the control (${ownPsnr} dB)`
        ).toBeLessThan(45)
        expect(
          farPsnr,
          `"${position}": the ${DIAGONAL[position]} quadrant matches the control (${farPsnr} dB)`
        ).toBeGreaterThan(60)
        expect(
          farPsnr - ownPsnr,
          `"${position}": painted vs clean quadrants are clearly separated`
        ).toBeGreaterThan(15)
      }
    },
    600_000
  )

  // Two overlays in one export: it also proves the chain survives more than
  // one drawtext. `lower` spans the whole clip (the shape the editor
  // produces, whose window is the clip's own range); `timed` carries a
  // sub-range, which is the only thing `enable` is for. Both carry
  // SOURCE-absolute seconds, because that is what the editor stores and what
  // `buildVideoFilter` has to rebase (T-74).
  const lower: TextOverlay = {
    id: 'ov-lower',
    text: 'LOWER THIRD',
    font: 'Arial',
    sizePx: 48,
    colorHex: '#ff3b30',
    x: 0.1,
    y: 0.85,
    startSec: CLIP_START,
    endSec: CLIP_END
  }
  const timed: TextOverlay = {
    id: 'ov-timed',
    text: 'TIMED',
    font: 'Arial',
    sizePx: 48,
    colorHex: '#30d158',
    x: 0.1,
    y: 0.1,
    startSec: CLIP_START + 0.4,
    endSec: CLIP_START + 1.6
  }
  // x=0.1 -> 192 px, y -> 918 / 108 px, drawn downward from there.
  const LOWER_REGION = 'crop=768:160:128:900'
  const TIMED_REGION = 'crop=768:160:128:90'
  // The same band on the far side of the frame: proves the mark landed at
  // the x it named rather than merely somewhere on that row.
  const MIRROR_REGION = 'crop=768:160:1152:900'
  const OFF_T = 2.5

  function overlayClip(): Clip {
    return makeClip({ startSec: CLIP_START, endSec: CLIP_END, textOverlays: [lower, timed] })
  }

  /**
   * What both overlays must do, asserted identically whether the marks were
   * painted by the real `drawtext` (win32) or by the drawbox stand-in below.
   * Every probe time is a position in the OUTPUT — the file starts at 0 even
   * though its clip starts at CLIP_START, which is exactly the confusion
   * T-74 fixed.
   */
  async function assertOverlayWindows(out: string, painter: string): Promise<void> {
    // ── inside both windows ──
    const lowerOn = await countTintedPixels(out, SAMPLE_T, LOWER_REGION, 0)
    expect(
      lowerOn,
      `${painter}: "LOWER THIRD" paints red at x=0.1,y=0.85 (${lowerOn} red px at t=${SAMPLE_T})`
    ).toBeGreaterThan(100)
    const timedOn = await countTintedPixels(out, SAMPLE_T, TIMED_REGION, 1)
    expect(
      timedOn,
      `${painter}: "TIMED" paints green at x=0.1,y=0.1 inside its window (${timedOn} green px at t=${SAMPLE_T})`
    ).toBeGreaterThan(50)

    // Each overlay's colour is its own: neither region carries the other's.
    const lowerGreen = await countTintedPixels(out, SAMPLE_T, LOWER_REGION, 1)
    expect(
      lowerGreen,
      `${painter}: the lower band carries no green — colorHex is per-overlay (${lowerGreen} green px)`
    ).toBe(0)
    const mirrorRed = await countTintedPixels(out, SAMPLE_T, MIRROR_REGION, 0)
    expect(
      mirrorRed,
      `${painter}: the mirrored band at x=1152..1920 is untouched, so the mark landed at the x it named (${mirrorRed} red px)`
    ).toBe(0)

    // ── the whole-clip window really covers the WHOLE clip ──
    // The first frame is the one T-74 lost: with a source-absolute window on
    // a clip starting at CLIP_START, nothing was painted until the graph's
    // clock reached CLIP_START — seconds into a clip that may not last that
    // long. Both ends of the output are probed.
    const lowerFirst = await countTintedPixels(out, 0.05, LOWER_REGION, 0)
    expect(
      lowerFirst,
      `${painter}: "LOWER THIRD" is already on at the FIRST frame of the clip (${lowerFirst} red px at t=0.05)`
    ).toBeGreaterThan(100)
    const lowerLast = await countTintedPixels(out, CLIP_END - CLIP_START - 0.1, LOWER_REGION, 0)
    expect(
      lowerLast,
      `${painter}: and still on at the last (${lowerLast} red px at t=${CLIP_END - CLIP_START - 0.1})`
    ).toBeGreaterThan(100)

    // ── outside the timed window ──
    // 2.5 s is past `timed`'s clip-relative 1.6 s end but inside `lower`'s
    // range, so one assertion proves the gate closes and the other proves
    // the export did not simply stop drawing.
    const timedOff = await countTintedPixels(out, OFF_T, TIMED_REGION, 1)
    expect(timedOff, `${painter}: "TIMED" is gone at t=${OFF_T} (${timedOff} green px)`).toBe(0)
    const timedOffLuma = await regionLuma(out, OFF_T, TIMED_REGION)
    expect(
      timedOffLuma.max - timedOffLuma.min,
      `${painter}: and its band is flat again at t=${OFF_T} (luma ${timedOffLuma.min}..${timedOffLuma.max})`
    ).toBeLessThanOrEqual(4)
    const lowerStill = await countTintedPixels(out, OFF_T, LOWER_REGION, 0)
    expect(
      lowerStill,
      `${painter}: "LOWER THIRD" is still painted at t=${OFF_T} (${lowerStill} red px)`
    ).toBeGreaterThan(100)
  }

  it.skipIf(process.platform !== 'win32')(
    'text overlays paint their own colour at the x/y they name, and only inside their enable window',
    async () => {
      const res = await runExportJob(
        {
          ...makeJob(flatGraySrc, 'youtube', overlayClip(), 'job-overlays'),
          outputFilename: 'text-overlays.mp4'
        },
        () => {}
      )
      await assertOverlayWindows(res.outputPath, 'drawtext')
    },
    600_000
  )

  /**
   * T-114 - the Font dropdown was a dead control. The editor stored one of six names and
   * `drawTextFilter` printed `arial.ttf` whatever it said, so a streamer who picked Impact for the
   * title got Arial and was never told. A table now maps the six names to six fixed font files; a
   * name that is not in it (an old project, a hand-edited one, or a string built to break out of the
   * option) is Arial and is never printed.
   *
   * What is measured is WIDTH: ten lowercase i's are about 2.7 times as wide in a monospaced face as
   * in Arial, whatever the face's weight, so the same text at the same size in two fonts has two
   * widths, and the same font twice has exactly one. Win32 only, like the rest of the block (the
   * linux build has no drawtext; `filters.test.ts` holds the command text for each font).
   */
  const FONT_FILES: Record<string, string> = {
    Arial: 'arial.ttf',
    Impact: 'impact.ttf',
    Verdana: 'verdana.ttf',
    Georgia: 'georgia.ttf',
    'Courier New': 'cour.ttf',
    'Comic Sans MS': 'comic.ttf'
  }

  async function fontOverlayExport(font: string, tag: string): Promise<string> {
    const clip = makeClip({
      startSec: CLIP_START,
      endSec: CLIP_END,
      textOverlays: [{ ...lower, id: `ov-font-${tag}`, text: 'iiiiiiiiii', font }]
    })
    const res = await runExportJob(
      { ...makeJob(flatGraySrc, 'youtube', clip, `job-font-${tag}`), outputFilename: `font-${tag}.mp4` },
      () => {}
    )
    return res.outputPath
  }

  it.skipIf(process.platform !== 'win32')(
    'T-114: every font the editor offers is a file this machine has, and each one exports and paints',
    async () => {
      expect(OVERLAY_FONTS.length, 'the editor offers six fonts').toBe(6)
      for (const font of OVERLAY_FONTS) {
        const file = `C:/Windows/Fonts/${FONT_FILES[font]}`
        expect(existsSync(file), `${font}: ${file} exists`).toBe(true)
        const out = await fontOverlayExport(font, font.replace(/\W/g, ''))
        const red = await countTintedPixels(out, SAMPLE_T, LOWER_REGION, 0)
        expect(red, `${font} paints red at the lower third (${red} red px)`).toBeGreaterThan(50)
      }
    },
    600_000
  )

  it.skipIf(process.platform !== 'win32')(
    'T-114: the Font choice reaches the picture; an unknown or hostile font string is Arial',
    async () => {
      const width = async (font: string, tag: string): Promise<number> =>
        tintedExtentX(await fontOverlayExport(font, tag), SAMPLE_T, LOWER_REGION, 768, 0)
      const arial = await width('Arial', 'arial')
      const courier = await width('Courier New', 'courier')
      expect(arial, `Arial paints a line of i's (${arial} px wide)`).toBeGreaterThan(20)
      expect(
        courier,
        `Courier New is a different face: ${courier} px against Arial's ${arial} px for the same text`
      ).toBeGreaterThan(arial * 1.6)
      // The same font is the same picture, so these are EXACT: nothing a person or a file can put in
      // `font` picks a file, and the string itself is not printed.
      expect(await width('Papyrus', 'unknown'), 'a font that is not in the table is Arial').toBe(arial)
      expect(await width('', 'empty'), 'an empty font is Arial').toBe(arial)
      expect(
        await width("arial.ttf':text='injected':fontsize=200:x=0:y=0,drawtext=text='", 'hostile'),
        'a hostile font string exports and is Arial'
      ).toBe(arial)
    },
    600_000
  )

  /**
   * T-111 — the text a person types reaches ffmpeg through THREE parsers (the
   * filtergraph, the option list, drawtext's expansion) and the escape handled
   * one. "Let's go" killed the export outright (the graph-level quote closed and
   * `enable='between(t,0.000,…` lost its commas: "No such filter: '0.000'"),
   * "Sale 50% off" exported and quietly drew nothing, and a newline drew the
   * letter n. The unit tests parse the escape back the way ffmpeg does; this is
   * the real binary drawing it. Win32 only, like the rest of the block: the
   * linux build has no drawtext, and filters.test.ts holds the command text.
   *
   * Each text is exported as an overlay at the lower-third position and must
   * both succeed and paint its own color there; a two-line text must paint
   * BOTH lines (a second band of red below the first).
   */
  const TRICKY_TEXTS = [
    "Let's go",
    'Sale 50% off',
    "Joe's stream: 50% off",
    'C:\\games\\run'
  ]

  it.skipIf(process.platform !== 'win32')(
    'T-111: an apostrophe, a percent sign, a colon and a backslash in an overlay export and paint',
    async () => {
      for (const [i, text] of TRICKY_TEXTS.entries()) {
        const clip = makeClip({
          startSec: CLIP_START,
          endSec: CLIP_END,
          textOverlays: [{ ...lower, id: `ov-t111-${i}`, text }]
        })
        const res = await runExportJob(
          { ...makeJob(flatGraySrc, 'youtube', clip, `job-t111-${i}`), outputFilename: `t111-overlay-${i}.mp4` },
          () => {}
        )
        const red = await countTintedPixels(res.outputPath, SAMPLE_T, LOWER_REGION, 0)
        expect(red, `${JSON.stringify(text)} paints red at the lower third (${red} red px)`).toBeGreaterThan(100)
        const mirror = await countTintedPixels(res.outputPath, SAMPLE_T, MIRROR_REGION, 0)
        expect(mirror, `${JSON.stringify(text)} stays on the side it was placed (${mirror} red px)`).toBe(0)
      }
    },
    600_000
  )

  /**
   * T-130 (an) - the margins, in pixels. A 9:16 export (Reels, TikTok; the Short is Reels' geometry) is played under the platform's header
   * and over its caption, so the watermark sits between them: `watermarkInset` says where (288 px from the top, 480 px from the bottom of
   * 1080x1920). The bands are measured on the flat-gray fixture cut to 9:16 (a flat picture stays flat), against the box's 8 px border and
   * 4 px of slack: the header band (rows above the box) and the caption band (rows below it) are the flat value to the pixel in every one of the
   * four renders, and the watermark's own band, in its own half of the frame, carries both halves of it (white glyphs, the dark box).
   */
  it.skipIf(process.platform !== 'win32')(
    'T-130 (an): on a 9:16 export the watermark sits between the header and the caption in every corner, and the bands above and below it stay flat',
    async () => {
      const W = 1080
      const H = 1920
      const { top, bottom } = watermarkInset({ width: W, height: H })
      expect([top, bottom], 'the margins the product names, at 1080x1920').toEqual([288, 480])
      const BOX = 8 // boxborderw
      const SLACK = 4
      const SPAN = 200 // rows searched for the watermark inside its band
      const HALF = W / 2
      const header = `crop=${W}:${top - BOX - SLACK}:0:0`
      const caption = `crop=${W}:${bottom - BOX - SLACK}:0:${H - (bottom - BOX - SLACK)}`
      const flat = async (file: string, crop: string, what: string): Promise<void> => {
        const q = await regionLuma(file, SAMPLE_T, crop)
        expect(q.max, `${what} (luma ${q.min}..${q.max}, flat ${flatLuma})`).toBeLessThanOrEqual(flatLuma + 4)
        expect(q.min, `${what} (luma ${q.min}..${q.max}, flat ${flatLuma})`).toBeGreaterThanOrEqual(flatLuma - 4)
      }
      for (const position of POSITIONS) {
        const watermark: WatermarkSpec = { text: WATERMARK_TEXT, position, opacity: WATERMARK_OPACITY, fontSizePct: WATERMARK_FONT_SIZE_PCT }
        const res = await runExportJob(
          {
            ...makeJob(flatGraySrc, 'reels', watermarkClip(), `job-wm-vertical-${position}`),
            watermark,
            outputFilename: `watermark-vertical-${position}.mp4`
          },
          () => {}
        )
        const v = (await ffprobeJson(res.outputPath)).streams.find((s) => s.codec_type === 'video')
        expect([v?.width, v?.height], 'a 9:16 file').toEqual([W, H])

        // The platform's own bands are untouched, whichever corner the handle is in.
        await flat(res.outputPath, header, `"${position}": the header band (rows 0..${top - BOX - SLACK})`)
        await flat(res.outputPath, caption, `"${position}": the caption band (rows ${H - (bottom - BOX - SLACK)}..${H})`)

        // The watermark is in its own half of the band beside the header or above the caption, and not in the other half.
        // The band is SPAN rows: the ones just below the header's clear rows, or the ones just above the caption's.
        const rowY = position.startsWith('top') ? top - BOX - SLACK : H - bottom - SPAN + BOX + SLACK
        const half = (right: boolean): string => `crop=${HALF}:${SPAN}:${right ? HALF : 0}:${rowY}`
        const own = await regionLuma(res.outputPath, SAMPLE_T, half(position.endsWith('right')))
        expect(own.max, `"${position}": white glyph pixels in its band (rows from ${rowY}, max luma ${own.max}, flat ${flatLuma})`).toBeGreaterThan(flatLuma + 60)
        expect(own.min, `"${position}": the watermark's dark box in its band (min luma ${own.min}, flat ${flatLuma})`).toBeLessThan(flatLuma - 15)
        await flat(res.outputPath, half(!position.endsWith('right')), `"${position}": the other half of the band is untouched`)
      }
    },
    600_000
  )

  /**
   * T-130 (an), the other side of it: a landscape export keeps its flat 20 px. The box (text plus its 8 px border) ends 12 px above the bottom
   * edge of a bottom-right watermark, so the last 10 rows are the flat value and the 60 rows above them are not.
   */
  it.skipIf(process.platform !== 'win32')(
    'T-130 (an): a landscape export keeps the flat 20 px - the last rows of the frame are flat and the box sits just above them',
    async () => {
      const watermark: WatermarkSpec = { text: WATERMARK_TEXT, position: 'bottom-right', opacity: WATERMARK_OPACITY, fontSizePct: WATERMARK_FONT_SIZE_PCT }
      const res = await runExportJob(
        { ...makeJob(flatGraySrc, 'youtube', watermarkClip(), 'job-wm-landscape-20'), watermark, outputFilename: 'watermark-landscape-20.mp4' },
        () => {}
      )
      const edge = await regionLuma(res.outputPath, SAMPLE_T, 'crop=1920:10:0:1070')
      expect(edge.max, `the last ten rows (luma ${edge.min}..${edge.max}, flat ${flatLuma})`).toBeLessThanOrEqual(flatLuma + 4)
      expect(edge.min, `the last ten rows (luma ${edge.min}..${edge.max}, flat ${flatLuma})`).toBeGreaterThanOrEqual(flatLuma - 4)
      // The box reaches 12 px from the edge (20 less its 8 px border): its last rows are dark, 14..20 px up.
      const reach = await regionLuma(res.outputPath, SAMPLE_T, 'crop=500:6:1400:1060')
      expect(reach.min, `the dark box reaches rows 1060..1066 (min luma ${reach.min}, flat ${flatLuma})`).toBeLessThan(flatLuma - 15)
      const glyphs = await regionLuma(res.outputPath, SAMPLE_T, 'crop=500:60:1400:1010')
      expect(glyphs.max, `...and its glyphs are above it (max luma ${glyphs.max})`).toBeGreaterThan(flatLuma + 60)
    },
    600_000
  )

  it.skipIf(process.platform !== 'win32')(
    'T-111: a two-line overlay draws both lines, and a watermark with an apostrophe and a percent sign draws',
    async () => {
      const oneLine = await runExportJob(
        {
          ...makeJob(
            flatGraySrc,
            'youtube',
            makeClip({
              startSec: CLIP_START,
              endSec: CLIP_END,
              textOverlays: [{ ...timed, id: 'ov-t111-one', text: 'One', startSec: CLIP_START, endSec: CLIP_END }]
            }),
            'job-t111-one'
          ),
          outputFilename: 't111-one-line.mp4'
        },
        () => {}
      )
      const twoLines = await runExportJob(
        {
          ...makeJob(
            flatGraySrc,
            'youtube',
            makeClip({
              startSec: CLIP_START,
              endSec: CLIP_END,
              textOverlays: [{ ...timed, id: 'ov-t111-two', text: 'One\nTwo', startSec: CLIP_START, endSec: CLIP_END }]
            }),
            'job-t111-two'
          ),
          outputFilename: 't111-two-lines.mp4'
        },
        () => {}
      )
      // The overlay sits at y=0.1 (108 px) and draws downward: a 48 px line is
      // about 55 px tall, so the second line occupies roughly 163-218. Count the
      // green in a band below the first line's own: none for one line, plenty
      // for two (and not the letter n of a `\n` that was never a line break).
      const SECOND_LINE = 'crop=768:70:128:166'
      const belowOne = await countTintedPixels(oneLine.outputPath, SAMPLE_T, SECOND_LINE, 1)
      const belowTwo = await countTintedPixels(twoLines.outputPath, SAMPLE_T, SECOND_LINE, 1)
      expect(belowOne, 'a one-line overlay leaves the band under it empty').toBe(0)
      expect(belowTwo, `a two-line overlay paints its second line (${belowTwo} green px)`).toBeGreaterThan(100)

      const watermark: WatermarkSpec = {
        text: "Joe's 50%: live",
        position: 'top-left',
        opacity: WATERMARK_OPACITY,
        fontSizePct: WATERMARK_FONT_SIZE_PCT
      }
      const wm = await runExportJob(
        {
          ...makeJob(flatGraySrc, 'youtube', watermarkClip(), 'job-t111-wm'),
          watermark,
          outputFilename: 't111-watermark.mp4'
        },
        () => {}
      )
      const own = await regionLuma(wm.outputPath, SAMPLE_T, QUADRANT['top-left'])
      expect(own.max, `the watermark's glyphs are in its own corner (max luma ${own.max}, flat ${flatLuma})`).toBeGreaterThan(flatLuma + 60)
      const far = await regionLuma(wm.outputPath, SAMPLE_T, QUADRANT['bottom-right'])
      expect(far.max - far.min, `and the far corner is untouched (luma ${far.min}..${far.max})`).toBeLessThanOrEqual(4)
    },
    600_000
  )

  /**
   * T-74 — the same claim on a build with no drawtext, which is every build
   * this suite normally runs on.
   *
   * `drawbox` exists in every ffmpeg and takes the same `enable` expression,
   * so this substitutes the FILTER NAME and nothing else. The chain still
   * comes from the production `buildVideoFilter`; the enable expression is
   * production's own, byte for byte; the box's position and colour are read
   * back out of the drawtext string it produced; and the args around it —
   * above all the `-ss` before `-i` that makes the graph's clock
   * clip-relative in the first place — are `runExportJob`'s own. A
   * regression in EITHER half fails this test, which is what a hand-written
   * ffmpeg command in the test would not catch.
   *
   * Not gated by platform: it is the same evidence on win32, where it runs
   * beside the real drawtext case above.
   */
  it(
    'the enable window is clip-relative on a clip that starts at 2 s (drawbox stand-in, every build)',
    async () => {
      const out = await exportWithDrawboxStandIn({
        ...makeJob(flatGraySrc, 'youtube', overlayClip(), 'job-overlays-drawbox'),
        outputFilename: 'text-overlays-drawbox.mp4'
      })
      await assertOverlayWindows(out, 'drawbox stand-in')
    },
    600_000
  )

  /**
   * The second half of the same conversion: `setpts=PTS/speed` sits ahead of
   * the overlay in the chain, so the graph's clock is divided as well as
   * shifted. At 2x the clip's 3 source seconds are 1.5 output seconds and
   * `timed`'s source 2.4 -> 3.6 window has to land at 0.2 -> 0.8.
   */
  it(
    'a sped-up clip divides the window too (drawbox stand-in, every build)',
    async () => {
      const out = await exportWithDrawboxStandIn({
        ...makeJob(
          flatGraySrc,
          'youtube',
          makeClip({
            startSec: CLIP_START,
            endSec: CLIP_END,
            speedMultiplier: 2,
            textOverlays: [timed]
          }),
          'job-overlays-drawbox-2x'
        ),
        outputFilename: 'text-overlays-drawbox-2x.mp4'
      })
      const on = await countTintedPixels(out, 0.5, TIMED_REGION, 1)
      expect(on, `"TIMED" is on at t=0.5 of the 2x output (${on} green px)`).toBeGreaterThan(50)
      const off = await countTintedPixels(out, 1.2, TIMED_REGION, 1)
      expect(off, `and gone by t=1.2, not still running to 3.6 (${off} green px)`).toBe(0)
    },
    600_000
  )

  /**
   * T-105 — the same overlay claims for a COMPILATION, which used to drop every
   * text overlay a clip carried. Three clips from the same 2-5 s range of the
   * flat-gray source, so each runs in the regime T-74 fixed (a clip that does not
   * start at 0): one with both overlays at 1x (output 0-3 s), one at 2x with the
   * timed overlay (output 3-4.5 s: its 2.4-3.6 s window is 0.2-0.8 s of the clip),
   * and a plain one (output 4.5-7.5 s) that must NOT inherit a neighbor's text —
   * each segment is its own ffmpeg run with its own clock.
   */
  const compileOverlaySpec = (jobId: string): ConcatJobSpec => ({
    jobId,
    sourcePath: flatGraySrc,
    outDir: workDir,
    segments: [
      { startSec: CLIP_START, endSec: CLIP_END, name: 'overlays', textOverlays: [lower, timed] },
      { startSec: CLIP_START, endSec: CLIP_END, name: 'fast', speedMultiplier: 2, textOverlays: [timed] },
      { startSec: CLIP_START, endSec: CLIP_END, name: 'plain' }
    ],
    fadeMs: 0,
    width: 1920,
    height: 1080
  })

  async function assertCompiledOverlays(out: string, painter: string): Promise<void> {
    // Clip 1 starts the file, so its probe times are the ones the export cases use.
    await assertOverlayWindows(out, `${painter} (compilation, clip 1)`)
    // Clip 2 starts at 3 s: on at 0.5 s into it, gone by 1.2 s into it.
    const on = await countTintedPixels(out, 3.5, TIMED_REGION, 1)
    expect(on, `${painter}: "TIMED" is on 0.5 s into the 2x clip (${on} green px)`).toBeGreaterThan(50)
    const off = await countTintedPixels(out, 4.2, TIMED_REGION, 1)
    expect(off, `${painter}: and gone 1.2 s into it, not running to 3.6 (${off} green px)`).toBe(0)
    // Clip 3 starts at 4.5 s and has no text of its own.
    const strayRed = await countTintedPixels(out, 5.5, LOWER_REGION, 0)
    const strayGreen = await countTintedPixels(out, 5.5, TIMED_REGION, 1)
    expect(strayRed + strayGreen, `${painter}: the plain clip carries no neighbor's text (${strayRed} red, ${strayGreen} green px)`).toBe(0)
  }

  it(
    'a compiled clip carries its text overlays on its own clock, at its own speed (drawbox stand-in, every build)',
    async () => {
      const out = await compileWithDrawboxStandIn(compileOverlaySpec('job-compile-overlays-drawbox'))
      await assertCompiledOverlays(out, 'drawbox stand-in')
    },
    600_000
  )

  it.skipIf(process.platform !== 'win32')(
    'a compiled clip\'s text overlays are painted by drawtext itself',
    async () => {
      const { outputPath } = await runConcat(compileOverlaySpec('job-compile-overlays'))
      await assertCompiledOverlays(outputPath, 'drawtext')
    },
    600_000
  )

  it.skipIf(process.platform === 'win32')(
    'KNOWN linux-binary gap: a compilation whose clip carries a text overlay dies at graph init naming drawtext, and the same compilation without it renders (T-105; same obsolescence condition as the pin below)',
    async () => {
      // The linux-runnable proof that the overlay reaches the REAL runner's graph:
      // the two specs differ in exactly one field. A compile that drops the
      // overlay (the pre-T-105 behavior) fails the first assertion.
      const spec = compileOverlaySpec('job-compile-overlays-pin')
      await expect(runConcat(spec)).rejects.toThrow(/No such filter: 'drawtext'/)

      const clean = await runConcat({
        ...spec,
        jobId: 'job-compile-overlays-pin-clean',
        segments: spec.segments.map(({ name, startSec, endSec, speedMultiplier }) => ({
          name,
          startSec,
          endSec,
          speedMultiplier
        }))
      })
      const v = (await ffprobeJson(clean.outputPath)).streams.find((s) => s.codec_type === 'video')
      expect([v?.width, v?.height]).toEqual([1920, 1080])
    },
    180_000
  )

  it.skipIf(process.platform === 'win32')(
    'KNOWN linux-binary gap: the bundled ffmpeg has NO drawtext filter (if this FAILS, ffmpeg-static gained it — lift the win32 gate on the pixel tests above and delete these pins: this one, the watermark one, the compilation one and the Clip Kit one)',
    async () => {
      const names = await ffFilterNames()
      // Prove the table was really read before trusting an absence. The two
      // positives also show this build has SOME text rendering — `subtitles`
      // is the libass path the caption burn-in relies on — so the gap is
      // specifically drawtext (this build has libfreetype and no libharfbuzz), not "no text at all".
      expect(names.size, 'the -filters table parsed').toBeGreaterThan(100)
      expect(names.has('scale'), 'a filter every build has').toBe(true)
      expect(names.has('subtitles'), 'the libass path the caption tests use').toBe(true)
      expect(names.has('drawtext'), 'drawtext is absent from the linux build').toBe(false)
    },
    60_000
  )

  it.skipIf(process.platform === 'win32')(
    'KNOWN linux-binary gap: a real watermarked export dies at graph init naming drawtext (same obsolescence condition as the pin above)',
    async () => {
      // The consequence the capability probe implies, taken through the real
      // production runner: this is why the pixel tests above are gated
      // rather than merely slow. Note the exact message — when ffmpeg-static
      // does gain drawtext this stops being "no such filter" and becomes a
      // font error, because the filter hardcodes a C:/Windows path, so this
      // pin fails on the upgrade either way.
      const watermark: WatermarkSpec = {
        text: WATERMARK_TEXT,
        position: 'bottom-right',
        opacity: WATERMARK_OPACITY,
        fontSizePct: WATERMARK_FONT_SIZE_PCT
      }
      await expect(
        runExportJob(
          {
            ...makeJob(flatGraySrc, 'youtube', makeClip({ startSec: 0, endSec: 1 }), 'job-wm-pin'),
            watermark,
            outputFilename: 'watermark-linux-pin.mp4'
          },
          () => {}
        )
      ).rejects.toThrow(/No such filter: 'drawtext'/)
    },
    120_000
  )

  /**
   * T-85 — Clip Kit and the saved watermark.
   *
   * The kit queued `watermark: null` on all five jobs, so a user who had saved
   * a handle got a watermarked Export and an unmarked kit from the same clip.
   * It resolves the saved handle and corner now, and these cases drive the job
   * the kit really builds — `buildKitQueue`, the same function the button
   * calls — through the real `runExportJob`, because a unit test of the filter
   * string cannot say whether ffmpeg accepts the spec the kit produces.
   *
   * One kit-representative export (the YouTube slot, at the preset's own
   * geometry so the crop/scale stage is a no-op on the flat fixture): the
   * other four slots differ only in their preset, and the unit test
   * (tests/unit/clipKitWatermark.test.ts) shows all five carry the watermark
   * into the graph. Same platform rule as the block above: the pixels are
   * win32-only, and the linux pin below fails the moment drawtext appears.
   */
  async function kitYoutubeJob(
    watermark: WatermarkSpec | null,
    name: string
  ): Promise<ExportJobSpec> {
    const kitDir = path.join(workDir, `kit-${name}`)
    await mkdir(kitDir, { recursive: true })
    const jobs = buildKitQueue({
      source: { filePath: flatGraySrc, width: 1920, height: 1080 },
      clip: watermarkClip(),
      kitDir,
      safeName: 'Kit',
      watermark,
      newJobId: () => `job-kit-${name}-${Math.random().toString(36).slice(2, 8)}`
    })
    const job = jobs.find((j) => j.preset === 'youtube')
    if (!job) throw new Error('the kit queued no YouTube slot')
    return job
  }

  // What ClipKitButton does with what an earlier Export saved.
  const SAVED_CORNER: WatermarkSpec['position'] = 'top-right'
  const savedWatermark = (): WatermarkSpec | null => buildWatermark(WATERMARK_TEXT, SAVED_CORNER)

  it.skipIf(process.platform !== 'win32')(
    'a Clip Kit file carries the saved watermark in the saved corner, and a kit with none saved stays clean',
    async () => {
      const spec = savedWatermark()
      expect(spec, 'the saved handle builds a watermark').not.toBeNull()
      expect(spec?.position).toBe(SAVED_CORNER)

      // ── watermark saved: its own corner is painted, the other three are flat ──
      const marked = await runExportJob(await kitYoutubeJob(spec, 'marked'), () => {})
      const own = await regionLuma(marked.outputPath, SAMPLE_T, QUADRANT[SAVED_CORNER])
      expect(
        own.max,
        `kit file: white glyph pixels in the ${SAVED_CORNER} quadrant (max luma ${own.max}, flat ${flatLuma})`
      ).toBeGreaterThan(flatLuma + 60)
      expect(
        own.min,
        `kit file: the watermark's dark box in the ${SAVED_CORNER} quadrant (min luma ${own.min}, flat ${flatLuma})`
      ).toBeLessThan(flatLuma - 15)
      for (const other of POSITIONS.filter((p) => p !== SAVED_CORNER)) {
        const q = await regionLuma(marked.outputPath, SAMPLE_T, QUADRANT[other])
        expect(q.max, `kit file: ${other} quadrant untouched (luma ${q.min}..${q.max})`).toBeLessThanOrEqual(flatLuma + 4)
        expect(q.min, `kit file: ${other} quadrant untouched (luma ${q.min}..${q.max})`).toBeGreaterThanOrEqual(flatLuma - 4)
      }
      // Against the control render of the same clip: the saved corner differs,
      // the opposite one does not.
      const ownPsnr = await regionPsnr(marked.outputPath, controlOut, QUADRANT[SAVED_CORNER])
      const farPsnr = await regionPsnr(marked.outputPath, controlOut, QUADRANT[DIAGONAL[SAVED_CORNER]])
      expect(ownPsnr, `kit file: saved corner differs from the control (${ownPsnr} dB)`).toBeLessThan(45)
      expect(farPsnr, `kit file: opposite corner matches the control (${farPsnr} dB)`).toBeGreaterThan(60)

      // ── nothing saved: the same kit job is the control, pixel for pixel flat ──
      const clean = await runExportJob(await kitYoutubeJob(null, 'clean'), () => {})
      for (const position of POSITIONS) {
        const q = await regionLuma(clean.outputPath, SAMPLE_T, QUADRANT[position])
        expect(
          q.max - q.min,
          `a kit with no saved watermark paints nothing in ${position} (luma ${q.min}..${q.max})`
        ).toBeLessThanOrEqual(4)
        const psnr = await regionPsnr(clean.outputPath, controlOut, QUADRANT[position])
        expect(psnr, `kit with none saved matches the control in ${position} (${psnr} dB)`).toBeGreaterThan(60)
      }
    },
    600_000
  )

  it.skipIf(process.platform === 'win32')(
    'KNOWN linux-binary gap: a Clip Kit job that carries the saved watermark dies at graph init naming drawtext, and the same job without it renders (same obsolescence condition as the pins above)',
    async () => {
      // The linux-runnable half of the kit's evidence. The two jobs below
      // differ in exactly one field, and that field is what decides whether
      // ffmpeg reaches `drawtext` at all: with the watermark the real runner
      // dies naming the filter (so the kit's job spec DID carry it into the
      // graph), without it the very same kit job encodes a 1080p file. A kit
      // that drops the watermark — the pre-T-85 behaviour — fails the first
      // assertion.
      await expect(
        runExportJob(await kitYoutubeJob(savedWatermark(), 'pin-marked'), () => {})
      ).rejects.toThrow(/No such filter: 'drawtext'/)

      const clean = await runExportJob(await kitYoutubeJob(null, 'pin-clean'), () => {})
      const probe = await ffprobeJson(clean.outputPath)
      const video = probe.streams.find((st) => st.codec_type === 'video')
      expect(video?.width).toBe(1920)
      expect(video?.height).toBe(1080)
    },
    180_000
  )
})

/**
 * T-50 — custom presets became real export targets, which means
 * `runExportJob` now resolves its encoder settings through
 * `resolveExportPreset` instead of indexing PLATFORM_PRESETS directly. The
 * unit tests either side of that assert what the resolved row LOOKS like;
 * only this layer proves ffmpeg accepts it and writes the bytes the user was
 * shown. (Auto Zoom shipped 100% broken behind green unit tests for exactly
 * this reason — see the round-18 zoompan lesson.)
 */
describe('custom export presets (real ffmpeg)', () => {
  const discord: CustomPreset = {
    id: 'cp-discord',
    name: 'Discord 1080p',
    width: 1280,
    height: 720,
    fps: 24,
    videoBitrate: '3M',
    audioBitrate: '96k',
    basePlatformId: 'reels'
  }

  function customJob(
    sourcePath: string,
    custom: CustomPreset,
    clip: Clip,
    jobId: string
  ): ExportJobSpec {
    return {
      jobId,
      sourcePath,
      outDir: workDir,
      clip,
      preset: custom.basePlatformId,
      customPreset: custom,
      outputFilename: `${jobId}.mp4`
    }
  }

  it('encodes at the custom size, NOT the base platform size', async () => {
    // The base is Reels (1080x1920 portrait). If the resolution ever falls
    // back to the platform row, this comes out portrait and fails loudly.
    const clip = makeClip()
    const res = await runExportJob(customJob(landscapeSrc, discord, clip, 'job-custom'), () => {})
    expect(existsSync(res.outputPath)).toBe(true)

    const info = await ffprobeJson(res.outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    expect(v?.width).toBe(1280)
    expect(v?.height).toBe(720)
    expect(v?.width).not.toBe(PLATFORM_PRESETS.reels.width)
    expect(v?.height).not.toBe(PLATFORM_PRESETS.reels.height)
    expect(v?.codec_name).toBe('h264')
    expect(v?.pix_fmt).toBe('yuv420p')
    expect(a?.codec_name).toBe('aac')
    await assertFaststart(res.outputPath)
  })

  it('honours the custom frame rate', async () => {
    // Every platform row is 30 fps, so 24 can only have come from the
    // custom preset's own `-r`.
    const clip = makeClip()
    const res = await runExportJob(customJob(landscapeSrc, discord, clip, 'job-custom-fps'), () => {})
    const info = await ffprobeJson(res.outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.avg_frame_rate).toBe('24/1')
  })

  it('crops to the CUSTOM aspect — the same geometry the equivalent platform preset produces', async () => {
    // Reels is 9:16. A 16:9 custom preset built on it must auto-crop the
    // 9:16 source to 16:9 and scale, NOT squash a portrait frame into a
    // landscape box. The reference is X/Twitter: same 1280x720, same 16:9,
    // straight off the platform table — so if the custom path resolves its
    // aspect correctly the two files are geometrically identical.
    const clip = makeClip({ startSec: 0.5, endSec: 3 })
    const custom = await runExportJob(
      customJob(portraitSrc, discord, clip, 'job-custom-crop'),
      () => {}
    )
    const platform = await runExportJob(
      makeJob(portraitSrc, 'twitter', clip, 'job-platform-crop'),
      () => {}
    )
    const cv = (await ffprobeJson(custom.outputPath)).streams.find((s) => s.codec_type === 'video')
    const pv = (await ffprobeJson(platform.outputPath)).streams.find(
      (s) => s.codec_type === 'video'
    )
    expect(cv?.width).toBe(1280)
    expect(cv?.height).toBe(720)
    expect(cv?.width).toBe(pv?.width)
    expect(cv?.height).toBe(pv?.height)
    // Sample and display aspect included. The point of the equality is that
    // a custom preset does exactly what a platform preset does, whatever
    // that is — it holds independently of what the shared value happens to
    // be, which is why it survived T-65 unchanged. What that value IS was
    // the finding recorded here in round 37: both came out SAR 405:404
    // (`autoCropForAspect` snaps the crop to even pixels and ffmpeg banked
    // the ~0.25% as sample aspect). T-65 fixed that in the shared
    // scaleFilter, so both now read 1:1 / 16:9 — pinned absolutely below so
    // this test also fails if the two paths agree on the WRONG value.
    expect(cv?.sample_aspect_ratio).toBe(pv?.sample_aspect_ratio)
    expect(cv?.display_aspect_ratio).toBe(pv?.display_aspect_ratio)
    expect(cv?.sample_aspect_ratio).toBe('1:1')
    expect(cv?.display_aspect_ratio).toBe('16:9')
  })

  it('runs a custom preset with the same effects the platform presets take', async () => {
    // autoZoom writes the preset dimensions into zoompan's `s=`; on a custom
    // preset that has to be the custom size or ffmpeg silently resizes to
    // hd720 (the round-18 bug, one table over).
    const clip = makeClip({ autoZoom: true, hypeShake: true, speedMultiplier: 2, endSec: 3 })
    const res = await runExportJob(customJob(landscapeSrc, discord, clip, 'job-custom-fx'), () => {})
    const info = await ffprobeJson(res.outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1280)
    expect(v?.height).toBe(720)
  })

  it('two custom presets on the same base land in separate files', async () => {
    // The fallback filename used to be keyed on the base platform id, which
    // made two custom presets built on Reels overwrite each other.
    const small: CustomPreset = { ...discord, id: 'cp-small', name: 'Discord small', width: 640, height: 360 }
    const clip = makeClip({ endSec: 2.5 })
    const a = await runExportJob(
      { jobId: 'job-dup-a', sourcePath: landscapeSrc, outDir: workDir, clip, preset: 'reels', customPreset: discord },
      () => {}
    )
    const b = await runExportJob(
      { jobId: 'job-dup-b', sourcePath: landscapeSrc, outDir: workDir, clip, preset: 'reels', customPreset: small },
      () => {}
    )
    expect(a.outputPath).not.toBe(b.outputPath)
    expect((await ffprobeJson(a.outputPath)).streams.find((s) => s.codec_type === 'video')?.width).toBe(1280)
    expect((await ffprobeJson(b.outputPath)).streams.find((s) => s.codec_type === 'video')?.width).toBe(640)
  })

  it('T-111: an odd custom size exports, snapped to the even pixels yuv420p needs', async () => {
    // The form accepts 1081x607 and libx264 refuses an odd side outright
    // ("width not divisible by 2"), so every export made with such a preset used
    // to fail. The resolved row is snapped to 1080x606 and every stage — scale,
    // the aspect cut, zoompan's `s=` — reads that row. A landscape source and a
    // portrait one, because the aspect cut takes a different branch for each,
    // and Auto Zoom, whose `s=` is the one place the size is written twice.
    const odd: CustomPreset = { ...discord, id: 'cp-odd', name: 'Odd 1081x607', width: 1081, height: 607 }
    for (const [src, label] of [[landscapeSrc, 'landscape'], [portraitSrc, 'portrait']] as const) {
      const res = await runExportJob(
        customJob(src, odd, makeClip({ endSec: 3 }), `job-odd-${label}`),
        () => {}
      )
      const info = await ffprobeJson(res.outputPath)
      const v = info.streams.find((s) => s.codec_type === 'video')
      expect(v?.width, `${label}: width`).toBe(1080)
      expect(v?.height, `${label}: height`).toBe(606)
      expect(v?.codec_name).toBe('h264')
      expect(v?.pix_fmt).toBe('yuv420p')
    }
    const zoomed = await runExportJob(
      customJob(landscapeSrc, odd, makeClip({ endSec: 3, autoZoom: true }), 'job-odd-zoom'),
      () => {}
    )
    const zv = (await ffprobeJson(zoomed.outputPath)).streams.find((s) => s.codec_type === 'video')
    expect([zv?.width, zv?.height]).toEqual([1080, 606])
  })

  it('a job with no customPreset is byte-for-byte the platform path', async () => {
    // The negative half: adding the field must not have changed what a
    // plain platform export produces.
    const clip = makeClip()
    const res = await runExportJob(makeJob(landscapeSrc, 'reels', clip, 'job-nocustom'), () => {})
    const info = await ffprobeJson(res.outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(PLATFORM_PRESETS.reels.width)
    expect(v?.height).toBe(PLATFORM_PRESETS.reels.height)
    expect(v?.avg_frame_rate).toBe('30/1')
  })
})

describe('gif export (real ffmpeg)', () => {
  it('produces a real palette gif at requested width and fps', async () => {
    const { outputPath } = await runGifExport({
      jobId: 'gif1',
      sourcePath: landscapeSrc,
      outDir: workDir,
      startSec: 0,
      endSec: 2,
      width: 320,
      fps: 12,
      speed: 1
    })
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.codec_name).toBe('gif')
    expect(v?.width).toBe(320)
    expect(v?.height).toBe(180)
    expect(v?.avg_frame_rate).toBe('12/1')
  })

  it('speed 2x gif runs and shortens playback', async () => {
    const { outputPath } = await runGifExport({
      jobId: 'gif2',
      sourcePath: landscapeSrc,
      outDir: workDir,
      startSec: 0,
      endSec: 2,
      width: 160,
      fps: 10,
      speed: 2
    })
    // GIF containers don't carry format.duration reliably — count frames
    // instead: 2s of source at 2x speed and 10 fps ≈ 10 frames.
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.avg_frame_rate).toBe('10/1')
    const frames = await new Promise<number>((resolve, reject) => {
      const child = spawn(ffprobePath, [
        '-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=nb_read_frames',
        '-print_format', 'json', outputPath
      ])
      let out = ''
      child.stdout.on('data', (b) => (out += String(b)))
      child.on('error', reject)
      child.on('close', () =>
        resolve(Number(JSON.parse(out).streams?.[0]?.nb_read_frames ?? 0))
      )
    })
    expect(frames).toBeGreaterThan(7)
    expect(frames).toBeLessThan(14)
  })
})

describe('audio chain (real ffmpeg)', () => {
  function makeAudioSpec(
    chain: Partial<ChainSpec>,
    out: string,
    jobId: string,
    format: AudioExportSpec['format'] = 'wav'
  ): AudioExportSpec {
    return {
      jobId,
      sourcePath: voiceWav,
      outputPath: path.join(workDir, out),
      chain: { ...DEFAULT_CHAIN_SPEC, ...chain },
      format
    }
  }

  it('two-pass loudnorm lands within 1 LU of the -16 target', async () => {
    const spec = makeAudioSpec(
      { loudnorm: true, loudnormTargetLufs: -16, denoise: 'medium', compressor: 'voice', rumbleHighpass: true },
      'loudnorm.wav',
      'aud-loudnorm'
    )
    const res = await runAudioExport(spec, () => {})
    // voiceWav is MONO: "-16" is what a stereo playback hears (T-123 (11)), so it is read on the dual-mono meter.
    const lufs = await measureLufs(res.outputPath, true)
    expect(lufs).toBeGreaterThan(-17)
    expect(lufs).toBeLessThan(-15)
  })

  describe('a silent input through the two-pass loudness render (T-114)', () => {
    // Pass 1 over silence prints `input_i: "-inf"` and `target_offset: "inf"`; pass 2 used to hand
    // them back as `measured_I=-inf`, which loudnorm's option range [-99, 0] refuses, so a muted
    // mic or a game-only capture could not be exported with "Match loudness" on. `anullsrc` makes
    // true silence (a sine at volume 0 would too, but this is the generator a person's silent
    // track really is). The fixture is checked first: the trap must be present in what pass 1
    // prints, or a pass is no evidence.
    let silentWav = ''

    beforeAll(async () => {
      silentWav = path.join(workDir, 'silent.wav')
      await ff(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '4', silentWav])
    })

    it('the fixture really is silence: pass 1 prints -inf for its loudness', async () => {
      const { stderr } = await ff([
        '-hide_banner', '-i', silentWav,
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'
      ])
      expect(stderr).toMatch(/"input_i"\s*:\s*"-inf"/)
      expect(stderr).toMatch(/"target_offset"\s*:\s*"inf"/)
    })

    it('exports successfully (single-pass fallback) and is still silence, the length it was', async () => {
      const spec: AudioExportSpec = {
        jobId: 'aud-silent-loudnorm',
        sourcePath: silentWav,
        outputPath: path.join(workDir, 'silent-loudnorm.wav'),
        chain: { ...DEFAULT_CHAIN_SPEC, loudnorm: true, loudnormTargetLufs: -16 },
        format: 'wav'
      }
      const passes: string[] = []
      const res = await runAudioExport(spec, (p) => passes.push(p.pass))
      expect(passes).toContain('measure')
      expect(passes).toContain('render')
      const probe = await probeAudio(res.outputPath)
      expect(Math.abs(probe.duration - 4)).toBeLessThan(0.3)
      const { stderr } = await ff(['-hide_banner', '-i', res.outputPath, '-af', 'volumedetect', '-f', 'null', '-'])
      const max = stderr.match(/max_volume:\s*(-?[\d.]+|-inf)\s*dB/)
      expect(max, 'volumedetect reported a level').not.toBeNull()
      expect(Number(max?.[1]), 'nothing was invented out of silence').toBeLessThan(-60)
    }, 120_000)

    it('the control: a track with sound still gets the measured two-pass render', async () => {
      const spec = makeAudioSpec({ loudnorm: true, loudnormTargetLufs: -16 }, 'loud-control.wav', 'aud-loud-control')
      const res = await runAudioExport(spec, () => {})
      const lufs = await measureLufs(res.outputPath, true) // a mono source: judged as a stereo playback hears it (T-123 (11))
      expect(lufs).toBeGreaterThan(-17)
      expect(lufs).toBeLessThan(-15)
    }, 120_000)
  })

  /**
   * T-123 (10) and (11): what a single-track export promises about its peaks and its loudness label.
   *
   * (10) The mix bus "always ends in a stage that answers for its peaks" (T-111); the single-track path had none unless Even
   * volume was on: +12 dB of Manual gain on a -2 dBFS source exported at 0.0 dBFS, a flat-topped wave, and nothing in the app
   * warned (the preview plays the unprocessed source). A chain with any stage now ends in the mix bus's own limiter
   * (`alimiter`, -1 dBFS, `level=disabled`), and a bare pass-through ('anull') stays untouched: a file that is exported with
   * nothing switched on is the file that went in.
   *
   * (11) EBU R128 counts a mono file as ONE channel, but every stereo playback of it is dual mono: both speakers carry the
   * channel, 3 LU hotter than the meter said. Even volume's "-16" on a mono source landed at -13.0 on the dual-mono meter.
   * `loudnorm`'s `dual_mono=true`, on BOTH passes, measures and corrects it the way it will be played.
   */
  describe('a single-track export answers for its peaks and its loudness label (T-123 (10), (11))', () => {
    let hotWav = '' // 4 s of 300 Hz, peaking at -2 dBFS
    let hotterWav = '' // the same at -0.3 dBFS: over the limiter's -1 dBFS ceiling before any gain
    let hotter48Wav = '' // the same at 48 kHz, the export's own rate: no resample after the limiter (T-124 (32), see the cut case)
    let quietWav = '' // the same at -18 dBFS
    let monoTone = '' // 12 s of 1 kHz, mono
    let stereoTone = '' // the same tone in two channels

    async function peakOf(file: string): Promise<number> {
      const { stderr } = await ff(['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
      const m = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/)
      if (!m) throw new Error('no volumedetect output')
      return Number(m[1])
    }

    const exportOf = (source: string, chain: Partial<ChainSpec>, name: string): Promise<string> =>
      runAudioExport(
        { jobId: `t123-${name}`, sourcePath: source, outputPath: path.join(workDir, `t123-${name}.wav`), chain: { ...DEFAULT_CHAIN_SPEC, ...chain }, format: 'wav' },
        () => {}
      ).then((r) => r.outputPath)

    beforeAll(async () => {
      const tone = (name: string, args: string[]): Promise<string> => {
        const out = path.join(workDir, name)
        return ff(['-y', '-f', 'lavfi', '-i', args[0] as string, ...args.slice(1), out]).then(() => out)
      }
      hotWav = await tone('t123-hot.wav', ['sine=frequency=300:sample_rate=44100:duration=4,volume=16dB'])
      hotterWav = await tone('t123-hotter.wav', ['sine=frequency=300:sample_rate=44100:duration=4,volume=17.7dB'])
      hotter48Wav = await tone('t123-hotter48.wav', ['sine=frequency=300:sample_rate=48000:duration=4,volume=17.7dB'])
      quietWav = await tone('t123-quiet.wav', ['sine=frequency=300:sample_rate=44100:duration=4'])
      monoTone = await tone('t123-mono.wav', ['sine=frequency=1000:sample_rate=44100:duration=12'])
      stereoTone = await tone('t123-stereo.wav', ['sine=frequency=1000:sample_rate=44100:duration=12', '-ac', '2'])
    }, 120_000)

    it('the fixtures are what the cases say they are (a -2 dBFS source, a -0.3 dBFS one, a -18 dBFS one; mono and stereo)', async () => {
      expect(await peakOf(hotWav)).toBeGreaterThan(-2.3)
      expect(await peakOf(hotWav)).toBeLessThan(-1.8)
      expect(await peakOf(hotterWav)).toBeGreaterThan(-0.5)
      expect(await peakOf(hotterWav)).toBeLessThan(-0.15)
      expect(await peakOf(hotter48Wav)).toBeGreaterThan(-0.5)
      expect(await peakOf(hotter48Wav)).toBeLessThan(-0.15)
      expect((await probeAudio(hotter48Wav)).sampleRate).toBe(48000)
      expect(await peakOf(quietWav)).toBeLessThan(-17.5)
      expect((await probeAudio(monoTone)).channels).toBe(1)
      expect((await probeAudio(stereoTone)).channels).toBe(2)
      // The trap in (11): the same mono file reads 3 LU hotter on the dual-mono meter than on the plain one.
      expect((await measureLufs(monoTone, true)) - (await measureLufs(monoTone))).toBeGreaterThan(2.8)
    })

    it('+12 dB of Manual gain on a -2 dBFS source is limited to -1 dBFS, not clipped at full scale', async () => {
      const out = await exportOf(hotWav, { gainDb: 12 }, 'hot-gain')
      const peak = await peakOf(out)
      expect(peak, `exports at ${peak} dBFS (0.0 is a flat-topped wave)`).toBeLessThan(-0.9)
      // Limited, not muted: it is still the loud signal it was asked to be.
      expect(peak).toBeGreaterThan(-1.3)
    })

    it('a quiet source is not re-leveled by the limiter: +6 dB lands 6 dB higher', async () => {
      const before = await peakOf(quietWav)
      const peak = await peakOf(await exportOf(quietWav, { gainDb: 6 }, 'quiet-gain'))
      expect(Math.abs(peak - (before + 6)), `${before} dBFS + 6 dB should read ${before + 6}, read ${peak}`).toBeLessThan(0.3)
    })

    it('any chain with a stage ends in the limiter, a cut-only chain included', async () => {
      const highpass = await peakOf(await exportOf(hotterWav, { rumbleHighpass: true }, 'hotter-highpass'))
      expect(highpass, `rumble filter on a -0.3 dBFS source peaks at ${highpass}`).toBeLessThan(-0.9)
      // T-124 (32): the cut case runs on the export's own 48 kHz. The export is written at 48 kHz (`-ar 48000`), and the resampler
      // that makes it so sits AFTER the limiter: on a 44.1 kHz source a cut's seam (two phases of a sine butted together) rings
      // in it and can pass the limiter's ceiling. Measured on the 44.1 kHz fixture over 24 cuts: 11 of 24 peaked above -0.9 dBFS
      // (to 0.0) on the decoder's own block grid and 6 of 24 on the 256-sample one, so the old pass at 1-2 s was where the seam
      // happened to land, not a property of the limiter. The limiter is what this case is about; the resample overshoot is
      // ledgered as found, not fixed (round 74).
      const cut = await peakOf(await exportOf(hotter48Wav, { cutRegions: [{ startSec: 1, endSec: 2 }] }, 'hotter48-cut'))
      expect(cut, `a cut on a -0.3 dBFS 48 kHz source peaks at ${cut}`).toBeLessThan(-0.9)
    })

    it('a bare pass-through is not touched: nothing switched on exports the file that went in', async () => {
      const before = await peakOf(hotterWav)
      const out = await exportOf(hotterWav, {}, 'hotter-bare')
      expect(Math.abs((await peakOf(out)) - before), 'the peak is unchanged (the limiter would have taken it to -1 dBFS)').toBeLessThan(0.05)
    })

    it('Even volume on a mono source lands on its label on the meter a stereo playback uses (-16 on dual mono, not -13)', async () => {
      const out = await exportOf(monoTone, { loudnorm: true, loudnormTargetLufs: -16 }, 'mono-loudnorm')
      expect((await probeAudio(out)).channels, 'the export is still mono: nothing was upmixed to hide the difference').toBe(1)
      const lufs = await measureLufs(out, true)
      expect(lufs, `a stereo playback of the mono export reads ${lufs} LUFS against the -16 label`).toBeGreaterThan(-17)
      expect(lufs).toBeLessThan(-15)
    }, 120_000)

    it('the control: a stereo source is unchanged, on target on the plain meter', async () => {
      const out = await exportOf(stereoTone, { loudnorm: true, loudnormTargetLufs: -16 }, 'stereo-loudnorm')
      const lufs = await measureLufs(out)
      expect(lufs).toBeGreaterThan(-17)
      expect(lufs).toBeLessThan(-15)
    }, 120_000)
  })

  it('mp3 export with full cleanup chain succeeds', async () => {
    const spec = makeAudioSpec(
      { denoise: 'aggressive', hum60: true, deEss: true, compressor: 'mixed', gainDb: 2 },
      'clean.mp3',
      'aud-mp3',
      'mp3'
    )
    const res = await runAudioExport(spec, () => {})
    const info = await ffprobeJson(res.outputPath)
    const a = info.streams.find((s) => s.codec_type === 'audio')
    expect(a?.codec_name).toBe('mp3')
    expect(Number(a?.sample_rate)).toBe(48000)
  })

  it('cut regions shorten the output by the cut length', async () => {
    const spec = makeAudioSpec(
      { cutRegions: [{ startSec: 2, endSec: 4 }] },
      'cuts.wav',
      'aud-cuts'
    )
    const res = await runAudioExport(spec, () => {})
    const probe = await probeAudio(res.outputPath)
    expect(probe.duration).toBeGreaterThan(5.4)
    expect(probe.duration).toBeLessThan(6.6)
  })

  it('secondary track mixes without ducking', async () => {
    const spec = makeAudioSpec(
      {
        secondaryTrack: {
          filePath: musicWav,
          fileName: 'music.wav',
          role: 'music',
          gainDb: 0,
          duckUnderPrimary: false
        }
      },
      'mix.wav',
      'aud-mix'
    )
    const res = await runAudioExport(spec, () => {})
    const probe = await probeAudio(res.outputPath)
    expect(probe.duration).toBeGreaterThan(7.4)
    // The 3 kHz secondary must actually be present in the mix.
    const level = await bandMeanVolume(res.outputPath, 2.2, 1.5, 3000)
    expect(level).toBeGreaterThan(-40)
  })

  it('sidechain ducking actually ducks the secondary under the primary', async () => {
    const spec = makeAudioSpec(
      {
        secondaryTrack: {
          filePath: musicWav,
          fileName: 'music.wav',
          role: 'music',
          gainDb: 0,
          duckUnderPrimary: true
        }
      },
      'duck.wav',
      'aud-duck'
    )
    const res = await runAudioExport(spec, () => {})
    // Primary (300 Hz) is loud on 0-2s / 4-6s and silent on 2-4s / 6-8s.
    // Isolate the 3 kHz secondary in both windows: with working ducking it
    // must be meaningfully quieter while the primary is talking.
    const duckedLevel = await bandMeanVolume(res.outputPath, 0.4, 1.2, 3000)
    const openLevel = await bandMeanVolume(res.outputPath, 2.4, 1.2, 3000)
    expect(openLevel - duckedLevel).toBeGreaterThan(3)
  })

  /**
   * T-111 — amix's default `normalize=1` scales each input by 1/N, where N is
   * the number of inputs STILL RUNNING. Every mix fixture above is as long as its
   * music bed, so the survivor never had a moment to be alone; a bed shorter than
   * the voice (a 3-minute track under a 40-minute stream) ends mid-recording and
   * the voice steps up 6 dB the instant it does. The fixtures here are the case
   * that matters: a steady 300 Hz voice for 8 s under a 3 kHz bed that stops at
   * 3 s, and the voice's OWN band (a bandpass isolates it from the bed) measured
   * a second before the bed ends and a second after.
   */
  describe('the voice is one level when a shorter music bed ends (T-111)', () => {
    const BED_END = 3
    let steadyVoice = ''
    let shortBed = ''
    let hotVoice = ''
    let hotBed = ''

    beforeAll(async () => {
      steadyVoice = path.join(workDir, 'steady-voice.wav')
      shortBed = path.join(workDir, 'short-bed.wav')
      hotVoice = path.join(workDir, 'hot-voice.wav')
      hotBed = path.join(workDir, 'hot-bed.wav')
      await ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100:duration=8', '-ac', '1', steadyVoice])
      await ff(['-y', '-f', 'lavfi', '-i', `sine=frequency=3000:sample_rate=44100:duration=${BED_END}`, '-ac', '2', shortBed])
      // `sine` peaks at 0.125; volume=7 puts both at -1.2 dBFS, so their sum would
      // pass full scale at every moment their peaks line up.
      await ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100:duration=4,volume=7', '-ac', '1', hotVoice])
      await ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=3000:sample_rate=44100:duration=4,volume=7', '-ac', '2', hotBed])
    })

    function mixSpec(chain: Partial<ChainSpec>, out: string, jobId: string, voice = steadyVoice, bed = shortBed): AudioExportSpec {
      return {
        jobId,
        sourcePath: voice,
        outputPath: path.join(workDir, out),
        chain: {
          ...DEFAULT_CHAIN_SPEC,
          ...chain,
          secondaryTrack: {
            filePath: bed,
            fileName: path.basename(bed),
            role: 'music',
            gainDb: 0,
            duckUnderPrimary: false,
            ...chain.secondaryTrack
          }
        },
        format: 'wav'
      }
    }

    /** The voice's level (dB, its own band) 2-1 s before the bed ends and 0.3-1.3 s after. */
    async function voiceAroundBedEnd(file: string): Promise<{ before: number; after: number; bedBefore: number; bedAfter: number }> {
      return {
        before: await bandMeanVolume(file, BED_END - 2, 1, 300),
        after: await bandMeanVolume(file, BED_END + 0.3, 1, 300),
        bedBefore: await bandMeanVolume(file, BED_END - 2, 1, 3000),
        bedAfter: await bandMeanVolume(file, BED_END + 0.3, 1, 3000)
      }
    }

    async function peakDb(file: string): Promise<number> {
      const { stderr } = await ff(['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
      const m = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/)
      if (!m) throw new Error('no volumedetect output')
      return Number(m[1])
    }

    it('manual gain: the voice does not step when the bed ends, and the bed really was there and then was not', async () => {
      const res = await runAudioExport(mixSpec({}, 'bed-end-manual.wav', 'aud-bedend-manual'), () => {})
      const m = await voiceAroundBedEnd(res.outputPath)
      expect(m.bedBefore, `the bed is in the mix before it ends (${m.bedBefore} dB)`).toBeGreaterThan(-40)
      expect(m.bedBefore - m.bedAfter, `and gone after (${m.bedBefore} dB -> ${m.bedAfter} dB)`).toBeGreaterThan(25)
      expect(
        Math.abs(m.after - m.before),
        `the voice before (${m.before} dB) and after (${m.after} dB) the bed ends differ by under 1 dB`
      ).toBeLessThan(1)
    })

    it('with ducking: the voice is the same one level (the duck acts on the bed, never on the voice)', async () => {
      const res = await runAudioExport(
        mixSpec({ secondaryTrack: { duckUnderPrimary: true } as ChainSpec['secondaryTrack'] }, 'bed-end-duck.wav', 'aud-bedend-duck'),
        () => {}
      )
      const m = await voiceAroundBedEnd(res.outputPath)
      expect(
        Math.abs(m.after - m.before),
        `ducked: the voice before (${m.before} dB) and after (${m.after} dB) the bed ends differ by under 1 dB`
      ).toBeLessThan(1)
    })

    it('a bed with +6 dB of gain sits 6 dB higher and still leaves the voice where it was', async () => {
      // The weights are the user's: normalize=0 means the bed's gain is the only thing
      // that sets how loud it sits.
      const flat = await runAudioExport(mixSpec({}, 'gain-0.wav', 'aud-gain-0'), () => {})
      const loud = await runAudioExport(
        mixSpec({ secondaryTrack: { gainDb: 6 } as ChainSpec['secondaryTrack'] }, 'gain-6.wav', 'aud-gain-6'),
        () => {}
      )
      const a = await voiceAroundBedEnd(flat.outputPath)
      const b = await voiceAroundBedEnd(loud.outputPath)
      expect(b.bedBefore - a.bedBefore, 'the bed is 6 dB hotter').toBeGreaterThan(5)
      expect(b.bedBefore - a.bedBefore).toBeLessThan(7)
      expect(Math.abs(b.before - a.before), 'the voice did not move').toBeLessThan(1)
    })

    it('match loudness + a target: the mix is still on target and the voice is not stepped by the mixer', async () => {
      const res = await runAudioExport(
        mixSpec(
          { loudnorm: true, loudnormTargetLufs: -16, secondaryTrack: { matchLoudness: true } as ChainSpec['secondaryTrack'] },
          'bed-end-match.wav',
          'aud-bedend-match'
        ),
        () => {}
      )
      const lufs = await measureLufs(res.outputPath)
      expect(lufs).toBeGreaterThan(-18)
      expect(lufs).toBeLessThan(-14)
      const m = await voiceAroundBedEnd(res.outputPath)
      // The mix-bus loudnorm may re-level the voice a little when a whole bed leaves (its job is
      // to hold the MIX at the target; measured here: 0.7 dB), but not by the mixer's own 6 dB.
      expect(
        Math.abs(m.after - m.before),
        `the voice before (${m.before} dB) and after (${m.after} dB) the bed ends differ by under 2 dB`
      ).toBeLessThan(2)
    })

    it('manual gain: two hot tracks that sum past full scale are limited, not clipped', async () => {
      const res = await runAudioExport(
        mixSpec({}, 'hot-manual.wav', 'aud-hot-manual', hotVoice, hotBed),
        () => {}
      )
      const peak = await peakDb(res.outputPath)
      expect(peak, `the mix peaks at ${peak} dB, under the -1 dBFS limit (full scale would be clipping)`).toBeLessThan(-0.9)
      // Limited, not muted: both tracks are still audible in it.
      expect(await bandMeanVolume(res.outputPath, 0.5, 1, 300)).toBeGreaterThan(-20)
      expect(await bandMeanVolume(res.outputPath, 0.5, 1, 3000)).toBeGreaterThan(-20)
    })

    it('manual gain: a quiet mix is not re-leveled by the limiter', async () => {
      // alimiter's default raises its output back toward the limit (measured: a -18.1 dB
      // peak came out -17.1). The voice alone is the reference: upmixed from mono to the
      // mix's stereo it sits exactly 3 dB lower per channel, and the music is not in the
      // second the voice is measured in, so the mix must read the voice at that, no higher.
      const solo = await runAudioExport(
        { jobId: 'aud-solo', sourcePath: steadyVoice, outputPath: path.join(workDir, 'solo.wav'), chain: { ...DEFAULT_CHAIN_SPEC }, format: 'wav' },
        () => {}
      )
      const mixed = await runAudioExport(mixSpec({}, 'quiet-mix.wav', 'aud-quiet-mix'), () => {})
      const soloLevel = await bandMeanVolume(solo.outputPath, 4, 2, 300)
      const mixedLevel = await bandMeanVolume(mixed.outputPath, 4, 2, 300)
      expect(
        Math.abs(mixedLevel - (soloLevel - 3.01)),
        `mix ${mixedLevel} dB vs the voice alone ${soloLevel} dB less the 3 dB mono-to-stereo upmix`
      ).toBeLessThan(0.5)
    })
  })

  it('match-loudness secondary mix lands near the loudness target', async () => {
    const spec = makeAudioSpec(
      {
        loudnorm: true,
        loudnormTargetLufs: -16,
        secondaryTrack: {
          filePath: musicWav,
          fileName: 'music.wav',
          role: 'music',
          gainDb: 0,
          duckUnderPrimary: false,
          matchLoudness: true
        }
      },
      'match.wav',
      'aud-match'
    )
    const res = await runAudioExport(spec, () => {})
    expect(existsSync(res.outputPath)).toBe(true)
    // Round 18: amix's default normalize halved each input, so a mix of
    // two on-target tracks used to land ~3 LU quiet. The post-mix loudnorm
    // now restores the requested target (single-pass tolerance: ±2 LU).
    const lufs = await measureLufs(res.outputPath)
    expect(lufs).toBeGreaterThan(-18)
    expect(lufs).toBeLessThan(-14)
  })

  it('a cut applies to the mix, music included (T-82)', async () => {
    // voiceWav is loud 0-2 s and 4-6 s, silent 2-4 s and 6-8 s; musicWav is a
    // constant 3 kHz tone for all 8 s. Cutting 2 -> 4 s used to cut only the
    // voice: the 8 s of music then set the length of the mix (amix keeps the
    // longest input), so the "6 s" export came out 8 s long.
    const spec = makeAudioSpec(
      {
        cutRegions: [{ startSec: 2, endSec: 4 }],
        secondaryTrack: {
          filePath: musicWav,
          fileName: 'music.wav',
          role: 'music',
          gainDb: 0,
          duckUnderPrimary: false
        }
      },
      'cut-mix.wav',
      'aud-cut-mix'
    )
    const res = await runAudioExport(spec, () => {})
    const probe = await probeAudio(res.outputPath)
    expect(probe.duration).toBeGreaterThan(5.75)
    expect(probe.duration).toBeLessThan(6.25)
    // The music is in what is left, right up to the new end.
    const level = await bandMeanVolume(res.outputPath, 4.4, 1.2, 3000)
    expect(level).toBeGreaterThan(-40)
  })

  it('a cut mix still ducks the music under the voice (T-82)', async () => {
    // Ducking keys off the primary, which now reaches the sidechain UNCUT and
    // is cut together with the music afterwards: the voice's loud 0-4 s of
    // output duck the music, its silent 4-6 s (source 6-8 s) do not. (A
    // sidechain ends with its shorter input, so this graph came out 6 s long
    // even before the fix — the length case above is the discriminating one.)
    const spec = makeAudioSpec(
      {
        cutRegions: [{ startSec: 2, endSec: 4 }],
        secondaryTrack: {
          filePath: musicWav,
          fileName: 'music.wav',
          role: 'music',
          gainDb: 0,
          duckUnderPrimary: true
        }
      },
      'cut-duck.wav',
      'aud-cut-duck'
    )
    const res = await runAudioExport(spec, () => {})
    const probe = await probeAudio(res.outputPath)
    expect(probe.duration).toBeGreaterThan(5.75)
    expect(probe.duration).toBeLessThan(6.25)
    const duckedLevel = await bandMeanVolume(res.outputPath, 0.4, 1.2, 3000)
    const openLevel = await bandMeanVolume(res.outputPath, 4.4, 1.2, 3000)
    expect(openLevel - duckedLevel).toBeGreaterThan(3)
  })

  it('the mix cut and the mix-bus loudnorm share one graph (T-82)', async () => {
    // matchLoudness + loudnorm puts a loudnorm on the mix bus; the cut sits
    // ahead of it in the same `[premix]...[mix]` segment, so a composition
    // slip shows up as ffmpeg rejecting the graph.
    const spec = makeAudioSpec(
      {
        loudnorm: true,
        loudnormTargetLufs: -16,
        cutRegions: [{ startSec: 2, endSec: 4 }],
        secondaryTrack: {
          filePath: musicWav,
          fileName: 'music.wav',
          role: 'music',
          gainDb: 0,
          duckUnderPrimary: true,
          matchLoudness: true
        }
      },
      'cut-match.wav',
      'aud-cut-match'
    )
    const res = await runAudioExport(spec, () => {})
    const probe = await probeAudio(res.outputPath)
    expect(probe.duration).toBeGreaterThan(5.75)
    expect(probe.duration).toBeLessThan(6.25)
    const lufs = await measureLufs(res.outputPath)
    expect(lufs).toBeGreaterThan(-18)
    expect(lufs).toBeLessThan(-14)
  })

  it('parametric denoise export succeeds across the whole slider range', async () => {
    // Pre-round-18 this path emitted an `ns` option afftdn doesn't have
    // (always) and allowed noise floors above -20 dB (a third of the old
    // slider), so Custom denoise exports failed 100% of the time.
    const spec = makeAudioSpec(
      { denoise: 'parametric', denoiseParams: { noiseFloorDb: -20, reductionDb: 1, sensitivity: 2 } },
      'parametric.wav',
      'aud-parametric'
    )
    const res = await runAudioExport(spec, () => {})
    expect(existsSync(res.outputPath)).toBe(true)
    const spec2 = makeAudioSpec(
      { denoise: 'parametric', denoiseParams: { noiseFloorDb: -80, reductionDb: 50, sensitivity: -2 } },
      'parametric2.wav',
      'aud-parametric2'
    )
    const res2 = await runAudioExport(spec2, () => {})
    expect(existsSync(res2.outputPath)).toBe(true)
  })

  it('dynamic de-esser filter parses and renders', async () => {
    const spec = makeAudioSpec({ deEss: true }, 'deess.wav', 'aud-deess')
    const res = await runAudioExport(spec, () => {})
    expect(existsSync(res.outputPath)).toBe(true)
  })

  it('hum removal notches the mains the user chose: 50 Hz clears 50/100, 60 Hz clears 60/120 (T-90)', async () => {
    // The notch is 2 Hz wide, so a tone one grid away from it is untouched: this
    // measures the graph ffmpeg actually built, which a string-shape test of
    // `bandreject=f=50` cannot (a filter that parses is not a filter that
    // lands on the right frequency). One pure tone per frequency, so a drop in
    // its own band can only be the notch.
    const TONES = [50, 60, 100, 120, 1000]
    const tone: Record<number, string> = {}
    for (const hz of TONES) {
      tone[hz] = path.join(workDir, `hum-tone-${hz}.wav`)
      await ff([
        '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=3:sample_rate=44100`,
        '-ac', '1', tone[hz] as string
      ])
    }
    async function levelOf(hz: number, hum: 'off' | 'default' | 50 | 60): Promise<number> {
      const chain: Partial<ChainSpec> =
        hum === 'off'
          ? {}
          : hum === 'default'
            ? { hum60: true } // no humHz — every project saved before 50 Hz existed
            : { hum60: true, humHz: hum }
      const res = await runAudioExport(
        {
          jobId: `hum-${hz}-${hum}`,
          sourcePath: tone[hz] as string,
          outputPath: path.join(workDir, `hum-${hz}-${hum}.wav`),
          chain: { ...DEFAULT_CHAIN_SPEC, ...chain },
          format: 'wav'
        },
        () => {}
      )
      // Past the filter's settling time (a 2 Hz notch rings for ~0.2 s).
      return bandMeanVolume(res.outputPath, 1, 1.5, hz)
    }
    const NOTCHED: Record<string, number[]> = { '50': [50, 100], '60': [60, 120], default: [60, 120] }
    for (const hum of [50, 60, 'default'] as const) {
      for (const hz of TONES) {
        const drop = (await levelOf(hz, 'off')) - (await levelOf(hz, hum))
        if ((NOTCHED[String(hum)] as number[]).includes(hz)) {
          expect(drop, `${hum} Hz setting should remove the ${hz} Hz tone (dropped ${drop.toFixed(1)} dB)`).toBeGreaterThan(20)
        } else {
          expect(drop, `${hum} Hz setting must leave the ${hz} Hz tone alone (dropped ${drop.toFixed(1)} dB)`).toBeLessThan(1.5)
        }
      }
    }
  })

  it('AAC exports as a real .m4a container, where a bare .aac is a raw ADTS stream (T-90)', async () => {
    const ext = audioFileExtension('aac')
    expect(ext).toBe('m4a')
    const chain = { denoise: 'light' as const, loudnorm: true }
    const m4a = await runAudioExport(
      { ...makeAudioSpec(chain, `clean.${ext}`, 'aud-m4a', 'aac'), bitrate: '192k' },
      () => {}
    )
    const info = await ffprobeJson(m4a.outputPath)
    const a = info.streams.find((s) => s.codec_type === 'audio')
    // The codec did not change — only the container around it.
    expect(a?.codec_name).toBe('aac')
    expect(Number(a?.sample_rate)).toBe(48000)
    expect(info.format.format_name).toContain('m4a')
    // The bytes say so too: an MP4-family file opens with an `ftyp` box whose
    // major brand is M4A, which is what makes players call it audio.
    const head = (await readFile(m4a.outputPath)).subarray(4, 12).toString('latin1')
    expect(head).toBe('ftypM4A ')
    // The contrast that explains the change: the SAME encode named .aac is
    // headerless ADTS, with no container at all.
    const bare = await runAudioExport(
      { ...makeAudioSpec(chain, 'clean-bare.aac', 'aud-bare-aac', 'aac'), bitrate: '192k' },
      () => {}
    )
    expect((await ffprobeJson(bare.outputPath)).format.format_name).toBe('aac')
    // And it is audio you can decode end to end, with the length of the source.
    expect((await probeAudio(m4a.outputPath)).duration).toBeGreaterThan(7)
  })

  it('mux replaces video audio track with processed audio (faststart)', async () => {
    const out = path.join(workDir, 'muxed.mp4')
    await runAudioMux('mux1', landscapeSrc, voiceWav, out, () => {})
    const info = await ffprobeJson(out)
    expect(info.streams.some((s) => s.codec_type === 'video')).toBe(true)
    const a = info.streams.find((s) => s.codec_type === 'audio')
    expect(a?.codec_name).toBe('aac')
    await assertFaststart(out)
  })
})

describe('a cut is accurate to a 256-sample block, whatever block the decoder hands over (real ffmpeg, T-124 (32))', () => {
  // `aselect` keeps or drops whole FRAMES, and a frame is whatever the decoder produced: FLAC decodes in 4608-sample blocks
  // (96 ms at 48 kHz), ALAC in 4096 (85 ms), and the bundled 7.0.2's WAV demuxer hands 4096 where the distro's 6.1.1 gives 1024.
  // The cut therefore landed on the DECODER's grid, not on the 1024-sample audio frame the code comments claimed ("about 21 ms"):
  // the sweep measured per-cut errors of -77 ms on an ALAC source and -60 ms on a FLAC one through the real export, and the
  // picture (which retimes by the exact time removed, T-121) was out of step with the sound by the same amount. The T-82 block
  // below cuts a WAV the app extracted itself, so it never met a big block. `asetnsamples=n=256:p=0` ahead of `aselect` makes the
  // frame 256 samples whatever the decoder gave (5.3 ms at 48 kHz), so a cut's start and end each land within one such block:
  // the span removed is (b - a) +/- 256 samples. Each source is cut six times at times that are on no block size's grid.
  const RATE = 48000
  const BLOCK_SEC = 256 / RATE
  const SOURCE_SEC = 20
  const CUTS: Array<[number, number]> = [
    [3.0, 3.5],
    [5.123, 5.456],
    [7.7, 8.9],
    [10.01, 10.2],
    [12.6, 14.1],
    [15.55, 15.9]
  ]
  const SOURCES: Array<[string, string, string[]]> = [
    ['wav', 'wav', ['-c:a', 'pcm_s16le']],
    ['flac', 'flac', ['-c:a', 'flac']],
    ['alac', 'm4a', ['-c:a', 'alac']]
  ]
  const files = new Map<string, string>()
  let dir = ''

  beforeAll(async () => {
    dir = path.join(workDir, 't124-cutblock')
    await mkdir(dir, { recursive: true })
    for (const [name, ext, codec] of SOURCES) {
      const file = path.join(dir, `source-${name}.${ext}`)
      await ff([
        '-y', '-f', 'lavfi', '-i', `sine=frequency=500:sample_rate=${RATE}:duration=${SOURCE_SEC}`,
        '-ac', '2', ...codec, file
      ])
      files.set(name, file)
    }
  }, 120_000)

  /** The number of samples in the first frame the decoder hands the filter graph (`ashowinfo` prints `nb_samples:`). */
  async function firstDecodedBlock(file: string): Promise<number> {
    const { stderr } = await ff(['-hide_banner', '-i', file, '-af', 'ashowinfo', '-frames:a', '1', '-f', 'null', '-'])
    const m = stderr.match(/nb_samples:(\d+)/)
    if (!m) throw new Error(`no ashowinfo line for ${path.basename(file)}: ${stderr.slice(-300)}`)
    return Number(m[1])
  }

  it.each([['flac', 4608], ['alac', 4096]] as const)(
    'the %s fixture really hands the filter graph a big block (%i samples): the trap is in what is cut',
    async (name, block) => {
      expect(await firstDecodedBlock(files.get(name) as string)).toBe(block)
    }
  )

  it.each(SOURCES.map(([name]) => [name]))(
    'a %s source: each of six cuts removes what was asked for, to within one 256-sample block',
    async (name) => {
      const source = files.get(name as string) as string
      // The sources are lossless: the file is exactly SOURCE_SEC of samples, so the removed span is read off the output length.
      expect(Math.abs((await probeAudio(source)).duration - SOURCE_SEC)).toBeLessThan(0.0005)
      const errors: string[] = []
      let worst = 0
      for (const [i, [startSec, endSec]] of CUTS.entries()) {
        const spec: AudioExportSpec = {
          jobId: `t124-cutblock-${name}-${i}`,
          sourcePath: source,
          outputPath: path.join(dir, `out-${name}-${i}.wav`),
          chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [{ startSec, endSec }] },
          format: 'wav'
        }
        const res = await runAudioExport(spec, () => {})
        const removed = SOURCE_SEC - (await probeAudio(res.outputPath)).duration
        const err = removed - (endSec - startSec)
        worst = Math.max(worst, Math.abs(err))
        errors.push(`${startSec}-${endSec} s: ${(err * 1000).toFixed(1)} ms`)
      }
      expect(
        worst,
        `${name}: per-cut error ${errors.join(', ')} (one block is ${(BLOCK_SEC * 1000).toFixed(2)} ms)`
      ).toBeLessThan(BLOCK_SEC + 0.0002)
    },
    120_000
  )

  it('the block bound discriminates: a cut made on the decoder\'s own 4608-sample blocks (no re-chunking) misses by more than one 256-sample block', async () => {
    const out = path.join(dir, 'control-flac.wav')
    const [startSec, endSec] = CUTS[1] as [number, number]
    await ff([
      '-y', '-i', files.get('flac') as string,
      '-af', `aselect='not(between(t\\,${startSec.toFixed(3)}\\,${endSec.toFixed(3)}))',asetpts=N/SR/TB`, out
    ])
    const err = SOURCE_SEC - (await probeAudio(out)).duration - (endSec - startSec)
    expect(Math.abs(err), `the un-chunked cut is ${(err * 1000).toFixed(1)} ms off`).toBeGreaterThan(BLOCK_SEC + 0.0002)
  }, 60_000)
})

describe('the three denoise strengths are ordered by the noise they remove (real ffmpeg, T-125 (3))', () => {
  // afftdn's `nf` (the noise floor it assumes) and `nr` (how far it pulls down) point in opposite directions: raising the assumed
  // floor makes it remove MORE, and the presets had nf falling as nr rose (Light -25/12, Medium -30/18, Aggressive -35/24). On
  // the pink and brown "loud fan" noise at -44 dBFS that the panel sells Aggressive for, Aggressive removed 3.6-10.6 dB where
  // Light removed 8.7-12 dB (measured through the real export on both majors). The axis is swapped so the names are in the
  // order of their effect: Light -35/12, Medium -30/18, Aggressive -25/24.
  //
  // The fixture is 8 s of noise with a quiet two-tone phrase from 4 s on: the noise-only first 4 s is what is measured, in dB of
  // RMS before and after, 1.0-3.5 s (clear of any fade-in of the filter).
  const NOISE_ONLY = 'atrim=start=1:end=3.5'
  const TONES = "aevalsrc='if(gte(t,4),sin(2*PI*440*t)+0.5*sin(2*PI*880*t),0)':s=48000:d=8"
  let dir = ''

  const rmsDb = async (file: string): Promise<number> => {
    const { stderr } = await ff([
      '-hide_banner', '-nostats', '-i', file,
      '-af', `${NOISE_ONLY},astats=measure_perchannel=none:measure_overall=RMS_level`, '-f', 'null', '-'
    ])
    const found = [...stderr.matchAll(/RMS level dB:\s*(-?[\d.]+)/g)]
    return Number(found[found.length - 1]?.[1])
  }

  const fixture = async (color: 'pink' | 'brown', amplitude: number): Promise<string> => {
    const out = path.join(dir, `${color}-${amplitude}.wav`)
    await ff([
      '-y',
      '-f', 'lavfi', '-i', `anoisesrc=color=${color}:amplitude=${amplitude}:sample_rate=48000:duration=8:seed=7`,
      '-f', 'lavfi', '-i', TONES,
      '-filter_complex', '[1:a]volume=-20dB[t];[0:a][t]amix=inputs=2:normalize=0[o]',
      '-map', '[o]', '-c:a', 'pcm_s16le', out
    ])
    return out
  }

  const removed = async (input: string, strength: 'light' | 'medium' | 'aggressive', tag: string): Promise<number> => {
    const out = path.join(dir, `${tag}-${strength}.wav`)
    await runAudioExport(
      { jobId: `t125-dn-${tag}-${strength}`, sourcePath: input, outputPath: out, format: 'wav', chain: { ...DEFAULT_CHAIN_SPEC, denoise: strength } },
      () => {}
    )
    return (await rmsDb(input)) - (await rmsDb(out))
  }

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'imagii-t125-denoise-'))
  })
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it.each([
    ['pink', 0.03, 'loud fan noise (pink, -44.6 dBFS)'],
    ['brown', 0.03, 'loud air-conditioning rumble (brown, -44.3 dBFS)']
  ] as const)('%s noise at %s: Light removes less than Medium, which removes less than Aggressive', async (color, amplitude, what) => {
    const input = await fixture(color, amplitude)
    const tag = `${color}-${amplitude}`
    const light = await removed(input, 'light', tag)
    const medium = await removed(input, 'medium', tag)
    const aggressive = await removed(input, 'aggressive', tag)
    const line = `${what}: Light removes ${light.toFixed(1)} dB, Medium ${medium.toFixed(1)} dB, Aggressive ${aggressive.toFixed(1)} dB`
    expect(light, line).toBeLessThan(medium)
    expect(medium, line).toBeLessThan(aggressive)
  }, 120_000)
})

describe('the cut stage hands the rest of the chain 4096-sample frames and changes no sample (real ffmpeg, T-125 (5))', () => {
  // `asetnsamples=n=256` is the grid a cut needs (T-124 (32)), but it re-chunks the WHOLE chain, so every stage after the cut ran on
  // 256-sample frames: a chained cut export measured 1.7-2.3x slower on both majors (per-frame overhead in every filter after the
  // cut). `asetnsamples=n=4096:p=0` AFTER `asetpts=N/SR/TB` gives the rest of the chain big frames again; the cut has already been
  // made, so nothing it decided moves. Cost is not asserted (wall time is not a test); the frame size the next stage is handed is,
  // and so is the claim that makes the stage safe: the output is the same bytes with and without it.
  const CUTS = [
    { startSec: 1.234, endSec: 2.5 },
    { startSec: 4.1, endSec: 5.55 },
    { startSec: 7.0, endSec: 7.4 }
  ]
  let dir = ''
  let src = ''

  const withoutStage = (chain: string): string => chain.replace(',asetnsamples=n=4096:p=0', '')

  /** The chain `runAudioExport` would give ffmpeg for this export (the cuts leading), as the production builder writes it. */
  const chainFor = (extra: Partial<ChainSpec>): string =>
    buildChain({ ...DEFAULT_CHAIN_SPEC, ...extra, cutRegions: CUTS }).filterPass2

  const run = async (chain: string, out: string): Promise<string> => {
    const file = path.join(dir, out)
    await ff(['-y', '-i', src, '-af', chain, '-ar', '48000', '-c:a', 'pcm_s16le', file])
    return file
  }

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'imagii-t125-rechunk-'))
    src = path.join(dir, 'source.wav')
    // 10 s, 48 kHz stereo: a voice-like tone with a slow beat and some broadband hiss, so every stage after the cut has work to do.
    await ff([
      '-y',
      '-f', 'lavfi', '-i', "aevalsrc='0.3*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.5*t))|0.25*sin(2*PI*330*t)':s=48000:d=10",
      '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.02:sample_rate=48000:duration=10:seed=3',
      '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo[o]',
      '-map', '[o]', '-c:a', 'pcm_s16le', src
    ])
  }, 60_000)
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('the chain says so: the cut ends in the 4096 stage, after the retime', () => {
    expect(chainFor({})).toContain("asetpts=N/SR/TB,asetnsamples=n=4096:p=0")
  })

  it('every frame a stage after the cut is handed is 4096 samples (only the last may be short), and a stage ahead of the cut sees 256', async () => {
    const sizes = async (chain: string): Promise<number[]> => {
      const { stderr } = await ff(['-hide_banner', '-nostats', '-i', src, '-af', `${chain},ashowinfo`, '-f', 'null', '-'])
      return [...stderr.matchAll(/nb_samples:(\d+)/g)].map((m) => Number(m[1]))
    }
    const after = await sizes(chainFor({}))
    expect(after.length, 'frames reached the stage after the chain').toBeGreaterThan(10)
    const body = after.slice(0, -1)
    const wrong = body.filter((n) => n !== 4096)
    expect(wrong, `a frame after the cut that is not 4096 samples: ${[...new Set(wrong)].join(', ')} (of ${body.length})`).toEqual([])
    expect(after[after.length - 1], 'the last frame is whatever is left').toBeLessThanOrEqual(4096)
    // The grid the cut itself needs is untouched: ahead of the select, in the same chain, the frames are 256.
    const ahead = await sizes(`asetnsamples=n=256:p=0,ashowinfo,aselect='not(between(t\\,1.234\\,2.500))',asetpts=N/SR/TB`)
    expect(ahead.slice(0, -1).every((n) => n === 256), 'the cut still decides on a 256-sample grid').toBe(true)
  }, 60_000)

  it.each([
    ['a cut alone', {}],
    ['a cut followed by a high-pass, hum removal and a compressor', { rumbleHighpass: true, hum60: true, compressor: 'voice' as const }],
    ['a cut with denoise after it', { denoise: 'medium' as const }]
  ])('%s: the output is the same bytes with the stage and without it', async (what, extra) => {
    const chain = chainFor(extra)
    expect(chain, 'the production chain carries the stage').toContain(',asetnsamples=n=4096:p=0')
    const withIt = await run(chain, `with-${what.replace(/\W+/g, '-')}.wav`)
    const without = await run(withoutStage(chain), `without-${what.replace(/\W+/g, '-')}.wav`)
    expect(await fileSha(withIt), `${what}: the re-chunk changed a sample`).toBe(await fileSha(without))
  }, 120_000)
})

describe('audio cuts re-attached to video (real ffmpeg, T-82)', () => {
  // "Re-attach to video" used to render the cleaned audio (cut regions
  // CLOSED — `aselect` + `asetpts`, so the audio gets shorter) and mux it
  // onto the video with `-c:v copy -shortest`: a picture that was never cut.
  // From the first cut on, sound ran ahead of picture by the total cut length
  // and `-shortest` quietly threw away the video's last N seconds. Nothing
  // errored; every file looked fine in isolation.
  //
  // The fixture is the ramp: every video frame is a flat gray whose luma is
  // 12 * its own source second, and the audio is a quiet bed with one loud
  // burst at 10.0-11.5 s. Cutting 4 s -> 7 s (3 s) therefore has exactly one
  // right answer: the frame at output t shows source t (t < 4) or t + 3
  // (t >= 4), the burst lands at output 7.0-8.5, and the file is 17 s of
  // picture AND 17 s of sound. The audio goes through the real flow:
  // extractAudioFromVideo (the 48 kHz stereo track the Audio Studio loads),
  // then runAudioReattach (what the Export button's mux-back branch calls).
  const CUT = { startSec: 4, endSec: 7 }
  const CUT_LEN = CUT.endSec - CUT.startSec
  const SOURCE_LEN = 20
  const RAMP_FPS = 24
  const LUMA_PER_SEC = 12
  let outDir = ''
  const progress: Array<{ pass: string; percent: number }> = []

  async function reattach(
    name: string,
    cutRegions: Array<{ startSec: number; endSec: number }>,
    videoPath = rampSrc,
    chainExtra: Partial<ChainSpec> = {}
  ): Promise<{ outputPath: string; dir: string }> {
    const dir = path.join(outDir, name)
    await mkdir(dir, { recursive: true })
    const extracted = await extractAudioFromVideo(rampSrc)
    try {
      const outputPath = path.join(dir, 'ramp-cleaned.mp4')
      progress.length = 0
      await runAudioReattach(
        {
          jobId: `reattach-${name}`,
          videoPath,
          sourcePath: extracted.wavPath,
          outputPath,
          chain: { ...DEFAULT_CHAIN_SPEC, ...chainExtra, cutRegions }
        },
        (p) => progress.push({ pass: p.pass, percent: p.percent })
      )
      return { outputPath, dir }
    } finally {
      await extracted.cleanup()
    }
  }

  /** The frame at output second `outT` must be the source's second `srcT` (the ramp's luma is 12 x source second). */
  async function expectLumaAt(file: string, outT: number, srcT: number): Promise<void> {
    const luma = await meanLuma(file, outT)
    expect(
      Math.abs(luma - srcT * LUMA_PER_SEC),
      `frame at output ${outT} s reads luma ${luma}; source ${srcT} s is ${srcT * LUMA_PER_SEC}`
    ).toBeLessThan(8)
  }

  /** md5 of the video packets alone: equal iff the stream was copied, not re-encoded. */
  async function videoPacketMd5(file: string): Promise<string> {
    const { stdout } = await ff(['-hide_banner', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'md5', '-'])
    const m = stdout.match(/MD5=([0-9a-f]{32})/)
    if (!m) throw new Error(`no md5 for ${path.basename(file)}`)
    return m[1]
  }

  beforeAll(async () => {
    outDir = path.join(workDir, 'reattach')
    await mkdir(outDir, { recursive: true })
  })

  it('a cut removes the same span from the picture and the sound, and they end together', async () => {
    const { outputPath, dir } = await reattach('cut', [CUT])
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    expect(v?.codec_name).toBe('h264')
    expect(a?.codec_name).toBe('aac')

    const expected = SOURCE_LEN - CUT_LEN
    const vDur = Number(v?.duration)
    const aDur = Number(a?.duration)
    // Source minus cut — for BOTH streams (the picture used to stay at 20 s,
    // the sound at 17) — and equal to each other.
    expect(vDur, `video duration ${vDur}`).toBeGreaterThan(expected - 0.25)
    expect(vDur, `video duration ${vDur}`).toBeLessThan(expected + 0.25)
    expect(aDur, `audio duration ${aDur}`).toBeGreaterThan(expected - 0.25)
    expect(aDur, `audio duration ${aDur}`).toBeLessThan(expected + 0.25)
    expect(Math.abs(vDur - aDur), `video ${vDur} s vs audio ${aDur} s`).toBeLessThan(0.15)
    await assertFaststart(outputPath)

    // The re-encode keeps the source's cadence: setpts leaves the graph's
    // frame rate unknown, and on the bundled 7.0.x ffmpeg the fallback is a forced
    // 25 fps CFR (so a 24 fps recording came out at 25, with duplicated frames);
    // 6.1.1 keeps the rate and says nothing (T-122), so this is the control for 7.0.x.
    const [num, den] = (v?.avg_frame_rate ?? '0/1').split('/').map(Number)
    const fps = num / den
    expect(Math.abs(fps - RAMP_FPS), `output frame rate ${v?.avg_frame_rate}`).toBeLessThan(0.5)

    // The picture is cut where the audio is: before the cut it is the source,
    // after it the frame at output t is source second t + 3 — including the
    // very end, the part the old -shortest dropped.
    const expectLuma = (outT: number, srcT: number): Promise<void> =>
      expectLumaAt(outputPath, outT, srcT)
    await expectLuma(3.5, 3.5)
    await expectLuma(5.0, 5.0 + CUT_LEN)
    await expectLuma(16.0, 16.0 + CUT_LEN)

    // The sound: the burst (source 10.0-11.5 s) is at output 7.0-8.5 s, and the
    // picture under its first instant is source second 10. Together with the
    // luma reads above, that is "in step".
    const quietBefore = await bandMeanVolume(outputPath, 6.0, 0.8, 440)
    const burst = await bandMeanVolume(outputPath, 7.2, 1.1, 440)
    const quietAfter = await bandMeanVolume(outputPath, 8.7, 1.0, 440)
    expect(burst - quietBefore, `burst ${burst} dB vs before ${quietBefore} dB`).toBeGreaterThan(15)
    expect(burst - quietAfter, `burst ${burst} dB vs after ${quietAfter} dB`).toBeGreaterThan(15)
    await expectLuma(7.2, 10.2)

    // The picture is re-encoded, which takes real time, so the mux pass has
    // to report progress against a real duration (it used to be a stream copy
    // measured against 0, and would sit at 0% for the whole encode). Every
    // job ends with one synthetic 100% event, so "moved" means a SECOND
    // non-zero mux event — ffmpeg's own.
    const muxMoved = progress.filter((p) => p.pass === 'mux' && p.percent > 0)
    expect(muxMoved.length, `mux progress: ${JSON.stringify(muxMoved)}`).toBeGreaterThanOrEqual(2)

    // The intermediate .cleaned.wav is gone; the output is all that is left.
    expect(await readdir(dir)).toEqual(['ramp-cleaned.mp4'])
  }, 120_000)

  it('T-121: cuts that overlap close the gap once - the picture closes by the time removed, not by the sum of the cuts', async () => {
    // Widening a cut by dragging a new one over it is a supported gesture, so the list can hold [4,7] and
    // [6,9] (handed over out of order here). Together they remove 5 s, not 6: the picture retimes survivors
    // by the time removed (T-121), and a sum over the cuts would count the 1 s overlap twice and pull
    // everything after it 1 s early. Source 10.0 s must land at output 5.0 s, under the sound's burst.
    const { outputPath } = await reattach('overlap', [
      { startSec: 6, endSec: 9 },
      { startSec: 4, endSec: 7 }
    ])
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    const expected = SOURCE_LEN - 5
    const vDur = Number(v?.duration)
    const aDur = Number(a?.duration)
    expect(vDur, `video duration ${vDur}`).toBeGreaterThan(expected - 0.25)
    expect(vDur, `video duration ${vDur}`).toBeLessThan(expected + 0.25)
    expect(Math.abs(vDur - aDur), `video ${vDur} s vs audio ${aDur} s`).toBeLessThan(0.15)
    await expectLumaAt(outputPath, 3.5, 3.5)
    await expectLumaAt(outputPath, 5.0, 10.0)
    await expectLumaAt(outputPath, 13.0, 18.0)
    const quietBefore = await bandMeanVolume(outputPath, 3.5, 0.8, 440)
    const burst = await bandMeanVolume(outputPath, 5.2, 1.1, 440)
    expect(burst - quietBefore, `burst ${burst} dB vs before ${quietBefore} dB`).toBeGreaterThan(15)
  }, 120_000)

  it('with no cuts the picture is stream-copied untouched, and still no litter', async () => {
    const { outputPath, dir } = await reattach('nocut', [])
    // Byte-cheap path: the video packets are the source's own.
    expect(await videoPacketMd5(outputPath)).toBe(await videoPacketMd5(rampSrc))
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    expect(Math.abs(Number(v?.duration) - SOURCE_LEN)).toBeLessThan(0.25)
    expect(Math.abs(Number(a?.duration) - SOURCE_LEN)).toBeLessThan(0.25)
    expect(await readdir(dir)).toEqual(['ramp-cleaned.mp4'])
  }, 120_000)

  /**
   * Re-attach a cut of the ramp with a secondary track that is silent except a
   * 3 kHz burst at source 12.0-13.5 s (AFTER the cut, so correctly cut it sits
   * at output 9.0-10.5 s, under the picture of source seconds 12-13.5), and
   * check that picture, voice, music and every duration agree.
   */
  async function expectSecondaryTrackCut(name: string, musicSeconds: number): Promise<void> {
    const music = path.join(outDir, `music-burst-${musicSeconds}s.wav`)
    await ff([
      '-y',
      '-f', 'lavfi',
      '-i', `sine=frequency=3000:sample_rate=48000:duration=${musicSeconds},volume='if(between(t,12,13.5),1,0.001)':eval=frame`,
      '-ac', '2',
      music
    ])
    const { outputPath, dir } = await reattach(name, [CUT], rampSrc, {
      secondaryTrack: {
        filePath: music,
        fileName: path.basename(music),
        role: 'music',
        gainDb: 0,
        duckUnderPrimary: false
      }
    })
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    const expected = SOURCE_LEN - CUT_LEN
    const vDur = Number(v?.duration)
    const aDur = Number(a?.duration)
    const cDur = Number(info.format.duration)
    for (const [label, dur] of [['video', vDur], ['audio', aDur], ['container', cDur]] as const) {
      expect(dur, `${label} duration ${dur}`).toBeGreaterThan(expected - 0.25)
      expect(dur, `${label} duration ${dur}`).toBeLessThan(expected + 0.25)
    }
    expect(Math.abs(vDur - aDur), `video ${vDur} s vs audio ${aDur} s`).toBeLessThan(0.15)

    // The music's burst moved with everything else: loud at output 9.2-10.3,
    // quiet where the uncut file would have put it (12.2-13.3) and before it.
    const musicBurst = await bandMeanVolume(outputPath, 9.2, 1.1, 3000)
    const musicUncutSpot = await bandMeanVolume(outputPath, 12.2, 1.1, 3000)
    const musicBefore = await bandMeanVolume(outputPath, 7.6, 1.0, 3000)
    expect(musicBurst - musicUncutSpot, `music burst ${musicBurst} dB vs where uncut ${musicUncutSpot} dB`).toBeGreaterThan(15)
    expect(musicBurst - musicBefore, `music burst ${musicBurst} dB vs before ${musicBefore} dB`).toBeGreaterThan(15)
    // The voice is still cut too (its burst: source 10.0-11.5 -> output 7.0-8.5),
    // and the picture under the music's first instant is source second 12.
    const voiceBurst = await bandMeanVolume(outputPath, 7.2, 1.1, 440)
    const voiceBefore = await bandMeanVolume(outputPath, 6.0, 0.8, 440)
    expect(voiceBurst - voiceBefore, `voice burst ${voiceBurst} dB vs ${voiceBefore} dB`).toBeGreaterThan(15)
    await expectLumaAt(outputPath, 9.2, 12.2)
    expect(await readdir(dir)).toEqual(['ramp-cleaned.mp4'])
  }

  it('a secondary track is cut with the voice, so music, voice and picture stay in step', async () => {
    // The cut belongs to the FINAL audio. With a secondary track the chain
    // used to cut only the primary input: the music ran uncut beside a cut
    // voice, the mix came out as long as the music (20 s against a 17 s
    // picture), and the music's own moments sat 3 s late. Here the music is
    // exactly as long as the source.
    await expectSecondaryTrackCut('cut-secondary', SOURCE_LEN)
  }, 120_000)

  it('a music bed longer than the picture is trimmed to it, not shifted', async () => {
    // amix runs to its LONGEST input, so the mix is max(voice, music) minus
    // the cuts: a 26 s bed under a 20 s source cut by 3 s mixes to 23 s
    // against a 17 s picture. The mux's -shortest bounds the tail; it must
    // trim the END of the audio, not move anything, so the burst that lands
    // at its shifted time in the equal-length case above lands there again.
    await expectSecondaryTrackCut('cut-secondary-long', SOURCE_LEN + 6)
  }, 120_000)

  describe('a picture an mp4 cannot carry is re-encoded, not copied (T-111)', () => {
    // A reopened project re-attaches to the ORIGINAL video; a session that imported a
    // .wmv had muxed onto the h264 working copy it made, so the copy path never saw
    // wmv2. `-c:v copy` of wmv2 into an mp4 is "Could not find tag for codec wmv2 in
    // stream #0, codec not currently supported in container", every time.
    let wmv = ''
    const WMV_SECONDS = 3
    const WMV_FPS = 25

    beforeAll(async () => {
      wmv = path.join(workDir, 'reopen-original.wmv')
      await ff([
        '-y',
        '-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=${WMV_FPS}:duration=${WMV_SECONDS}`,
        '-f', 'lavfi', '-i', `sine=frequency=440:duration=${WMV_SECONDS}`,
        '-c:v', 'wmv2', '-c:a', 'wmav2', '-shortest', wmv
      ])
    })

    async function reattachFrom(video: string, name: string, cutRegions: Array<{ startSec: number; endSec: number }> = []) {
      const dir = path.join(outDir, name)
      await mkdir(dir, { recursive: true })
      const extracted = await extractAudioFromVideo(video)
      const seen: Array<{ pass: string; percent: number }> = []
      try {
        const outputPath = path.join(dir, 'cleaned.mp4')
        await runAudioReattach(
          {
            jobId: `reattach-${name}`,
            videoPath: video,
            sourcePath: extracted.wavPath,
            outputPath,
            chain: { ...DEFAULT_CHAIN_SPEC, cutRegions }
          },
          (p) => seen.push({ pass: p.pass, percent: p.percent })
        )
        return { outputPath, dir, seen }
      } finally {
        await extracted.cleanup()
      }
    }

    /** Every frame decodes (no error on stderr, exit 0) and the count is the picture's. */
    async function framesDecoded(file: string): Promise<number> {
      const { stderr } = await ff(['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'null', '-'])
      expect(stderr.trim(), 'decoding every frame prints nothing').toBe('')
      const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
        const child = spawn(ffprobePath, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file])
        let out = ''
        child.stdout.on('data', (b) => (out += String(b)))
        child.on('error', reject)
        child.on('close', () => resolve({ stdout: out }))
      })
      return Number(stdout.trim())
    }

    it('a wmv2 original is re-attached as a playable h264 mp4 with the cleaned sound', async () => {
      const { outputPath, dir, seen } = await reattachFrom(wmv, 'wmv-original')
      const info = await ffprobeJson(outputPath)
      const v = info.streams.find((s) => s.codec_type === 'video')
      const a = info.streams.find((s) => s.codec_type === 'audio')
      expect(v?.codec_name).toBe('h264')
      expect(v?.pix_fmt).toBe('yuv420p')
      expect([v?.width, v?.height]).toEqual([320, 240])
      expect(a?.codec_name).toBe('aac')
      expect(Math.abs(Number(info.format.duration) - WMV_SECONDS)).toBeLessThan(0.4)
      await assertFaststart(outputPath)
      // Playable: every frame decodes, and none was dropped or duplicated on the way.
      const frames = await framesDecoded(outputPath)
      expect(Math.abs(frames - WMV_SECONDS * WMV_FPS), `${frames} frames`).toBeLessThanOrEqual(2)
      // The mux is the pass that ran (there is no extra one), and the scratch WAV went.
      expect(seen.filter((p) => p.pass === 'mux').length).toBeGreaterThan(0)
      expect(await readdir(dir)).toEqual(['cleaned.mp4'])
    }, 120_000)

    it('the control: an h264 original is still copied, packet for packet', async () => {
      // rampSrc is h264 in mp4: the copy path is untouched, so the picture's packets are
      // byte-identical to the source's.
      const { outputPath } = await reattachFrom(rampSrc, 'h264-original')
      expect(await videoPacketMd5(outputPath)).toBe(await videoPacketMd5(rampSrc))
    }, 120_000)

    it('a wmv2 original with a cut is re-encoded the way it always was, and still plays', async () => {
      const { outputPath } = await reattachFrom(wmv, 'wmv-cut', [{ startSec: 1, endSec: 2 }])
      const info = await ffprobeJson(outputPath)
      expect(info.streams.find((s) => s.codec_type === 'video')?.codec_name).toBe('h264')
      expect(Math.abs(Number(info.format.duration) - (WMV_SECONDS - 1))).toBeLessThan(0.5)
      expect(await framesDecoded(outputPath)).toBeGreaterThan(0)
    }, 120_000)
  })

  describe('an odd-sized picture is made even in the re-encode (T-113)', () => {
    // libx264 + yuv420p refuse an odd width or height ("width not divisible by 2 ...
    // Error while opening encoder", exit 187), and a screen recording as a VP8/VP9
    // webm is exactly where an odd size comes from. Before T-111 the picture was
    // copied (a webm never reached the mp4 muxer, but a stream copy did not care);
    // the re-encode T-111 added for what an mp4 cannot carry made an odd webm die.
    // lavfi sources round yuv420p down to even themselves, so the odd size is made
    // by `scale` after the source.
    const ODD_W = 321
    const ODD_H = 241
    const ODD_SECONDS = 3
    const ODD_FPS = 25
    const oddFiles = new Map<string, string>()
    const CODECS: ReadonlyArray<readonly [string, string]> = [
      ['vp9', 'libvpx-vp9'],
      ['vp8', 'libvpx']
    ]

    beforeAll(async () => {
      for (const [name, encoder] of CODECS) {
        const file = path.join(workDir, `odd-${name}.webm`)
        await ff([
          '-y',
          '-f', 'lavfi', '-i', `testsrc2=size=400x300:rate=${ODD_FPS}:duration=${ODD_SECONDS}`,
          '-f', 'lavfi', '-i', `sine=frequency=440:duration=${ODD_SECONDS}`,
          '-vf', `scale=${ODD_W}:${ODD_H},format=yuv420p`,
          '-c:v', encoder, '-b:v', '300k', '-c:a', 'libopus', '-shortest', file
        ])
        oddFiles.set(name, file)
      }
    })

    async function reattachOdd(name: string, cutRegions: Array<{ startSec: number; endSec: number }>) {
      const video = oddFiles.get(name) as string
      const dir = path.join(outDir, `odd-${name}-${cutRegions.length}`)
      await mkdir(dir, { recursive: true })
      const extracted = await extractAudioFromVideo(video)
      try {
        const outputPath = path.join(dir, 'cleaned.mp4')
        await runAudioReattach(
          {
            jobId: `reattach-odd-${name}-${cutRegions.length}`,
            videoPath: video,
            sourcePath: extracted.wavPath,
            outputPath,
            chain: { ...DEFAULT_CHAIN_SPEC, cutRegions }
          },
          () => {}
        )
        return outputPath
      } finally {
        await extracted.cleanup()
      }
    }

    it.each(CODECS.map(([name]) => [name]))('the fixture really is an odd-sized %s picture', async (name) => {
      const info = await ffprobeJson(oddFiles.get(name as string) as string)
      const v = info.streams.find((s) => s.codec_type === 'video')
      expect([v?.codec_name, v?.width, v?.height]).toEqual([name, ODD_W, ODD_H])
    })

    it.each(CODECS.map(([name]) => [name]))('an odd-sized %s webm is re-attached as an even-sized h264 mp4 that plays', async (name) => {
      const outputPath = await reattachOdd(name as string, [])
      const info = await ffprobeJson(outputPath)
      const v = info.streams.find((s) => s.codec_type === 'video')
      expect(v?.codec_name).toBe('h264')
      expect(v?.pix_fmt).toBe('yuv420p')
      // One pixel trimmed off the odd edge (EVEN_PICTURE is a crop since T-115: nothing is
      // resampled, which the checkerboard case in the T-114 convert block proves): 321x241 -> 320x240.
      expect([v?.width, v?.height]).toEqual([ODD_W - 1, ODD_H - 1])
      expect(info.streams.find((s) => s.codec_type === 'audio')?.codec_name).toBe('aac')
      expect(Math.abs(Number(info.format.duration) - ODD_SECONDS)).toBeLessThan(0.5)
      const { stderr } = await ff(['-v', 'error', '-i', outputPath, '-map', '0:v:0', '-f', 'null', '-'])
      expect(stderr.trim(), 'decoding every frame prints nothing').toBe('')
    }, 120_000)

    it('an odd-sized webm with a cut is evened ahead of the cut and still plays', async () => {
      const outputPath = await reattachOdd('vp9', [{ startSec: 1, endSec: 2 }])
      const info = await ffprobeJson(outputPath)
      const v = info.streams.find((s) => s.codec_type === 'video')
      expect([v?.codec_name, v?.width, v?.height]).toEqual(['h264', ODD_W - 1, ODD_H - 1])
      expect(Math.abs(Number(info.format.duration) - (ODD_SECONDS - 1))).toBeLessThan(0.5)
    }, 120_000)
  })

  describe('a cut that is not a whole number of frames long keeps every survivor on its own timestamp (T-122)', () => {
    // The cut re-attach retimes each surviving frame by the length of the cuts before it (T-121), and that length is
    // almost never a whole number of frames: 3.3 to 5.7 s is 57.6 frames at 24 fps. Libx264's encoder time base
    // is whatever ffmpeg picks for it, and on the shipped major (6.1.1) a constant-rate source (an OBS mp4 or mkv:
    // the common case) gets 1/fps, so every retimed stamp was ROUNDED to the frame grid and the first survivor after
    // a cut landed on the frame before it: ffprobe read one `pts_time` twice ("non-strictly-monotonic PTS" on stderr)
    // and the picture was shown a fraction of a frame early from there on. 7.0.2 keeps the graph's own time base
    // and is exact either way, so this case cannot go red on the bundled binary - the 6.1.1 run (the same file on
    // the distro's ffmpeg, aliased in by a scratch vitest config) is where it fails without `-enc_time_base filter`.
    // The check is the whole list, not only a duplicate: every output packet is compared with the time its source
    // frame belongs at (its own time minus the cut time before it), so a stamp rounded onto the grid is wrong
    // even where it does not collide with its neighbor.
    type Cut = { startSec: number; endSec: number }

    /**
     * Where each kept frame of the source belongs after `cuts` close up: its own time minus the time removed before it.
     * Read from the source's own packets, not from `k / fps`: how many frames a fixture has (and where the first one sits)
     * depends on the ffmpeg that made it.
     */
    function expectedSurvivorTimes(sourceTimes: number[], cuts: Cut[]): number[] {
      const times: number[] = []
      for (const t of sourceTimes) {
        // `between` in the keep expression is inclusive at both ends.
        if (cuts.some((c) => t >= c.startSec && t <= c.endSec)) continue
        const removed = cuts.reduce((sum, c) => sum + Math.max(0, Math.min(t, c.endSec) - c.startSec), 0)
        times.push(t - removed)
      }
      return times
    }

    /**
     * How many frames the picture may lose off its tail to `-shortest`, derived from the sound's cut grid (T-124 (32)).
     *
     * `-shortest` ends the picture where the sound ends. The cut sound is shorter than the cut picture by (a) what each cut's
     * block grid takes: `aselectForCuts` keeps or drops 256-sample blocks (`asetnsamples=n=256`), so a cut removes its length
     * +/- 256 samples (5.3 ms at 48 kHz) and n cuts can shorten the sound by n x 256 samples; and (b) the source's own overhang,
     * the picture outlasting its sound by up to one 1024-sample AAC frame (21.3 ms) in a file ffmpeg made with `-shortest`. A
     * frame is lost off the tail for each started frame period of that shortfall, so the allowance is
     * ceil((cuts x 256 + 1024) / 48000 x fps): 1 for two cuts at 24 fps, 2 for three cuts at 30 fps. Measured on the three
     * cases below under that grid: 0, 0 and 0 on 7.0.2, and 0, 0 and 1 (the AVI) on 6.1.1. This replaces a flat "at most 2",
     * which was derived from a 1024-sample grid the cut never had (it cut on the decoder's block): with 7.0.2's 4096-sample WAV
     * blocks the sweep's fuzz saw a correct export lose 3.
     */
    function maxTailFrames(cutCount: number, fps: number): number {
      const cutBlockSec = 256 / 48000
      const aacFrameSec = 1024 / 48000
      return Math.ceil((cutCount * cutBlockSec + aacFrameSec) * fps)
    }

    /** The cut picture's packet times against where the survivors belong, relative to the first (an mp4 may start a frame late). */
    function expectSurvivorsOnTheirOwnTimes(actual: number[], expected: number[], label: string, maxTrim: number): void {
      const dupes = actual.filter((t, i) => i > 0 && t === actual[i - 1])
      expect(dupes, `${label}: pts_time written twice: ${dupes.map((t) => t.toFixed(6)).join(' ')}`).toEqual([])
      // The last surviving frames may be trimmed off the tail (`maxTailFrames`). A frame missing from the MIDDLE
      // shifts every packet after it, and the comparison below finds that.
      const trimmed = expected.length - actual.length
      expect(
        trimmed >= 0 && trimmed <= maxTrim,
        `${label}: ${actual.length} packets for ${expected.length} surviving frames (only the tail may be trimmed, by at most ${maxTrim})`
      ).toBe(true)
      const first = actual[0] as number
      const worst = actual.reduce(
        (w, t, i) => {
          const off = Math.abs(t - first - ((expected[i] as number) - (expected[0] as number)))
          return off > w.off ? { off, i } : w
        },
        { off: 0, i: 0 }
      )
      expect(
        worst.off,
        `${label}: packet ${worst.i} is at ${(actual[worst.i] as number).toFixed(6)} s, ${(worst.off * 1000).toFixed(1)} ms from where its frame belongs`
      ).toBeLessThan(0.001)
    }

    it('the 24 fps ramp, two cuts of 57.6 and 28.8 frames: no two packets share a time, and each is where its frame belongs', async () => {
      // 3.3-5.7 s and 8.0-9.2 s: the first survivor after the first cut is source 5.7083 s, which belongs at 3.3083 s - between
      // the 24 fps grid's 3.2917 (the frame before the cut, which is already there) and 3.3333.
      const cuts: Cut[] = [
        { startSec: 3.3, endSec: 5.7 },
        { startSec: 8.0, endSec: 9.2 }
      ]
      // The fixture is the constant-rate shape the defect lives on (the OUTPUT's rate reads 120/1 by design: the
      // survivors after a cut are no longer evenly spaced, and ffprobe guesses the finest grid they sit on).
      const source = (await ffprobeJson(rampSrc)).streams.find((s) => s.codec_type === 'video')
      expect([source?.r_frame_rate, source?.avg_frame_rate]).toEqual(['24/1', '24/1'])
      const { outputPath } = await reattach('t122-ramp', cuts)
      expectSurvivorsOnTheirOwnTimes(
        await videoPacketTimes(outputPath),
        expectedSurvivorTimes(await videoPacketTimes(rampSrc), cuts),
        'the 24 fps ramp',
        maxTailFrames(cuts.length, 24)
      )
    }, 120_000)

    it('a 30 fps source (OBS) with three cuts that are not frame-aligned: the same', async () => {
      const seconds = 6
      const fps = 30
      const source = path.join(workDir, 't122-30fps.mp4')
      await ff([
        '-y',
        '-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=${fps}:duration=${seconds}`,
        '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source
      ])
      const probed = (await ffprobeJson(source)).streams.find((s) => s.codec_type === 'video')
      expect([probed?.r_frame_rate, probed?.avg_frame_rate]).toEqual(['30/1', '30/1'])
      // 0.35 s, 0.85 s and 0.41 s: 10.5, 25.5 and 12.3 frames.
      const cuts: Cut[] = [
        { startSec: 1.0, endSec: 1.35 },
        { startSec: 2.2, endSec: 3.05 },
        { startSec: 4.1, endSec: 4.51 }
      ]
      const dir = path.join(outDir, 't122-30fps')
      await mkdir(dir, { recursive: true })
      const extracted = await extractAudioFromVideo(source)
      try {
        const outputPath = path.join(dir, 'cleaned.mp4')
        await runAudioReattach(
          {
            jobId: 'reattach-t122-30fps',
            videoPath: source,
            sourcePath: extracted.wavPath,
            outputPath,
            chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: cuts }
          },
          () => {}
        )
        expectSurvivorsOnTheirOwnTimes(
          await videoPacketTimes(outputPath),
          expectedSurvivorTimes(await videoPacketTimes(source), cuts),
          'the 30 fps source',
          maxTailFrames(cuts.length, fps)
        )
      } finally {
        await extracted.cleanup()
      }
    }, 120_000)

    it('an AVI source (stream time base 1/fps) with cuts that are not frame-aligned: the same (T-123 (12))', async () => {
      // An AVI is a NATIVE_VIDEO_EXTENSIONS member, and its stream time base is 1/fps. `setpts` writes the retimed stamp in the
      // time base of the frames it was handed, so with a 1/24 base `setpts` ITSELF rounded 3.3083 s onto the 24 fps grid
      // (3.2917 s, the frame before the cut) BEFORE the encoder was involved: `-enc_time_base:v filter` (T-122) cannot
      // keep a stamp the filter had already rounded. Unlike the case above this one fails on the BUNDLED 7.0.2 too - the
      // sweep measured the same duplicate on both majors. `settb=AVTB` between `select` and `setpts` hands `setpts` a
      // microsecond base, so the stamp is exact (3.308332).
      const seconds = 8
      const fps = 24
      const source = path.join(workDir, 't123-avi.avi')
      await ff([
        '-y',
        '-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=${fps}:duration=${seconds}`,
        '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
        '-c:v', 'mpeg4', '-q:v', '4', '-bf', '0', '-c:a', 'pcm_s16le', '-shortest', source
      ])
      const probed = (await ffprobeJson(source)).streams.find((s) => s.codec_type === 'video')
      expect(probed?.codec_name).toBe('mpeg4')
      expect([probed?.r_frame_rate, probed?.avg_frame_rate]).toEqual(['24/1', '24/1'])
      // The trap is in the fixture: an AVI's video stream time base is exactly 1/fps.
      const tb = await new Promise<string>((resolve, reject) => {
        const child = spawn(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=time_base', '-of', 'csv=p=0', source])
        let text = ''
        child.stdout.on('data', (b) => (text += String(b)))
        child.on('error', reject)
        child.on('close', (code) => (code === 0 ? resolve(text.trim()) : reject(new Error(`ffprobe exit ${code}`))))
      })
      expect(tb).toBe('1/24')
      // 3.3-5.7 s (57.6 frames) and 6.1-6.45 s (8.4 frames): the first survivor after the first cut belongs at 3.3083 s.
      const cuts: Cut[] = [
        { startSec: 3.3, endSec: 5.7 },
        { startSec: 6.1, endSec: 6.45 }
      ]
      const dir = path.join(outDir, 't123-avi')
      await mkdir(dir, { recursive: true })
      const extracted = await extractAudioFromVideo(source)
      try {
        const outputPath = path.join(dir, 'cleaned.mp4')
        await runAudioReattach(
          {
            jobId: 'reattach-t123-avi',
            videoPath: source,
            sourcePath: extracted.wavPath,
            outputPath,
            chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: cuts }
          },
          () => {}
        )
        expectSurvivorsOnTheirOwnTimes(
          await videoPacketTimes(outputPath),
          expectedSurvivorTimes(await videoPacketTimes(source), cuts),
          'the 24 fps AVI',
          maxTailFrames(cuts.length, fps)
        )
      } finally {
        await extracted.cleanup()
      }
    }, 120_000)

    it('the check discriminates: a list with two packets on one time, and one with a survivor on the grid instead of its own time, both fail it', () => {
      const expected = [0, 1 / 24, 2 / 24, 3.5 / 24, 4.5 / 24]
      expect(() => expectSurvivorsOnTheirOwnTimes(expected, expected, 'control', 1)).not.toThrow()
      expect(() =>
        expectSurvivorsOnTheirOwnTimes([0, 1 / 24, 2 / 24, 2 / 24, 4.5 / 24], expected, 'duplicate', 1)
      ).toThrow(/pts_time written twice/)
      expect(() =>
        expectSurvivorsOnTheirOwnTimes([0, 1 / 24, 2 / 24, 4 / 24, 5 / 24], expected, 'rounded', 1)
      ).toThrow(/ms from where its frame belongs/)
      // The tail may lose what the allowance says (here 1); one more, or one from the middle, is a frame lost.
      expect(() => expectSurvivorsOnTheirOwnTimes(expected.slice(0, 4), expected, 'tail', 1)).not.toThrow()
      expect(() => expectSurvivorsOnTheirOwnTimes(expected.slice(0, 3), expected, 'one too many', 1)).toThrow(/by at most 1/)
      expect(() => expectSurvivorsOnTheirOwnTimes(expected.slice(0, 2), expected, 'too short', 2)).toThrow(/only the tail may be trimmed/)
      expect(() =>
        expectSurvivorsOnTheirOwnTimes([0, 1 / 24, 3.5 / 24, 4.5 / 24], expected, 'middle', 1)
      ).toThrow(/ms from where its frame belongs/)
    })

    it('the tail allowance follows the grid: it is ceil((cuts x 256 + 1024) samples at 48 kHz x fps), and the old 4096-sample WAV block would have needed more', () => {
      expect(maxTailFrames(2, 24)).toBe(1) // 32 ms of shortfall, a 41.7 ms frame
      expect(maxTailFrames(3, 30)).toBe(2) // 37.3 ms, a 33.3 ms frame
      expect(maxTailFrames(1, 24)).toBe(1)
      expect(maxTailFrames(0, 24)).toBe(1) // the source's own overhang alone is a started frame
      expect(maxTailFrames(7, 24), 'seven 5.3 ms blocks and an AAC frame are 58.7 ms: two 41.7 ms frames').toBe(2)
      // The same arithmetic on the decoder's own 4096-sample block (what the cut was on before): three cuts at 30 fps would
      // have to allow 9 frames, which is not an allowance, it is no check at all.
      expect(Math.ceil((3 * (4096 / 48000) + 1024 / 48000) * 30)).toBe(9)
    })
  })

  it('a mux that fails still removes the intermediate WAV', async () => {
    // The video does not exist, so the export pass finishes (the WAV is a
    // real, complete file by then) and the mux pass dies on its input.
    const dir = path.join(outDir, 'failing')
    await mkdir(dir, { recursive: true })
    await expect(
      reattach('failing', [CUT], path.join(dir, 'no-such-video.mp4'))
    ).rejects.toThrow(/^FFmpeg exit \d+: /)
    expect(await readdir(dir)).toEqual([])
  }, 120_000)

  it('refuses to clobber a file that sits where the intermediate WAV would go', async () => {
    // An output named X.mp4 stages its audio at X.cleaned.wav and deletes it
    // afterwards. If that path is the very file the job reads from, writing
    // and then deleting it would destroy the user's source: the job has to
    // stop before touching anything.
    const dir = path.join(outDir, 'collide')
    await mkdir(dir, { recursive: true })
    const extracted = await extractAudioFromVideo(rampSrc)
    const source = path.join(dir, 'collide.cleaned.wav')
    try {
      await copyFile(extracted.wavPath, source)
      const before = await readFile(source)
      await expect(
        runAudioReattach(
          {
            jobId: 'reattach-collide',
            videoPath: rampSrc,
            sourcePath: source,
            outputPath: path.join(dir, 'collide.mp4'),
            chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [CUT] }
          },
          () => {}
        )
      ).rejects.toThrow(/^Assertion failed: .*intermediate/)
      expect(existsSync(source)).toBe(true)
      expect((await readFile(source)).equals(before)).toBe(true)
      expect(existsSync(path.join(dir, 'collide.mp4'))).toBe(false)
    } finally {
      await extracted.cleanup()
    }
  }, 120_000)
})

describe('an HEVC picture re-attached to its sound plays on Apple players (real ffmpeg, T-126 (24))', () => {
  // HEVC is a picture an mp4 can carry as it is, so the re-attach stream-copies it - and ffmpeg writes a copied HEVC stream into an MP4
  // with its default tag, `hev1`, which QuickTime, Safari and iOS refuse to play (the file opens in VLC and in Chrome and nowhere on a Mac or
  // an iPhone). `hvc1` is the tag they read. The copy now carries `-tag:v hvc1`; the other copyable codecs keep their own tag, and a picture
  // that is re-encoded (a cut) is libx264's `avc1`.
  let hevc = ''
  let h264 = ''

  beforeAll(async () => {
    hevc = path.join(workDir, 't126-hevc.mkv')
    h264 = path.join(workDir, 't126-h264.mkv')
    const video = 'testsrc2=size=320x240:rate=30:duration=4'
    await ff([
      '-y', '-f', 'lavfi', '-i', video, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', hevc
    ])
    await ff([
      '-y', '-f', 'lavfi', '-i', video, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', h264
    ])
  }, 120_000)

  const videoStream = async (file: string) => (await ffprobeJson(file)).streams.find((s) => s.codec_type === 'video')
  /** ffmpeg decoding the whole file to nothing, at error level: anything it prints is a decode problem. */
  const decodeErrors = async (file: string): Promise<string> =>
    (await ff(['-v', 'error', '-i', file, '-f', 'null', '-'])).stderr.trim()

  it('the fixture is what it says: an HEVC picture in a Matroska file, which a naive copy would tag hev1', async () => {
    expect((await videoStream(hevc))?.codec_name).toBe('hevc')
    // The trap: the same copy WITHOUT the tag lands as hev1 (the control that makes the tag's presence below mean something).
    const naive = path.join(workDir, 't126-hevc-naive.mp4')
    await ff(['-y', '-i', hevc, '-i', voiceWav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', naive])
    expect((await videoStream(naive))?.codec_tag_string, 'an untagged copy of HEVC into an mp4').toBe('hev1')
  }, 60_000)

  it('an HEVC mkv re-attached to its cleaned sound is still HEVC, tagged hvc1, and decodes clean', async () => {
    const out = path.join(workDir, 't126-hevc-reattached.mp4')
    await runAudioMux('t126-hevc-mux', hevc, voiceWav, out, () => {})
    const v = await videoStream(out)
    expect(v?.codec_name, 'the picture was copied, not re-encoded').toBe('hevc')
    expect(v?.codec_tag_string, 'the tag QuickTime, Safari and iOS read').toBe('hvc1')
    expect(await decodeErrors(out), 'ffmpeg decodes the whole file with nothing to say').toBe('')
    await assertFaststart(out)
  }, 60_000)

  it('an H.264 picture is copied with the tag it always had (avc1): nothing but HEVC is touched', async () => {
    const out = path.join(workDir, 't126-h264-reattached.mp4')
    await runAudioMux('t126-h264-mux', h264, voiceWav, out, () => {})
    const v = await videoStream(out)
    expect(v?.codec_name).toBe('h264')
    expect(v?.codec_tag_string).toBe('avc1')
    expect(await decodeErrors(out)).toBe('')
  }, 60_000)

  it('a cut HEVC picture is re-encoded to H.264 (avc1): the tag belongs to the copy and to nothing else', async () => {
    const out = path.join(workDir, 't126-hevc-cut.mp4')
    await runAudioMux('t126-hevc-cut', hevc, voiceWav, out, () => {}, [{ startSec: 1, endSec: 2 }])
    const v = await videoStream(out)
    expect(v?.codec_name).toBe('h264')
    expect(v?.codec_tag_string).toBe('avc1')
    expect(await decodeErrors(out)).toBe('')
  }, 120_000)
})

describe('subtitles path escaping (real ffmpeg)', () => {
  // Burn-in derives the SRT name from the untouched source filename, so
  // apostrophes/spaces/commas all reach the subtitles= filter argument.
  // escapeSubtitlesPath is the round-18 two-level escaper; this pins it
  // against ffmpeg's actual filtergraph parser, not just a string shape.
  it.each([
    "Sam's Highlight-123.srt",
    'plain.srt',
    'with space.srt',
    'weird,name;[x].srt',
    // T-118 (7): the path is the filter's FIRST, positional option, so an unescaped `=` made
    // ffmpeg's option parser read "a" as an option name ("Error applying option '.../a' to
    // filter 'subtitles': Option not found", exit 8). "Boss=Dead-<stamp>.srt" is a name the
    // app derives from a video called "Boss=Dead.mp4".
    'a=b.srt'
  ])('burns subtitles from %s', async (name) => {
    const srtPath = path.join(workDir, name)
    await writeFile(srtPath, '1\n00:00:00,000 --> 00:00:02,000\nHELLO\n', 'utf8')
    const out = path.join(workDir, `sub-${Math.abs(hashCode(name))}.mp4`)
    await ff([
      '-y',
      '-i', noAudioSrc,
      '-vf', `subtitles=${escapeSubtitlesPath(srtPath)}:force_style='FontSize=24'`,
      '-frames:v', '5',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      out
    ])
    expect(existsSync(out)).toBe(true)
  })
})

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

describe('probe error contract (real ffprobe)', () => {
  it('probeVideo rejects a file with no video stream', async () => {
    await expect(probeVideo(voiceWav)).rejects.toThrow(/no video stream/i)
  })

  it('probeAudio rejects a file with no audio stream', async () => {
    await expect(probeAudio(noAudioSrc)).rejects.toThrow(/no audio stream/i)
  })

  it('probeVideo reports source dimensions and duration accurately', async () => {
    const p = await probeVideo(landscapeSrc)
    expect(p.width).toBe(1920)
    expect(p.height).toBe(1080)
    expect(p.duration).toBeGreaterThan(5.5)
    expect(p.duration).toBeLessThan(6.5)
    expect(p.audioCodec).toBe('aac')
  })

  it('probeVideo refuses a text file that the ansi demuxer claims as video', async () => {
    // T-08. ffprobe itself is perfectly happy here: its `tty` demuxer
    // registers the `.txt` extension and synthesizes a 640x400 pal8 "video"
    // stream in the `ansi` (ASCII/ANSI art) decoder out of ANY text, exit 0
    // and a non-zero duration. So every check probeVideo had — a video
    // stream exists, duration > 0 — passed, and a streamer's notes file
    // imported with a full export panel behind it. Only a codec floor can
    // refuse this, and only a real ffprobe run can prove the floor fires:
    // the first two assertions are here to show that ffprobe still hands
    // back the bogus stream, so the third is testing the guard and not a
    // change of heart in the binary.
    const notes = path.join(workDir, 'stream-notes.txt')
    await writeFile(notes, 'this is not a video, it is a text file\n', 'utf8')

    const raw = await ffprobeJson(notes)
    expect(raw.format.format_name).toBe('tty')
    expect(raw.streams.find((s) => s.codec_type === 'video')?.codec_name).toBe('ansi')

    await expect(probeVideo(notes)).rejects.toThrow(
      /^This file is text, not a video — pick a video file such as MP4, MOV, or MKV\.$/
    )
  })
})

describe('import conversion for non-native containers (real ffmpeg)', () => {
  // Round 20: the import lists now include containers Chromium's <video>
  // element can't play (shared/mediaFormats CONVERT_VIDEO_EXTENSIONS).
  // These convert to an mp4 working copy on import via convertForImport.
  // Per IMG-PREC this claim needs real-binary proof per container: the
  // fixture is generated by real ffmpeg IN that container, converted by
  // the real production function, and the output probed for h264+aac,
  // duration, and faststart.
  // Per-platform reality for the mpegts family (ts/m2ts): ffmpeg-static
  // ships different builders per platform. The linux binary
  // (johnvansickle 7.0.2) SIGSEGVs on any muxed output from mpegts
  // input, so those entries only run where the SHIPPED builder does
  // (win32, gyan.dev 6.1.1 — proven clean under wine 2026-08-14, both
  // codec shapes + m2ts + wav extraction). The linux segfault itself is
  // pinned by its own test below so an ffmpeg-static upgrade that fixes
  // it surfaces as a failing test instead of silent dead weight.
  const CONTAINERS: Array<{ ext: string; extraArgs: string[]; win32Only?: boolean }> = [
    { ext: 'flv', extraArgs: [] },
    { ext: 'ts', extraArgs: [], win32Only: true },
    {
      ext: 'm2ts',
      extraArgs: ['-c:v', 'libx264', '-c:a', 'aac'],
      win32Only: true
    },
    { ext: 'wmv', extraArgs: [] },
    { ext: 'mpg', extraArgs: [] },
    // 3gp's default codec (h263) only accepts a few legacy frame sizes;
    // real-world 3gp is h264+aac, so generate that.
    { ext: '3gp', extraArgs: ['-c:v', 'libx264', '-profile:v', 'baseline', '-c:a', 'aac'] }
  ]

  for (const { ext, extraArgs, win32Only } of CONTAINERS) {
    it.skipIf(win32Only && process.platform !== 'win32')(
      `${ext}: converts to a playable faststart h264/aac mp4`,
      async () => {
      const src = path.join(workDir, `import-fixture.${ext}`)
      await ff([
        '-y',
        '-f',
        'lavfi',
        '-i',
        // rate=25: MPEG-1/2 encoders only accept the legacy broadcast
        // rates (24/25/30/...). 15 fps made the .mpg fixture fail to encode
        // and produced a malformed mpegts whose decode died on a signal.
        'testsrc2=duration=1:size=320x240:rate=25',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-shortest',
        ...extraArgs,
        src
      ])
      const mp4 = await convertForImport(src)
      try {
        const probe = await ffprobeJson(mp4)
        const video = probe.streams.find((s) => s.codec_type === 'video')
        const audio = probe.streams.find((s) => s.codec_type === 'audio')
        expect(video?.codec_name, ext).toBe('h264')
        expect(audio?.codec_name, ext).toBe('aac')
        const duration = Number(probe.format.duration ?? 0)
        expect(duration, ext).toBeGreaterThan(0.5)
        expect(duration, ext).toBeLessThan(2.5)
        await assertFaststart(mp4)
      } finally {
        await rm(mp4, { force: true })
      }
      },
      60_000
    )
  }

  it.skipIf(process.platform === 'win32')(
    'KNOWN linux-binary bug: mpegts input crashes the convert child (if this FAILS, ffmpeg-static got fixed — unskip the ts matrix entries and delete this pin)',
    async () => {
      const src = path.join(workDir, 'segfault-pin.ts')
      await ff([
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=duration=1:size=320x240:rate=25',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-shortest',
        src
      ])
      await expect(convertForImport(src)).rejects.toThrow(/signal|exit/)
    },
    60_000
  )
})

/**
 * T-128 (5), T-127 (3)'s "not covered": the quit kills the child, then WAITS (`drainRuns`, what `before-quit` calls) for the cleanup the kill
 * starts. The unit tests hold that with a fake child and a slow unlink; this is the real SIGKILL on a real ffmpeg, the real `close`, and
 * the real removal of what the job was writing - on both majors. `os.tmpdir()` is read at each call, so each case points it at a folder
 * of its own and the scratch folder holds only what the job made.
 */
describe('a quit in the middle of a transcode or an extraction (real ffmpeg, T-128 (5))', () => {
  async function inOwnTmp<T>(work: (tmp: string) => Promise<T>): Promise<T> {
    const tmp = await mkdtemp(path.join(workDir, 'quit-tmp-'))
    const prior = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP }
    process.env.TMPDIR = tmp
    process.env.TMP = tmp
    process.env.TEMP = tmp
    try {
      return await work(tmp)
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }

  it(
    'a transcode killed by the quit sweep leaves no mp4 in the working-copy folder once the quit\'s wait is over',
    async () => {
      const src = path.join(workDir, 'quit-import.flv')
      await ff([
        '-y',
        '-f', 'lavfi', '-i', 'testsrc2=duration=30:size=1280x720:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
        '-shortest',
        src
      ])
      await inOwnTmp(async (tmp) => {
        let ticks = 0
        const importing = convertForImport(src, () => {
          ticks++
        }).then(
          () => null as unknown,
          (err: unknown) => err
        )
        // ffmpeg emits `out_time` only while it is encoding: this is "the partial mp4 is open and growing".
        const deadline = Date.now() + 60_000
        while (ticks === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
        expect(ticks, 'the transcode is running').toBeGreaterThan(0)
        const folder = path.join(tmp, 'imagii-import')
        expect(await readdir(folder), 'one working copy, being written').toHaveLength(1)

        cancelAllConverts() // what before-quit does...
        await expect(drainRuns(10_000)).resolves.toBe('drained') // ...and then waits for

        expect(await readdir(folder), 'the half-written mp4 (no moov atom) is gone').toEqual([])
        const err = await importing
        expect(err).toBeInstanceOf(ConvertCancelledError)
        expect((err as ConvertCancelledError).byQuit, 'and it says the quit did it').toBe(true)
      })
    },
    180_000
  )

  it(
    'an extraction killed by the quit sweep leaves no scratch WAV once the quit\'s wait is over',
    async () => {
      // 50 minutes of silence in FLAC: about 0.6 GB of WAV and a couple of seconds of ffmpeg, long enough to be killed part-way.
      const sound = path.join(workDir, 'quit-silence.mka')
      await ff(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '3000', '-c:a', 'flac', sound])
      await inOwnTmp(async (tmp) => {
        const folder = path.join(tmp, 'imagii-audio')
        const extracting = extractAudioFromVideo(sound).then(
          () => null as unknown,
          (err: unknown) => err
        )
        const sizeNow = async (): Promise<number> => {
          const names = existsSync(folder) ? await readdir(folder) : []
          const first = names[0]
          return first === undefined ? 0 : (await stat(path.join(folder, first))).size
        }
        const deadline = Date.now() + 60_000
        while ((await sizeNow()) < 2_000_000 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
        const size = await sizeNow()
        expect(size, 'the WAV is open and growing').toBeGreaterThan(2_000_000)
        expect(size, 'and the extraction is still far from done (0.58 GB when it is)').toBeLessThan(500_000_000)

        cancelAllExtractions()
        await expect(drainRuns(10_000)).resolves.toBe('drained')

        expect(await readdir(folder), 'the half-written WAV is gone').toEqual([])
        expect(isCancelledError(await extracting), 'and the extraction ended as a cancel').toBe(true)
      })
    },
    180_000
  )
})

describe('job-scoped convert cancellation (real ffmpeg, T-60)', () => {
  /**
   * The convert registry was a single slot: the last convert to start owned
   * it, so `cancelActiveConvert()` — "Discard recording" — SIGKILLed whatever
   * happened to be in there. A user who dropped an flv on the importer and
   * then discarded a take killed the import instead, and the take's own
   * convert kept running. This is that scenario with both children real: two
   * concurrent encodes, one cancel, and ffprobe on what survived.
   *
   * Unit-level coverage of the registry is in
   * src/main/ffmpeg/convertCancel.test.ts against a fake child; this is the
   * layer that proves the SIGKILL lands on the process the user meant.
   */

  /** The webm a screen recording leaves behind. Looped rather than encoded
   *  30 s of vp8 (0.06 s instead of 15 s) — the convert under test is the
   *  slow part, and it needs a source long enough to still be encoding when
   *  the cancel arrives. */
  async function longWebm(): Promise<string> {
    const seed = path.join(workDir, 'cancel-seed.webm')
    await ff([
      '-y',
      '-f', 'lavfi', '-i', 'testsrc2=duration=2:size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-shortest',
      '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2M',
      '-c:a', 'libvorbis',
      seed
    ])
    const long = path.join(workDir, 'cancel-recording.webm')
    await ff(['-y', '-stream_loop', '14', '-i', seed, '-c', 'copy', long])
    return long
  }

  /** A 30 s flv stream dump — the import path's real input. */
  async function longFlv(): Promise<string> {
    const src = path.join(workDir, 'cancel-import.flv')
    await ff([
      '-y',
      '-f', 'lavfi', '-i', 'testsrc2=duration=30:size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
      '-shortest',
      src
    ])
    return src
  }

  it(
    'discarding a recording leaves a concurrent import transcode running to completion',
    async () => {
      const recSrc = await longWebm()
      const impSrc = await longFlv()
      const recOut = path.join(workDir, 'cancel-recording.mp4')

      // T-115: progress is counted, not read as a percent - the importer has no length to measure
      // against, so its ticks carry none (the recording is given its real 30 s).
      let recTicks = 0
      let impTicks = 0
      const recording = convertToMp4('recording', recSrc, recOut, () => {
        recTicks++
      }, 30)
      const importing = convertForImport(impSrc, () => {
        impTicks++
      })
      // Park both rejections now: an unhandled one would take the run down
      // before the assertions read them.
      const recordingSettled = recording.then(
        () => ({ err: null as unknown }),
        (err: unknown) => ({ err })
      )
      const importSettled = importing.then(
        (out: string) => ({ out, err: null as unknown }),
        (err: unknown) => ({ out: '', err })
      )

      // Both children are alive and encoding — ffmpeg only emits `out_time`
      // while it is actually working, so this is what makes the cancel
      // deterministic instead of a race with two spawns.
      const deadline = Date.now() + 60_000
      while ((recTicks === 0 || impTicks === 0) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
      }
      expect(recTicks, 'the recording convert is running').toBeGreaterThan(0)
      expect(impTicks, 'the import convert is running').toBeGreaterThan(0)

      // The user clicks "Discard recording".
      cancelConverts('recording')

      const imp = await importSettled
      const rec = await recordingSettled

      // The money shot: the import was not this button's business. Before
      // T-60 it rejected here with ConvertCancelledError — the SIGKILL meant
      // for the recording, delivered to the wrong child.
      expect(imp.err, 'the import convert was not touched').toBeNull()
      const probe = await ffprobeJson(imp.out)
      expect(probe.streams.find((s) => s.codec_type === 'video')?.codec_name).toBe('h264')
      expect(probe.streams.find((s) => s.codec_type === 'audio')?.codec_name).toBe('aac')
      expect(Number(probe.format.duration ?? 0)).toBeGreaterThan(25)
      await assertFaststart(imp.out)
      await rm(imp.out, { force: true })

      // And the recording's own convert is the one that died — as a
      // deliberate cancel, not a crash (T-44's sentinel, unchanged).
      expect(rec.err, 'the recording convert was cancelled').toBeInstanceOf(ConvertCancelledError)
    },
    240_000
  )
})

describe('the convert reports a measured progress, or none (real ffmpeg, T-115)', () => {
  /**
   * The recording's bar was `Math.min(99, encodedSeconds * 2)` under a comment that said 1% per
   * second: a 5-minute take read 99% from 50 seconds in and sat there beside an enabled Discard.
   * Now `percent` is ffmpeg's `out_time` over the take's length (the recorder's own clock, handed
   * down by `promoteTempWebm`), capped at 99, and absent when no length is given. The unit proof
   * (`convertCancel.test.ts`) drives a fake child; here ffmpeg's real `-progress` output is
   * parsed, so the claim "out_time is the position in the OUTPUT" is the binary's, not ours.
   */
  const LEN = 6
  let src = ''

  beforeAll(async () => {
    src = path.join(workDir, 't115-progress.webm')
    await ff([
      '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=25:duration=${LEN}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${LEN}`,
      '-shortest',
      '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '500k',
      '-c:a', 'libvorbis',
      src
    ])
  }, 120_000)

  async function reports(durationSec?: number): Promise<Array<{ percent?: number }>> {
    const out = path.join(workDir, `t115-progress-${durationSec ?? 'none'}.mp4`)
    const seen: Array<{ percent?: number }> = []
    await convertToMp4('recording', src, out, (p) => seen.push(p), durationSec)
    await rm(out, { force: true })
    return seen
  }

  it('with the take\'s real length the last report is the end of the bar, never past 99', async () => {
    const seen = await reports(LEN)
    const percents = seen.map((p) => p.percent)
    expect(percents.length, 'ffmpeg reported at least once').toBeGreaterThan(0)
    expect(percents.every((p) => typeof p === 'number'), JSON.stringify(percents)).toBe(true)
    const nums = percents as number[]
    expect(nums.every((p) => p >= 0 && p <= 99), JSON.stringify(nums)).toBe(true)
    expect(nums, 'never goes backwards').toEqual([...nums].sort((a, b) => a - b))
    expect(nums.at(-1) ?? 0, `the last report (${JSON.stringify(nums)}) is the finished encode`).toBeGreaterThanOrEqual(90)
  }, 120_000)

  it('a length twice the file\'s puts the same encode at half the bar - it is a measurement, not a guess', async () => {
    const last = (await reports(LEN * 2)).at(-1)?.percent ?? -1
    expect(last, `the last report was ${last}`).toBeGreaterThanOrEqual(45)
    expect(last).toBeLessThanOrEqual(52)
  }, 120_000)

  it('a length far shorter than the file pins at 99 - the cap, not an overshoot', async () => {
    const last = (await reports(0.5)).at(-1)?.percent
    expect(last).toBe(99)
  }, 120_000)

  it('with no length it still ticks, and no tick carries a percent', async () => {
    const seen = await reports(undefined)
    expect(seen.length, 'ffmpeg reported at least once').toBeGreaterThan(0)
    expect(seen.some((p) => 'percent' in p), JSON.stringify(seen)).toBe(false)
  }, 120_000)
})

/** Encode to a pipe, then blank the DefaultDuration element: a MediaRecorder-shaped webm. */
async function mediaRecorderWebm(codec: 'libvpx-vp9' | 'libvpx', file: string, sec = 3): Promise<void> {
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=30:duration=${sec}`,
      '-fps_mode', 'passthrough', '-enc_time_base', '1:1000',
      '-c:v', codec, '-deadline', 'realtime', '-cpu-used', '8',
      // The jitter MediaRecorder's timestamps have: each packet lands within +-11 ms of its slot.
      '-bsf:v', "setts=ts='trunc(N*1000/30+11*sin(N*N))'",
      '-live', '1', '-f', 'webm', 'pipe:1'
    ])
    let stderr = ''
    child.stdout.on('data', (b: Buffer) => chunks.push(b))
    child.stderr.on('data', (b) => (stderr += String(b)))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`))
    )
  })
  const buf = Buffer.concat(chunks)
  // DefaultDuration is element id 23 E3 83; its size byte is 0x80 | length. An EBML Void is id 0xEC, so the
  // same bytes become a Void of the same total length and the file parses as before without the element.
  const at = buf.indexOf(Buffer.from([0x23, 0xe3, 0x83]))
  if (at >= 0) {
    const total = 4 + ((buf[at + 3] ?? 0) & 0x7f)
    buf.fill(0, at, at + total)
    buf[at] = 0xec
    buf[at + 1] = 0x80 | (total - 2)
  }
  await writeFile(file, buf)
}

describe('a MediaRecorder take: saved as WebM and converted to MP4 (real ffmpeg, T-120)', () => {
  /**
   * What Chromium's MediaRecorder writes is a STREAMED webm: the header has no duration (ffprobe prints
   * N/A), the container declares no frame rate (`r_frame_rate` 1000/1, `avg_frame_rate` 0/0: its clock ticks
   * in milliseconds) and the packets sit at irregular millisecond times. Three things broke on it, each
   * behind green unit tests because nothing here ever held a file of that shape:
   *  1. Convert off: the save was a plain copy, so the saved take had no duration, `probeVideo` refused it
   *     and "Edit in Video Studio" could not open the file Record had just written.
   *  2. Convert on: the mp4 muxer's default is a CONSTANT rate, so the convert wrote one frame per
   *     millisecond (QA measured 9575 frames for a 9.6 s take, 1m56s) and the file read 1000 fps.
   *  3. Either file read fps 1000 in `probeVideo`, so the Timeline's `,` and `.` stepped 1 ms.
   * The fixture is made the way the browser's file is: encoded to a PIPE (so there is no duration to write
   * back), with millisecond clocks (`-enc_time_base 1:1000`) and jittered packet times (`setts`), and the
   * muxer's own DefaultDuration element is overwritten with an EBML Void of the same length, which is the one
   * thing a streamed ffmpeg output has that the browser's does not. BOTH majors write it (T-122, measured on
   * 6.1.1 and 7.0.2: element 23 E3 83, 33,333,333 ns for this 30 fps source, and the unpatched pipe output
   * reads 30/1 on both), so the patch is what makes the file read 1000/1, and it is needed on both. Both
   * fixtures are checked to have QA's shape
   * BEFORE anything is judged on them: ffprobe says `duration=N/A`, `1000/1`, `0/0`.
   */
  const SEC = 3
  const fixtures: Record<'vp9' | 'vp8', string> = { vp9: '', vp8: '' }


  /** ffprobe's own reading of the first video stream, plus (optionally) the frames and packets it counts. */
  async function streamFacts(
    file: string,
    count: 'frames' | 'packets' | null = null
  ): Promise<{ r: string; avg: string; duration: string; counted: number }> {
    const args = ['-v', 'error', '-select_streams', 'v:0']
    if (count === 'frames') args.push('-count_frames')
    if (count === 'packets') args.push('-count_packets')
    args.push(
      '-show_entries', 'stream=r_frame_rate,avg_frame_rate,nb_read_frames,nb_read_packets:format=duration',
      '-of', 'json', file
    )
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(ffprobePath, args)
      let text = ''
      child.stdout.on('data', (b) => (text += String(b)))
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve(text) : reject(new Error(`ffprobe exit ${code} for ${file}`))
      )
    })
    const json = JSON.parse(out) as {
      streams: Array<Record<string, string>>
      format: Record<string, string>
    }
    const st = json.streams[0] ?? {}
    return {
      r: st.r_frame_rate ?? '',
      avg: st.avg_frame_rate ?? '',
      duration: json.format.duration ?? 'N/A',
      counted: Number(st.nb_read_frames ?? st.nb_read_packets ?? NaN)
    }
  }

  /** "num/den" as a number; 0 for 0/0 and for nonsense. */
  const rate = (r: string): number => {
    const [n, d] = r.split('/').map(Number)
    return n && d ? n / d : 0
  }

  beforeAll(async () => {
    fixtures.vp9 = path.join(workDir, 't120-mr-vp9.webm')
    fixtures.vp8 = path.join(workDir, 't120-mr-vp8.webm')
    await mediaRecorderWebm('libvpx-vp9', fixtures.vp9)
    await mediaRecorderWebm('libvpx', fixtures.vp8)
  }, 120_000)

  describe.each(['vp9', 'vp8'] as const)('a %s take', (kind) => {
    it('the fixture has the shape QA measured on a real MediaRecorder file: no duration, 1000/1, no average', async () => {
      // The trap has to be in the fixture, or a green run below is no evidence.
      const raw = await streamFacts(fixtures[kind])
      expect(raw.duration, 'streamed: no duration in the header').toBe('N/A')
      expect(raw.r).toBe('1000/1')
      expect(raw.avg).toBe('0/0')
      // And the product's own probe refuses it, which is bug 1 in one line.
      await expect(probeVideo(fixtures[kind])).rejects.toThrow(/no usable duration/)
    })

    it('Convert off: the save remux gives the saved take a duration, every packet, and a probe Video Studio accepts', async () => {
      const out = path.join(workDir, `t120-saved-${kind}.webm`)
      await remuxWebm('recording', fixtures[kind], out)

      // Bug 1: a finite duration of about the take's length, so `probeVideo` accepts it.
      const probe = await probeVideo(out)
      expect(Number.isFinite(probe.duration)).toBe(true)
      expect(probe.duration, `duration ${probe.duration}`).toBeGreaterThan(SEC - 0.5)
      expect(probe.duration).toBeLessThan(SEC + 0.5)
      expect(probe.videoCodec).toBe(kind)
      expect(probe.width).toBe(320)
      expect(probe.height).toBe(240)

      // Nothing was re-encoded: the same packets, the same container.
      const before = await streamFacts(fixtures[kind], 'packets')
      const after = await streamFacts(out, 'packets')
      expect(after.counted, 'every packet survives the copy').toBe(before.counted)
      expect((await ffprobeJson(out)).format.format_name).toContain('webm')

      // The fps outcome, MEASURED: no ffmpeg option writes a frame rate into a stream copy (7 variants of
      // `-r`, `-fps_mode` and `-fflags` on both majors left DefaultDuration at 1 ms), so the saved file still
      // READS 1000/1 - the muxer writes the stream's millisecond clock as its rate. `probeVideo` is where
      // that is made sane: above 240 fps a rate is "the file does not say" (0), which the Timeline and the
      // Player step at 30. If the first assertion ever FAILS, ffmpeg writes a real rate now and the probe's
      // ceiling is only a backstop.
      const container = await streamFacts(out)
      expect(container.avg, 'KNOWN: a stream copy cannot carry a frame rate; if this FAILS, ffmpeg changed').toBe('1000/1')
      expect(probe.fps, 'probeVideo: 1000 fps is a clock, not a rate').toBe(0)
      await rm(out, { force: true })
    }, 60_000)

    it('Convert on: the mp4 has the frames the take has, at a sane rate, not one per millisecond', async () => {
      const out = path.join(workDir, `t120-converted-${kind}.mp4`)
      await convertToMp4('recording', fixtures[kind], out, () => undefined, SEC)

      const facts = await streamFacts(out, 'frames')
      const fps = rate(facts.avg)
      const duration = Number(facts.duration)
      // The fixture has 90 packets in 3 s. At 1000 fps constant the old argv wrote 2980 frames and read 1000/1.
      expect(fps, `avg_frame_rate ${facts.avg}`).toBeGreaterThan(20)
      expect(fps, `avg_frame_rate ${facts.avg}`).toBeLessThan(60)
      expect(facts.counted, `${facts.counted} frames in ${duration} s`).toBeGreaterThanOrEqual(SEC * 25)
      expect(facts.counted).toBeLessThanOrEqual(SEC * 35)
      // And the product's own reading of it: Video Studio steps at the take's real rate.
      const probe = await probeVideo(out)
      expect(probe.fps, `probeVideo fps ${probe.fps}`).toBeGreaterThan(20)
      expect(probe.fps).toBeLessThan(60)
      expect(probe.videoCodec).toBe('h264')
      await rm(out, { force: true })
    }, 60_000)

    /**
     * T-121 (1): the fps class, closed. T-120's remux made a Record WebM (`1000/1`, no average) reach three more
     * libx264/mp4 consumers than the convert it had fixed, and none of them said how to keep the frames:
     * the caption burn-in, the picture-in-picture composite and the cut re-attach. Each is asserted the way
     * the convert is: the file's own frame rate is a camera's, not a millisecond clock, and the picture has
     * the take's frames, not one per millisecond (the burn-in measured 2987 frames for a 3 s take and "More
     * than 1000 frames duplicated" on stderr; the re-attach with a cut measured 0.07 s of picture).
     */
    it('T-121: the caption burn-in writes the take at a sane rate, not one frame per millisecond', async () => {
      const srt = path.join(workDir, `t121-burn-${kind}.srt`)
      await writeFile(srt, '1\n00:00:00,200 --> 00:00:02,500\nA CAPTION ON A RECORDING\n', 'utf8')
      const out = path.join(workDir, `t121-burn-${kind}.mp4`)
      const res = await runBurnIn(
        { jobId: `t121-burn-${kind}`, videoPath: fixtures[kind], srtPath: srt, outputPath: out, fontSizePct: 4 },
        () => {}
      )
      // A caption was burned (the cue is inside the take), so this is the subtitle-stage argv.
      expect(res.captioned).toBe(true)
      const facts = await streamFacts(out, 'frames')
      const fps = rate(facts.avg)
      const duration = Number(facts.duration)
      expect(fps, `avg_frame_rate ${facts.avg}`).toBeGreaterThan(20)
      expect(fps, `avg_frame_rate ${facts.avg}`).toBeLessThan(60)
      expect(facts.counted, `${facts.counted} frames in ${duration} s`).toBeGreaterThanOrEqual(SEC * 25)
      expect(facts.counted).toBeLessThanOrEqual(SEC * 35)
      expect(Math.abs(duration - SEC), `duration ${duration}`).toBeLessThan(0.5)
      await rm(out, { force: true })
    }, 120_000)

    it('T-121: the picture-in-picture composite writes the take at a sane rate too', async () => {
      // An overlay as long as the take: a silent base shorter than its overlay runs on to the overlay's length
      // with a frozen last frame (`-shortest` has no audio stream to bound it - T-110 (ac), recorded), and the
      // frame count here is the take's, not the freeze's.
      const overlay = path.join(workDir, 't121-pip-overlay.mp4')
      await ff([
        '-y', '-f', 'lavfi', '-i', `color=c=0x1fe04a:size=640x360:rate=30:duration=${SEC}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', overlay
      ])
      const out = path.join(workDir, `t121-pip-${kind}.mp4`)
      await runPipComposite(`t121-pip-${kind}`, fixtures[kind], overlay, out, {
        overlayWidth: 100,
        position: 'bottom-right',
        margin: 10
      })
      const facts = await streamFacts(out, 'frames')
      const fps = rate(facts.avg)
      const duration = Number(facts.duration)
      expect(fps, `avg_frame_rate ${facts.avg}`).toBeGreaterThan(20)
      expect(fps, `avg_frame_rate ${facts.avg}`).toBeLessThan(60)
      expect(facts.counted, `${facts.counted} frames in ${duration} s`).toBeGreaterThanOrEqual(SEC * 25)
      expect(facts.counted).toBeLessThanOrEqual(SEC * 35)
      expect(Math.abs(duration - SEC), `duration ${duration}`).toBeLessThan(0.5)
      await rm(out, { force: true })
    }, 120_000)

    it('T-121: re-attaching cleaned sound with one cut keeps the rest of the picture, as long as the sound', async () => {
      // The take is 3 s; cut 1.0-2.0 s, so 2 s of picture and (the chain having closed the same cut in the sound)
      // 2 s of cleaned audio. `setpts=N/FRAME_RATE/TB` read the container's 1000/1 as the frame rate and spaced
      // the survivors 1 ms apart: 0.07 s of picture under 2 s of sound, `-shortest` ending the file with the picture.
      const cut = { startSec: 1, endSec: 2 }
      const kept = SEC - (cut.endSec - cut.startSec)
      const cleaned = path.join(workDir, `t121-cleaned-${kind}.wav`)
      await ff(['-y', '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${kept}`, '-ac', '2', cleaned])
      const out = path.join(workDir, `t121-mux-${kind}.mp4`)
      await runAudioMux(`t121-mux-${kind}`, fixtures[kind], cleaned, out, () => {}, [cut])
      const info = await ffprobeJson(out)
      const v = info.streams.find((s) => s.codec_type === 'video')
      const a = info.streams.find((s) => s.codec_type === 'audio')
      const vDur = Number(v?.duration)
      const aDur = Number(a?.duration)
      expect(vDur, `video ${vDur} s`).toBeGreaterThan(kept - 0.35)
      expect(vDur, `video ${vDur} s`).toBeLessThan(kept + 0.35)
      expect(aDur, `audio ${aDur} s`).toBeGreaterThan(kept - 0.25)
      expect(Math.abs(vDur - aDur), `video ${vDur} s vs audio ${aDur} s`).toBeLessThan(0.35)
      // And it is the take's frames, at a sane rate: 90 frames in 3 s, a third of them cut.
      const facts = await streamFacts(out, 'frames')
      const fps = rate(facts.avg)
      expect(fps, `avg_frame_rate ${facts.avg}`).toBeGreaterThan(20)
      expect(fps, `avg_frame_rate ${facts.avg}`).toBeLessThan(60)
      expect(facts.counted, `${facts.counted} frames`).toBeGreaterThanOrEqual(kept * 25)
      expect(facts.counted).toBeLessThanOrEqual(kept * 35)
      await rm(out, { force: true })
      await rm(cleaned, { force: true })
    }, 120_000)
  })

  it('sources that already have a steady rate keep every frame through the convert (the importer shares it)', async () => {
    // The same argv converts a recording AND an imported flv / wmv / mpg. A variable-rate output mode that
    // dropped or duplicated frames on a constant-rate source would be a regression in the importer.
    for (const ext of ['flv', 'wmv', 'mpg'] as const) {
      const src = path.join(workDir, `t120-steady.${ext}`)
      await ff([
        '-y', '-f', 'lavfi', '-i', 'testsrc2=duration=2:size=320x240:rate=25',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', src
      ])
      const out = path.join(workDir, `t120-steady-${ext}.mp4`)
      await convertToMp4('import', src, out, () => undefined)
      const facts = await streamFacts(out, 'frames')
      expect(facts.avg, `${ext}: avg_frame_rate`).toBe('25/1')
      expect(facts.counted, `${ext}: frames`).toBe(50)
      await rm(src, { force: true })
      await rm(out, { force: true })
    }
  }, 120_000)

  it('a real 30 fps file still reads 30: the probe ceiling touches nothing a camera or OBS writes', async () => {
    expect((await probeVideo(landscapeSrc)).fps).toBe(30)
  })
})

describe('a canceled job leaves no half-written file, and a Cancel before its ffmpeg exists still cancels (real ffmpeg, T-98 + T-100)', () => {
  /**
   * Two halves of one promise made by the Cancel button, each of which a fake
   * child cannot keep for a real binary.
   *
   * T-100: ffmpeg opens its output when it starts and writes the container's
   * index (an MP4's moov atom, a GIF's trailer) when it ends, so a killed run
   * leaves a file with a real name that no player opens, in the folder the
   * toast calls "finished". Each runner now removes ITS OWN output on a cancel
   * (cancelSentinel.test.ts proves that against a fake child, for every runner;
   * here the file is the one a real ffmpeg wrote and a real SIGKILL cut off).
   *
   * T-98: every runner that cuts a clip probes the source with the real ffprobe
   * before it spawns, and a Cancel in that wait used to find nothing to kill:
   * the job carried on and finished. Here the Cancel is issued in the same tick
   * as the call, so the probe is certainly still in flight.
   */
  let longVideo = '' // 1080p, 60 s: an encode that is still running when Cancel lands
  let longAudio = '' // an hour of 8 kHz mono: a noise-removal render that outlasts the test

  beforeAll(async () => {
    longVideo = path.join(workDir, 'cancel-long.mp4')
    await ff([
      '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=60',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=60',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest',
      longVideo
    ])
    longAudio = path.join(workDir, 'cancel-long.mp3')
    await ff([
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=3600',
      '-ac', '1', '-b:a', '32k', longAudio
    ])
  }, 240_000)

  /** Park a runner's outcome so a rejection cannot take the run down early. */
  const settle = <T>(p: Promise<T>): Promise<{ value?: T; err?: unknown }> =>
    p.then(
      (value) => ({ value }),
      (err: unknown) => ({ err })
    )

  /** Wait for the file the running ffmpeg opens — proof the kill lands mid-write. */
  async function untilExists(file: string, what: string): Promise<void> {
    const deadline = Date.now() + 60_000
    while (!existsSync(file) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    expect(existsSync(file), `${what}: ffmpeg opened its output`).toBe(true)
  }

  it('a canceled export removes its half-written file and leaves the finished job beside it', async () => {
    const finishedPath = path.join(workDir, 'sibling-finished.mp4')
    const killedPath = path.join(workDir, 'sibling-killed.mp4')
    const finished = await runExportJob(
      {
        ...makeJob(longVideo, 'youtube', makeClip({ startSec: 0, endSec: 1 }), 'sib-ok'),
        outputFilename: 'sibling-finished.mp4'
      },
      () => {}
    )
    const running = settle(
      runExportJob(
        {
          ...makeJob(longVideo, 'youtube', makeClip({ startSec: 0, endSec: 50 }), 'sib-killed'),
          outputFilename: 'sibling-killed.mp4'
        },
        () => {}
      )
    )
    await untilExists(killedPath, 'export')
    // The batch's Cancel (T-108: the per-job one had no caller and is gone).
    cancelAllExportJobs()
    expect(isCancelledError((await running).err)).toBe(true)

    expect(existsSync(killedPath), 'the half-written export is gone').toBe(false)
    expect(finished.outputPath).toBe(finishedPath)
    const kept = await ffprobeJson(finishedPath)
    expect(Number(kept.format.duration)).toBeGreaterThan(0.8)
  }, 180_000)

  it('a canceled GIF removes its half-written file', async () => {
    const gifPath = path.join(workDir, 'cancel-long_480px_15fps.gif')
    const running = settle(
      runGifExport({
        jobId: 'gif-killed',
        sourcePath: longVideo,
        outDir: workDir,
        startSec: 0,
        endSec: 50,
        width: 480,
        fps: 15,
        speed: 1
      })
    )
    await untilExists(gifPath, 'GIF')
    expect(cancelGifJob('gif-killed')).toBe(true)
    expect(isCancelledError((await running).err)).toBe(true)
    expect(existsSync(gifPath), 'the half-written GIF is gone').toBe(false)
  }, 180_000)

  it('a canceled reframe removes its half-written file', async () => {
    const out = path.join(workDir, 'reframe-killed.mp4')
    const running = settle(
      runReframe(
        {
          jobId: 'reframe-killed',
          sourcePath: longVideo,
          outputPath: out,
          position: 'center',
          startSec: 0,
          endSec: 50,
          outputWidth: 1080,
          outputHeight: 1920
        },
        () => {}
      )
    )
    await untilExists(out, 'reframe')
    expect(cancelReframeJob('reframe-killed')).toBe(true)
    expect(isCancelledError((await running).err)).toBe(true)
    expect(existsSync(out), 'the half-written reframe is gone').toBe(false)
  }, 180_000)

  it('a canceled audio render removes its half-written file', async () => {
    const out = path.join(workDir, 'audio-killed.mp3')
    const chain: ChainSpec = { ...DEFAULT_CHAIN_SPEC, denoise: 'aggressive' }
    const running = settle(
      runAudioExport(
        { jobId: 'audio-killed', sourcePath: longAudio, outputPath: out, chain, format: 'mp3' },
        () => {}
      )
    )
    await untilExists(out, 'audio render')
    expect(cancelAudioJob('audio-killed')).toBe(true)
    expect(isCancelledError((await running).err)).toBe(true)
    expect(existsSync(out), 'the half-written audio is gone').toBe(false)
  }, 180_000)

  it('a canceled caption burn-in removes its half-written file', async () => {
    const srt = path.join(workDir, 'cancel-burn.srt')
    await writeFile(srt, '1\n00:00:00,000 --> 00:00:03,000\nhello\n', 'utf8')
    const out = path.join(workDir, 'burn-killed.mp4')
    const running = settle(
      runBurnIn(
        { jobId: 'burn-killed', videoPath: longVideo, srtPath: srt, outputPath: out, fontSizePct: 3.5 },
        () => {}
      )
    )
    await untilExists(out, 'burn-in')
    expect(cancelBurnIn('burn-killed')).toBe(true)
    expect(isCancelledError((await running).err)).toBe(true)
    expect(existsSync(out), 'the half-written burn-in is gone').toBe(false)
  }, 180_000)

  it('a file that was already there before the job started is left alone by a Cancel that lands in the probe', async () => {
    // ffmpeg had not opened its output, so last week's export is still the
    // user's file. (The probe is in flight when Cancel lands: no child exists.)
    const out = path.join(workDir, 'last-weeks.mp4')
    await copyFile(landscapeSrc, out)
    const running = settle(
      runExportJob(
        { ...makeJob(longVideo, 'youtube', makeClip({ startSec: 0, endSec: 50 }), 'stale'), outputFilename: 'last-weeks.mp4' },
        () => {}
      )
    )
    cancelAllExportJobs()
    expect(isCancelledError((await running).err)).toBe(true)
    expect(existsSync(out), 'the earlier export survived').toBe(true)
  }, 60_000)

  it('a canceled job beside an earlier export of the same name leaves that export alone (T-106)', async () => {
    // T-100 removes the file a canceled job was writing. When the job wrote to the
    // SAME path as an earlier, finished export, the file it was writing WAS the
    // earlier export — so a Cancel on the second run deleted the first run's
    // result. The second job now writes to "name (2)" and its wreckage is that
    // file alone. An export and a GIF, since both runners clean up after a stop.
    const dupDir = await mkdtemp(path.join(workDir, 't106-cancel-'))
    const exportFirst = (
      await runExportJob(
        {
          ...makeJob(landscapeSrc, 'youtube', makeClip({ startSec: 0, endSec: 1 }), 'dup-first'),
          outDir: dupDir,
          outputFilename: 'dup.mp4'
        },
        () => {}
      )
    ).outputPath
    const gifFirst = (
      await runGifExport({
        jobId: 'dup-gif-first',
        sourcePath: longVideo,
        outDir: dupDir,
        startSec: 0,
        endSec: 1,
        width: 480,
        fps: 15,
        speed: 1
      })
    ).outputPath
    const exportBefore = await fileSha(exportFirst)
    const gifBefore = await fileSha(gifFirst)

    /** Wait until the second job has begun writing: a new file, or (the bug) the old one rewritten. */
    async function untilWriting(second: string, first: string, before: string): Promise<void> {
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline && !existsSync(second) && (await fileSha(first)) === before) {
        await new Promise((r) => setTimeout(r, 50))
      }
    }

    const runningExport = settle(
      runExportJob(
        {
          ...makeJob(longVideo, 'youtube', makeClip({ startSec: 0, endSec: 50 }), 'dup-second'),
          outDir: dupDir,
          outputFilename: 'dup.mp4'
        },
        () => {}
      )
    )
    await untilWriting(path.join(dupDir, 'dup (2).mp4'), exportFirst, exportBefore)
    cancelAllExportJobs()
    expect(isCancelledError((await runningExport).err)).toBe(true)
    expect(existsSync(exportFirst), 'the earlier export is still there').toBe(true)
    expect(await fileSha(exportFirst), 'and is byte for byte what it was').toBe(exportBefore)
    expect(existsSync(path.join(dupDir, 'dup (2).mp4')), 'the canceled job\'s own file is gone').toBe(false)

    const runningGif = settle(
      runGifExport({
        jobId: 'dup-gif-second',
        sourcePath: longVideo,
        outDir: dupDir,
        startSec: 0,
        endSec: 50,
        width: 480,
        fps: 15,
        speed: 1
      })
    )
    await untilWriting(path.join(dupDir, 'cancel-long_480px_15fps (2).gif'), gifFirst, gifBefore)
    cancelGifJob('dup-gif-second')
    expect(isCancelledError((await runningGif).err)).toBe(true)
    expect(existsSync(gifFirst), 'the earlier GIF is still there').toBe(true)
    expect(await fileSha(gifFirst), 'and is byte for byte what it was').toBe(gifBefore)
  }, 180_000)

  // ── T-98: Cancel while the real ffprobe is still running ─────────────────

  it('export: a Cancel in the probe (the batch\'s Cancel) refuses the job, writes nothing, and the next job is not marked', async () => {
    // (Imported statically with `runExportJob`: the stand-in tests above call
    // vi.resetModules(), and a dynamic import here would be a SECOND copy of the
    // module with its own latch — canceling runs the job under test never opened.)
    const out = path.join(workDir, 'probe-cancel-export.mp4')
    const job = (id: string): ExportJobSpec => ({
      ...makeJob(landscapeSrc, 'youtube', makeClip(), id),
      outputFilename: 'probe-cancel-export.mp4'
    })
    const running = settle(runExportJob(job('probe-1'), () => {}))
    cancelAllExportJobs()
    expect(isCancelledError((await running).err)).toBe(true)
    await new Promise((r) => setTimeout(r, 500))
    expect(existsSync(out), 'no job was started').toBe(false)

    // The click was spent on that job: the next one, same name, runs.
    const next = await runExportJob(job('probe-2'), () => {})
    expect(existsSync(next.outputPath)).toBe(true)
  }, 120_000)

  it('GIF (cropped, so it probes first): a Cancel in the probe writes nothing', async () => {
    const out = path.join(workDir, 'cancel-long_320px_10fps.gif')
    const running = settle(
      runGifExport({
        jobId: 'gif-probe',
        sourcePath: longVideo,
        outDir: workDir,
        startSec: 0,
        endSec: 3,
        width: 320,
        fps: 10,
        speed: 1,
        cropRect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }
      })
    )
    cancelGifJob('gif-probe')
    expect(isCancelledError((await running).err)).toBe(true)
    await new Promise((r) => setTimeout(r, 500))
    expect(existsSync(out)).toBe(false)
  }, 60_000)

  it('reframe: a Cancel in the probe writes nothing', async () => {
    const out = path.join(workDir, 'reframe-probe-cancel.mp4')
    const running = settle(
      runReframe(
        {
          jobId: 'reframe-probe',
          sourcePath: landscapeSrc,
          outputPath: out,
          position: 'center',
          startSec: 0,
          endSec: 3,
          outputWidth: 1080,
          outputHeight: 1920
        },
        () => {}
      )
    )
    cancelReframeJob('reframe-probe')
    expect(isCancelledError((await running).err)).toBe(true)
    await new Promise((r) => setTimeout(r, 500))
    expect(existsSync(out)).toBe(false)
  }, 60_000)

  it('compilation: a Cancel in the probe writes nothing and leaves no scratch', async () => {
    const out = path.join(workDir, 'cancel-long_compilation.mp4')
    const running = settle(
      runConcat({
        jobId: 'concat-probe',
        sourcePath: longVideo,
        outDir: workDir,
        segments: [
          { startSec: 0, endSec: 2, name: 'a' },
          { startSec: 3, endSec: 5, name: 'b' }
        ],
        fadeMs: 0,
        width: 1280,
        height: 720
      })
    )
    cancelConcatJob('concat-probe')
    expect(isCancelledError((await running).err)).toBe(true)
    await new Promise((r) => setTimeout(r, 500))
    expect(existsSync(out)).toBe(false)
    const scratch = path.join(os.tmpdir(), 'imagii-concat')
    const leftovers = existsSync(scratch)
      ? (await readdir(scratch)).filter((f) => f.includes('concat-probe'))
      : []
    expect(leftovers).toEqual([])
  }, 60_000)

  it('highlight scan: a Cancel in the probe refuses the scan', async () => {
    const running = settle(findHighlights('scan-probe', landscapeSrc, () => {}))
    cancelActiveHighlightScan()
    const outcome = await running
    expect(isCancelledError(outcome.err)).toBe(true)
  }, 60_000)

  it('audio export: a Cancel in the probe writes nothing', async () => {
    const out = path.join(workDir, 'audio-probe-cancel.mp3')
    const running = settle(
      runAudioExport(
        { jobId: 'audio-probe', sourcePath: voiceWav, outputPath: out, chain: DEFAULT_CHAIN_SPEC, format: 'mp3' },
        () => {}
      )
    )
    cancelAudioJob('audio-probe')
    expect(isCancelledError((await running).err)).toBe(true)
    await new Promise((r) => setTimeout(r, 500))
    expect(existsSync(out)).toBe(false)
  }, 60_000)

  it('single-frame extract: a Cancel while the folder is being made writes no thumbnail', async () => {
    const out = path.join(workDir, 'thumbs-canceled', 'thumb_1.jpg')
    const running = settle(extractFrame(landscapeSrc, 1, out))
    cancelAllFrameJobs()
    expect(isCancelledError((await running).err)).toBe(true)
    await new Promise((r) => setTimeout(r, 500))
    expect(existsSync(out)).toBe(false)
    // …and the kit's next thumbnail is not marked by the click that stopped this one.
    const again = await extractFrame(landscapeSrc, 1, path.join(workDir, 'thumbs-canceled', 'thumb_2.jpg'))
    expect(existsSync(again.outputPath)).toBe(true)
  }, 60_000)
})

describe('audio extraction for non-WebAudio formats (real ffmpeg)', () => {
  // aiff/wma import routes through the same extract-to-wav path video
  // files already use. Prove ffmpeg actually reads each format.
  for (const ext of ['aiff', 'wma']) {
    it(`${ext}: extracts to a 48k stereo wav`, async () => {
      const src = path.join(workDir, `audio-fixture.${ext}`)
      await ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', src])
      const { wavPath, cleanup } = await extractAudioFromVideo(src)
      try {
        const probe = await probeAudio(wavPath)
        expect(probe.duration, ext).toBeGreaterThan(0.8)
        expect(probe.duration, ext).toBeLessThan(1.5)
        expect(probe.sampleRate, ext).toBe(48000)
      } finally {
        await cleanup()
      }
    }, 60_000)
  }
})

describe('a sound that starts late in its container stays where it was through the extraction (real ffmpeg, T-125 (2))', () => {
  // An MP4 (or a recording from a capture card) can start its sound after its picture: the sound stream's `start_time` is 0.278
  // here. The extraction wrote the sound from its FIRST sample, so every consumer put it at the start of the file: Clean audio's
  // Re-attach moved the sound early by exactly `start_time` (measured: a burst 0.278 s late in the source landed at 1.0 s, 0.278 s
  // early, on both majors), and the transcription, which shares the extractor, timed every burned caption 0.278 s early with it.
  // `-af aresample=async=1:first_pts=0` pads the head with silence so the WAV's clock is the container's.
  const LATE = 0.278
  const BURST_AT = 1.0 // in the sound's own timeline: a 0.3 s 1 kHz burst, silence around it
  let late = ''
  let onTime = ''

  const burstAt = async (file: string): Promise<number> => {
    const starts = await soundBurstStarts(file, 0.3, 0.5, true)
    expect(starts, `one burst in ${path.basename(file)}`).toHaveLength(1)
    return starts[0] as number
  }

  beforeAll(async () => {
    const sound = "aevalsrc='if(between(t,1,1.3),0.8*sin(2*PI*1000*t),0)':s=48000:d=2.7"
    late = path.join(workDir, 't125-late-audio.mp4')
    await ff([
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=3',
      '-itsoffset', String(LATE), '-f', 'lavfi', '-i', sound,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', late
    ])
    onTime = path.join(workDir, 't125-on-time-audio.mp4')
    await ff([
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=3', '-f', 'lavfi', '-i', sound,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', onTime
    ])
  }, 60_000)

  it('the fixtures are what they say: the late file\'s sound starts after its picture, the other\'s with it', async () => {
    const start = async (f: string): Promise<number> =>
      Number((await ffprobeJson(f)).streams.find((s) => s.codec_type === 'audio')?.start_time)
    expect(await start(late), 'the late file\'s sound').toBeGreaterThan(0.2)
    expect(Math.abs(await start(onTime)), 'the other file\'s sound').toBeLessThan(0.05)
    // On the container clock the late file's burst is at its offset plus its place in the sound, the other's is at its place.
    near(await burstAt(late), LATE + BURST_AT, 0.02, 'the late file\'s burst, as a player places it')
    near(await burstAt(onTime), BURST_AT, 0.02, 'the on-time file\'s burst')
  }, 60_000)

  it('the extracted WAV puts the burst where the container had it, for the studio and for the transcription alike', async () => {
    for (const [format, label] of [[undefined, 'the studio\'s 48 kHz stereo'], [TRANSCRIPTION_AUDIO, 'the transcription\'s 16 kHz mono']] as const) {
      const extracted = await extractAudioFromVideo(late, undefined, format)
      try {
        const starts = await soundBurstStarts(extracted.wavPath, 0.3, 0.5)
        expect(starts, label).toHaveLength(1)
        near(starts[0] as number, LATE + BURST_AT, 0.03, `${label}: the burst in the WAV (the sound began ${LATE} s into the file)`)
      } finally {
        await extracted.cleanup()
      }
    }
  }, 120_000)

  it('Clean audio -> Re-attach to video leaves the burst where it was', async () => {
    const extracted = await extractAudioFromVideo(late)
    try {
      const outputPath = path.join(workDir, 't125-late-reattached.mp4')
      await runAudioReattach(
        { jobId: 't125-late-reattach', videoPath: late, sourcePath: extracted.wavPath, outputPath, chain: { ...DEFAULT_CHAIN_SPEC } },
        () => {}
      )
      near(await burstAt(outputPath), LATE + BURST_AT, 0.03, `the burst in the re-attached file (it was ${LATE} s late in the source)`)
    } finally {
      await extracted.cleanup()
    }
  }, 120_000)

  it('a sound that starts with its picture is extracted to the SAME bytes as before the change', async () => {
    // The old command line, run directly: no `-af`. For a file whose sound starts at 0 the padding has nothing to do, and the stage
    // must not touch a sample (the WAV is what every studio, the cache and the transcription read).
    const before = path.join(workDir, 't125-extract-before.wav')
    await ff(['-y', '-i', onTime, '-vn', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', before])
    const extracted = await extractAudioFromVideo(onTime)
    try {
      expect(await fileSha(extracted.wavPath), 'the WAV of a file whose sound starts at 0').toBe(await fileSha(before))
    } finally {
      await extracted.cleanup()
    }
  }, 60_000)
})

describe('the extraction reads a picture from the streams, and a long file is extracted whole (real ffmpeg, T-126 (7), (8); T-129)', () => {
  // (7) `audio:extractFromVideo` decided "is this a video?" from the extension. An `.mkv` or `.mp4` that holds sound alone (a podcast, a
  // voice memo, a stream's audio-only rip) is not one: the renderer set the re-attach marker, so Re-attach was ON by default and its mux
  // dies on `-map 0:v:0` (and its 2-hour refusal sent the person to Video Studio, which refuses a file with no picture). The probe reads
  // the streams (cover art on an mp3 is a "video" stream that is not a picture), and the handler hands the answer to the renderer.
  // (8) asked a durationless file's scratch WAV for its length and deleted one over the 2-hour ceiling; T-129 retired the ceiling (the
  // waveform is main's streamed peaks now), so a long file is extracted and kept. The real handler runs here, behind a stand-in `ipcMain`;
  // ffmpeg and ffprobe are real.
  const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
  const files = {
    audioMkv: '', pictureMkv: '', coverMp3: '', audioMp4: '', longAudioMkv: '', durationlessWebm: '',
    shortDurationlessAudio: '', shortDurationlessPicture: ''
  }
  type Extracted = { wavPath: string; hasVideo: boolean | null }
  const extract = (file: string): Promise<Extracted> => {
    const handler = handlers.get('audio:extractFromVideo')
    if (!handler) throw new Error('audio:extractFromVideo is not registered')
    return handler({}, file) as Promise<Extracted>
  }

  /** ffmpeg with its stdout captured to `file` (a streamed container: nothing is written back, so it has no duration). */
  async function ffToFile(args: string[], file: string): Promise<void> {
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath, args)
      let stderr = ''
      child.stdout.on('data', (b: Buffer) => chunks.push(b))
      child.stderr.on('data', (b) => (stderr += String(b)))
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`))))
    })
    await writeFile(file, Buffer.concat(chunks))
  }

  beforeAll(async () => {
    vi.doMock('electron', () => ({
      ipcMain: { handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => void handlers.set(channel, fn) },
      dialog: {},
      BrowserWindow: {},
      shell: {},
      app: { getPath: () => os.tmpdir() }
    }))
    const { registerAudioIpc } = await import('../../src/main/ipc/audio')
    registerAudioIpc()

    const sine = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3']
    files.audioMkv = path.join(workDir, 't126-audio-only.mkv')
    await ff(['-y', ...sine, '-c:a', 'aac', files.audioMkv])
    files.audioMp4 = path.join(workDir, 't126-audio-only.mp4')
    await ff(['-y', ...sine, '-c:a', 'aac', files.audioMp4])
    files.pictureMkv = path.join(workDir, 't126-with-picture.mkv')
    await ff(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=3', ...sine, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', files.pictureMkv])
    // An mp3 with cover art: ffprobe lists the picture as a video stream, flagged attached_pic.
    const cover = path.join(workDir, 't126-cover.jpg')
    await ff(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x160:rate=1:duration=1', '-frames:v', '1', cover])
    files.coverMp3 = path.join(workDir, 't126-cover.mp3')
    await ff(['-y', ...sine, '-i', cover, '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic', '-id3v2_version', '3', files.coverMp3])
    // Sound alone, 2 h 1 s, with a duration in its header (a normal file): PCM at 8 kHz mono is 115 MB and takes a second to write.
    files.longAudioMkv = path.join(workDir, 't126-long-audio-only.mkv')
    await ff(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '7201', '-c:a', 'pcm_s16le', files.longAudioMkv])
    // A 2 h+ WebM with NO duration in its header (a streamed file: what MediaRecorder writes): a 61 s Opus base looped by stream copy
    // (3 s to make; encoding 2 h of silence takes two minutes), written to a pipe so nothing is written back.
    const base = path.join(workDir, 't126-base61.webm')
    await ff(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '61', '-c:a', 'libopus', '-b:a', '6k', base])
    files.durationlessWebm = path.join(workDir, 't126-2h-durationless.webm')
    await ffToFile(['-v', 'error', '-y', '-stream_loop', '118', '-i', base, '-c', 'copy', '-live', '1', '-f', 'webm', 'pipe:1'], files.durationlessWebm)
    // T-127 (10): and two SHORT streamed WebMs, the shape MediaRecorder writes (no duration): sound alone, and a picture with its sound.
    files.shortDurationlessAudio = path.join(workDir, 't127-durationless-audio.webm')
    await ffToFile(['-v', 'error', '-y', ...sine, '-c:a', 'libopus', '-live', '1', '-f', 'webm', 'pipe:1'], files.shortDurationlessAudio)
    files.shortDurationlessPicture = path.join(workDir, 't127-durationless-picture.webm')
    await ffToFile(
      ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=3', ...sine, '-c:v', 'libvpx', '-c:a', 'libopus', '-live', '1', '-f', 'webm', 'pipe:1'],
      files.shortDurationlessPicture
    )
  }, 240_000)

  afterAll(() => {
    vi.doUnmock('electron')
  })

  it('the probe\'s hasVideo is a picture: sound alone is false (an mkv, an mp4), a picture is true, cover art is not one', async () => {
    expect((await probeAudio(files.audioMkv)).hasVideo, 'audio-only mkv').toBe(false)
    expect((await probeAudio(files.audioMp4)).hasVideo, 'audio-only mp4').toBe(false)
    expect((await probeAudio(files.pictureMkv)).hasVideo, 'mkv with a picture').toBe(true)
    // The fixture really does carry a video stream, or the false below proves nothing.
    expect((await ffprobeJson(files.coverMp3)).streams.some((s) => s.codec_type === 'video'), 'the mp3 carries its cover as a video stream').toBe(true)
    expect((await probeAudio(files.coverMp3)).hasVideo, 'an mp3 with cover art').toBe(false)
  }, 60_000)

  it('the handler hands the streams\' answer to the renderer with the WAV, for a picture and for sound alone', async () => {
    for (const [file, expected] of [[files.audioMkv, false], [files.audioMp4, false], [files.pictureMkv, true]] as const) {
      const { wavPath, hasVideo } = await extract(file)
      try {
        expect(hasVideo, path.basename(file)).toBe(expected)
        const probe = await probeAudio(wavPath)
        expect(probe.sampleRate).toBe(48000)
        expect(probe.duration).toBeGreaterThan(2.5)
      } finally {
        await rm(wavPath, { force: true })
      }
    }
  }, 120_000)

  it('an audio-only mkv loads and exports without Re-attach; the Re-attach the old default turned on is the mux that fails', async () => {
    const { wavPath, hasVideo } = await extract(files.audioMkv)
    try {
      expect(hasVideo).toBe(false)
      // What the studio does with `fromVideo` null: a plain audio export of the WAV. It works.
      const exported = path.join(workDir, 't126-audio-only-export.mp3')
      await runAudioExport(
        { jobId: 't126-audio-only-export', sourcePath: wavPath, outputPath: exported, format: 'mp3', bitrate: '192k', chain: { ...DEFAULT_CHAIN_SPEC } },
        () => {}
      )
      expect((await ffprobeJson(exported)).streams.map((s) => s.codec_type)).toEqual(['audio'])
      // What Re-attach did on that file (the extension said "video"): `-map 0:v:0` has nothing to map.
      await expect(
        runAudioReattach(
          { jobId: 't126-audio-only-reattach', videoPath: files.audioMkv, sourcePath: wavPath, outputPath: path.join(workDir, 't126-audio-only-reattach.mp4'), chain: { ...DEFAULT_CHAIN_SPEC } },
          () => {}
        )
      ).rejects.toThrow()
    } finally {
      await rm(wavPath, { force: true })
    }
  }, 120_000)

  // T-129 flips the next two: they pinned the 2-hour ceiling (a refusal before the work, and a refused scratch deleted with it). The
  // ceiling is retired with the renderer's decode, so the same two files are EXTRACTED: the real WAV is the full length, it is the file
  // the studio opens (not wreckage), and the picture answer still comes from the streams. Each WAV is ~1.4 GB, removed by the case.
  it('an audio-only mkv over two hours is extracted (no ceiling, T-129): a full-length WAV, and no picture', async () => {
    const { wavPath, hasVideo } = await extract(files.longAudioMkv)
    try {
      expect(hasVideo, 'sound alone: no Re-attach').toBe(false)
      expect((await probeAudio(wavPath)).duration, 'the whole 2 h 1 s').toBeCloseTo(7201, 0)
      expect(existsSync(wavPath), 'the scratch is the file the studio opens').toBe(true)
    } finally {
      await rm(wavPath, { force: true })
    }
  }, 300_000)

  it('a durationless file longer than two hours is extracted too (no ceiling, T-129), and its WAV is kept for the studio', async () => {
    const fixture = await ffprobeJson(files.durationlessWebm)
    expect(fixture.format.duration, 'no duration in the header: the length is known only once it is extracted').toBeUndefined()
    expect(fixture.streams.map((s) => s.codec_type), 'and it is sound alone').toEqual(['audio'])
    const { wavPath, hasVideo } = await extract(files.durationlessWebm)
    try {
      // T-127 (10): the probe could not give a LENGTH but it read the streams, and this one is sound alone.
      expect(hasVideo, 'the streams say sound alone, whatever the .webm extension says').toBe(false)
      expect((await probeAudio(wavPath)).duration, 'over two hours').toBeGreaterThan(7200)
      expect(existsSync(wavPath), 'kept: the T-126 (8) backstop that deleted it went with the ceiling').toBe(true)
    } finally {
      await rm(wavPath, { force: true })
    }
  }, 300_000)

  it('a durationless file still answers whether it has a picture: sound alone false, a picture true (T-127 (10))', async () => {
    for (const file of [files.shortDurationlessAudio, files.shortDurationlessPicture]) {
      expect((await ffprobeJson(file)).format.duration, `${path.basename(file)} is streamed: no duration in the header`).toBeUndefined()
    }
    // The probe: refuses for the length (as it always did), and carries the streams' answer on the refusal.
    for (const [file, expected] of [[files.shortDurationlessAudio, false], [files.shortDurationlessPicture, true]] as const) {
      const err = await probeAudio(file).catch((e: unknown) => e)
      expect(err, path.basename(file)).toBeInstanceOf(NoUsableDurationError)
      expect((err as NoUsableDurationError).message).toMatch(/no usable duration/)
      expect((err as NoUsableDurationError).hasVideo, `${path.basename(file)}: a picture?`).toBe(expected)
    }
    // The handler: the answer reaches the renderer with the WAV, so Re-attach is not turned on for sound alone.
    for (const [file, expected] of [[files.shortDurationlessAudio, false], [files.shortDurationlessPicture, true]] as const) {
      const { wavPath, hasVideo } = await extract(file)
      try {
        expect(hasVideo, `${path.basename(file)}: the streams decide, not the .webm extension`).toBe(expected)
        expect((await probeAudio(wavPath)).duration).toBeGreaterThan(2.5)
      } finally {
        await rm(wavPath, { force: true })
      }
    }
  }, 120_000)
})

describe('the waveform is read from a stream of the sound in main, into the right buckets at the right heights (real ffmpeg, T-129)', () => {
  // T-129 (T-110 (ao)): Audio Studio decoded the WHOLE file in the renderer to draw its waveform (3.25 GB of renderer memory for a 1 h
  // WAV), so T-123 refused anything over two hours. Main now decodes the sound as a stream (mono, 8 kHz, raw PCM into a pipe) and folds
  // each chunk into PEAK_BUCKETS highest/lowest pairs as it arrives. A unit test can only say what the command line looks like; this
  // runs the real decode. The fixture is the shape extraction writes (48 kHz STEREO) with two 250 Hz bursts at known times and known
  // heights - 0.5 at [5.0, 6.0) s and 0.25 at [12.0, 12.5) s, digital silence elsewhere - so a bucket that is wrong in time or in height,
  // a downmix that halves or doubles a channel, or a fold that misreads a sign is a number on the page.
  const BURSTS = [
    { from: 5, to: 6, amp: 0.5 },
    { from: 12, to: 12.5, amp: 0.25 }
  ] as const
  const LENGTH = 20
  let burstWav = ''
  let longWav = ''
  let oddWav = ''

  beforeAll(async () => {
    burstWav = path.join(workDir, 't129-bursts.wav')
    const expr = BURSTS.map((b) => `${b.amp}*sin(2*PI*250*t)*gte(t,${b.from})*lt(t,${b.to})`).join('+')
    await ff(['-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}|${expr}':s=48000:d=${LENGTH}`, '-c:a', 'pcm_s16le', burstWav])
    // A 2 h 5 min file for the memory and Cancel cases: 8 kHz unsigned 8-bit mono, 60 MB, written in about two seconds; its decode
    // pipes 120 MB of PCM through the job.
    longWav = path.join(workDir, 't129-long.wav')
    await ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=7500', '-c:a', 'pcm_u8', longWav])
    // A WAV whose format tag no decoder knows (0x9999): ffprobe reads a sound stream and a 3 s length from its header, ffmpeg has
    // nothing to decode it with (both majors: "Decoding requested, but no decoder found for: none", exit 234).
    oddWav = path.join(workDir, 't129-unknown-format.wav')
    const rate = 8000
    const data = Buffer.alloc(rate * 2 * 3)
    const fmt = Buffer.alloc(16)
    fmt.writeUInt16LE(0x9999, 0)
    fmt.writeUInt16LE(1, 2)
    fmt.writeUInt32LE(rate, 4)
    fmt.writeUInt32LE(rate * 2, 8)
    fmt.writeUInt16LE(2, 12)
    fmt.writeUInt16LE(16, 14)
    const body = Buffer.concat([
      Buffer.from('WAVEfmt '), Buffer.from([16, 0, 0, 0]), fmt, Buffer.from('data'), Buffer.alloc(4), data
    ])
    body.writeUInt32LE(data.length, 4 + 8 + 16 + 4)
    const riff = Buffer.alloc(8)
    riff.write('RIFF', 0)
    riff.writeUInt32LE(body.length, 4)
    await writeFile(oddWav, Buffer.concat([riff, body]))
  }, 120_000)

  it('each burst lands in the buckets of its time at its height, and the silence between is flat', async () => {
    const progress: number[] = []
    const { peaks, duration } = await readPeaks(burstWav, 't129-bursts', (p) => progress.push(p.percent))
    const [high, low] = peaks
    expect(duration).toBeCloseTo(LENGTH, 3)
    expect(high).toHaveLength(PEAK_BUCKETS)
    expect(low).toHaveLength(PEAK_BUCKETS)
    const perSec = PEAK_BUCKETS / LENGTH // 200 buckets a second: 5 ms each
    const bucketAt = (t: number): number => Math.floor(t * perSec)
    for (const b of BURSTS) {
      // Inside (20 ms clear of each edge, where the resampler's filter rings): the burst's own height, both halves, not halved by the
      // downmix of two equal channels and not doubled either.
      const inside = high.slice(bucketAt(b.from + 0.02), bucketAt(b.to - 0.02))
      const insideLow = low.slice(bucketAt(b.from + 0.02), bucketAt(b.to - 0.02))
      expect(Math.min(...inside), `burst at ${b.from} s: lowest bucket top`).toBeGreaterThan(b.amp * 0.94)
      expect(Math.max(...inside), `burst at ${b.from} s: highest bucket top`).toBeLessThan(b.amp * 1.04)
      expect(Math.max(...insideLow), `burst at ${b.from} s: shallowest bucket bottom`).toBeLessThan(-b.amp * 0.94)
      expect(Math.min(...insideLow), `burst at ${b.from} s: deepest bucket bottom`).toBeGreaterThan(-b.amp * 1.04)
      // Its edges: the first and last bucket over half its height are the buckets of its start and end, to one bucket (5 ms).
      const half = b.amp / 2
      const first = high.findIndex((v, i) => i >= bucketAt(b.from - 0.5) && v > half)
      const last = high.length - 1 - [...high].reverse().findIndex((v, i) => high.length - 1 - i < bucketAt(b.to + 0.5) && v > half)
      expect(Math.abs(first - bucketAt(b.from)), `burst at ${b.from} s starts in bucket ${first}, expected ${bucketAt(b.from)}`).toBeLessThanOrEqual(1)
      expect(Math.abs(last - (bucketAt(b.to) - 1)), `burst at ${b.from} s ends in bucket ${last}, expected ${bucketAt(b.to) - 1}`).toBeLessThanOrEqual(1)
    }
    // The silence, 30 ms clear of every burst: flat.
    const quiet = high
      .map((v, i) => ({ v: Math.max(v, -(low[i] as number)), t: i / perSec }))
      .filter(({ t }) => BURSTS.every((b) => t < b.from - 0.03 || t > b.to + 0.03))
    expect(quiet.length).toBeGreaterThan(3000)
    expect(Math.max(...quiet.map((q) => q.v)), 'silence draws no bar').toBeLessThan(0.005)
    // Progress said how far it had read, never backwards, and ended at 100.
    expect(progress[progress.length - 1]).toBe(100)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
  }, 120_000)

  it('a 2 h 5 min file is the same 4000 pairs, read as a stream: this process holds no more than a few MB more while 120 MB of sound goes through it', async () => {
    const before = process.memoryUsage().rss
    let peak = before
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss)
    }, 5)
    let percents = 0
    const started = Date.now()
    let result: Awaited<ReturnType<typeof readPeaks>>
    try {
      result = await readPeaks(longWav, 't129-long', () => {
        percents += 1
        peak = Math.max(peak, process.memoryUsage().rss)
      })
    } finally {
      clearInterval(sampler)
    }
    const grewMb = (peak - before) / 1048576
    console.info(`[t129] 2h05m peaks: ${Date.now() - started} ms, rss ${Math.round(before / 1048576)} MB -> peak ${Math.round(peak / 1048576)} MB (+${grewMb.toFixed(1)} MB), ${percents} progress events`)
    expect(result.duration).toBeCloseTo(7500, 0)
    expect(result.peaks[0]).toHaveLength(PEAK_BUCKETS)
    // lavfi's `sine` is 1/8 of full scale (0.125, 0.117 after 8-bit PCM and the resampler): every bucket of the 2 h is the tone's
    // height, so the whole length was read and drawn, not a head of it.
    expect(Math.min(...result.peaks[0]), 'the whole length is drawn').toBeGreaterThan(0.1)
    expect(Math.max(...result.peaks[0])).toBeLessThan(0.14)
    expect(percents, 'progress all the way through').toBeGreaterThanOrEqual(90)
    // The decoded sound is 120 MB; a job that kept it (or kept the chunks to fold at the end) grows by about that much (measured: +116 MB
    // with the chunks kept, +13 to +26 MB streamed - the garbage collector's own slack). Half of it is the line.
    expect(grewMb, `this process grew ${grewMb.toFixed(1)} MB while reading a 2 h file`).toBeLessThan(60)
  }, 120_000)

  it('a file whose sound ffmpeg cannot decode is the finished sentence, not ffmpeg\'s words', async () => {
    // The trap first: the probe reads it (a sound stream and a length), so nothing before the decode refuses it.
    expect((await probeAudio(oddWav)).duration).toBeCloseTo(3, 1)
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const err = await readPeaks(oddWav, 't129-odd', () => undefined).catch((e: unknown) => e as Error)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toBe(WAVEFORM_READ_FAILED)
      expect(String(quiet.mock.calls[0]?.[0]), 'ffmpeg\'s own words go to the console').toMatch(/no decoder found|Decoder|decod/i)
    } finally {
      quiet.mockRestore()
    }
  }, 60_000)

  it('Cancel kills the real ffmpeg mid-read: the job answers the cancel sentinel at once, and no decoder is left running', async () => {
    let started: () => void = () => undefined
    const reading = new Promise<void>((resolve) => (started = resolve))
    const job = readPeaks(longWav, 't129-cancel', () => started()).then(
      () => 'finished',
      (err: unknown) => err
    )
    await reading
    const at = Date.now()
    expect(cancelPeaksJob('t129-cancel'), 'the job was running').toBe(true)
    const outcome = await job
    expect(isCancelledError(outcome), `the job answered ${String(outcome)}`).toBe(true)
    expect(Date.now() - at, 'answered at once, not when the decode would have finished').toBeLessThan(1500)
    if (process.platform !== 'win32') {
      const left = await new Promise<string>((resolve) => {
        const p = spawn('pgrep', ['-f', `pcm_s16le.*${path.basename(longWav)}|${path.basename(longWav)}.*s16le`])
        let out = ''
        p.stdout.on('data', (b) => (out += String(b)))
        p.on('close', () => resolve(out.trim()))
        p.on('error', () => resolve(''))
      })
      expect(left, 'no ffmpeg still decoding the file').toBe('')
    }
  }, 120_000)
})

describe('extracting the sound for a transcription can be stopped, and leaves no half-written WAV (real ffmpeg, T-108)', () => {
  // The first and often the longest child of a transcription is this extraction (the
  // speech engine only starts after it). T-108 hands the runner the child so a Cancel
  // can kill it; a killed extraction used to leave its WAV in %TEMP%/imagii-audio for
  // the next launch's prune. A fake child cannot leave a half-written WAV, so the kill
  // here is a real SIGKILL of a real ffmpeg that has opened its output.
  it('a killed extraction rejects and removes the file ffmpeg had opened', async () => {
    const long = path.join(workDir, 'extract-long.mp3')
    // An hour of 8 kHz mono: decoding and resampling it to 48 kHz stereo outlasts the test.
    await ff([
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=3600',
      '-ac', '1', '-b:a', '32k', long
    ])
    const dir = path.join(os.tmpdir(), 'imagii-audio')
    const before = new Set(existsSync(dir) ? await readdir(dir) : [])
    let child: import('node:child_process').ChildProcess | null = null
    const running = extractAudioFromVideo(long, (c) => {
      child = c
    }).then(
      () => ({ err: null as unknown }),
      (err: unknown) => ({ err })
    )

    // The file ffmpeg opened appears: the kill lands mid-write, a fact and not a hope.
    const fresh = async (): Promise<string[]> =>
      existsSync(dir) ? (await readdir(dir)).filter((f) => !before.has(f)) : []
    const deadline = Date.now() + 60_000
    while ((await fresh()).length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }
    const written = await fresh()
    expect(written, 'ffmpeg opened its output').toHaveLength(1)
    expect(child, 'the caller was handed the child').not.toBeNull()

    killAsCancelled(child as unknown as import('node:child_process').ChildProcess)
    const { err } = await running
    expect(err, 'a killed extraction rejects').toBeInstanceOf(Error)
    expect(await fresh(), 'the half-written WAV is gone').toEqual([])
  }, 180_000)

  it('T-111: cancelAllExtractions (the quit sweep) SIGKILLs a real extraction nobody holds a handle to, and its WAV goes', async () => {
    // Audio Studio's import (`audio:extractFromVideo`) never handed anyone its child, so
    // there was nothing for a quit to kill: a long VOD's ffmpeg kept writing after the
    // window had gone. The registry is the handle.
    const long = path.join(workDir, 'extract-long-sweep.mp3')
    await ff([
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=3600',
      '-ac', '1', '-b:a', '32k', long
    ])
    const dir = path.join(os.tmpdir(), 'imagii-audio')
    const before = new Set(existsSync(dir) ? await readdir(dir) : [])
    const running = extractAudioFromVideo(long).then(
      () => ({ err: null as unknown }),
      (err: unknown) => ({ err })
    )
    const fresh = async (): Promise<string[]> =>
      existsSync(dir) ? (await readdir(dir)).filter((f) => !before.has(f)) : []
    const deadline = Date.now() + 60_000
    while ((await fresh()).length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(await fresh(), 'ffmpeg opened its output').toHaveLength(1)

    cancelAllExtractions()
    const { err } = await running
    expect(isCancelledError(err), 'the kill is the cancel sentinel, not a failure').toBe(true)
    expect(await fresh(), 'the half-written WAV is gone').toEqual([])
  }, 180_000)

  it('T-111: the transcription format is 16 kHz mono, a sixth the size, and Audio Studio\'s stays 48 kHz stereo', async () => {
    // landscapeSrc carries 48 kHz stereo sound; the speech engine wants 16 kHz mono
    // (older whisper.exe builds refuse anything else), and a long VOD's scratch WAV is
    // ~690 MB an hour at the studio's format against ~115 MB at this one.
    const studio = await extractAudioFromVideo(landscapeSrc)
    const speech = await extractAudioFromVideo(landscapeSrc, undefined, TRANSCRIPTION_AUDIO)
    try {
      const studioInfo = await ffprobeJson(studio.wavPath)
      const speechInfo = await ffprobeJson(speech.wavPath)
      const a = studioInfo.streams.find((st) => st.codec_type === 'audio')
      const b = speechInfo.streams.find((st) => st.codec_type === 'audio')
      expect(b?.codec_name).toBe('pcm_s16le')
      expect(Number(b?.sample_rate)).toBe(16000)
      expect(b?.channels).toBe(1)
      expect(Number(a?.sample_rate)).toBe(48000)
      expect(a?.channels).toBe(2)
      // The same sound, the same length — only the format differs.
      expect(Math.abs(Number(speechInfo.format.duration) - Number(studioInfo.format.duration))).toBeLessThan(0.05)
      const studioBytes = (await readFile(studio.wavPath)).length
      const speechBytes = (await readFile(speech.wavPath)).length
      expect(studioBytes / speechBytes, 'a sixth of the bytes').toBeGreaterThan(5.5)
      expect(studioBytes / speechBytes).toBeLessThan(6.5)
    } finally {
      await studio.cleanup()
      await speech.cleanup()
    }
  }, 60_000)

  it('a finished extraction still hands back its WAV (and the child hook changes nothing)', async () => {
    const src = path.join(workDir, 'extract-short.wav')
    await ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', src])
    let seen = 0
    const { wavPath, cleanup } = await extractAudioFromVideo(src, () => {
      seen += 1
    })
    try {
      expect(seen).toBe(1)
      const probe = await probeAudio(wavPath)
      expect(probe.duration).toBeGreaterThan(0.8)
      expect(probe.sampleRate).toBe(48000)
    } finally {
      await cleanup()
    }
    expect(existsSync(wavPath)).toBe(false)
  }, 60_000)
})

// ---------------------------------------------------------------------------
// T-01 — vertical reframe + PiP composite
// ---------------------------------------------------------------------------

describe('vertical reframe (real ffmpeg)', () => {
  // reframe.ts had zero real-binary coverage: every crop coordinate is
  // computed by even()-snapping arithmetic that a string-shape unit test
  // cannot falsify, and the whole graph is one filter string libx264 either
  // accepts or rejects. These drive runReframe exactly as ipc/video.ts does.

  it('crops a landscape source to a 1080x1920 vertical clip', async () => {
    const outputPath = path.join(workDir, 'reframe-center.mp4')
    const res = await runReframe(
      {
        jobId: 'reframe-center',
        sourcePath: landscapeSrc,
        outputPath,
        position: 'center',
        startSec: 1,
        endSec: 3,
        outputWidth: 1080,
        outputHeight: 1920
      },
      () => {}
    )
    expect(res.outputPath).toBe(outputPath)
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    expect(v?.codec_name).toBe('h264')
    expect(v?.pix_fmt).toBe('yuv420p')
    expect(v?.width).toBe(1080)
    expect(v?.height).toBe(1920)
    expect(v?.avg_frame_rate).toBe('30/1')
    // T-12: square pixels. `scale` alone preserves the SOURCE display
    // aspect, so the crop-then-scale graph used to emit SAR 404:405 —
    // a 1080x1920 file that every player stretches to DAR 101:180
    // instead of 9:16. Only a real probe of a real encode can see it.
    expect(v?.sample_aspect_ratio).toBe('1:1')
    expect(v?.display_aspect_ratio).toBe('9:16')
    expect(a?.codec_name).toBe('aac')
    const dur = Number(info.format.duration)
    expect(dur).toBeGreaterThan(1.7)
    expect(dur).toBeLessThan(2.3)
    await assertFaststart(outputPath)
  })

  it('snaps an odd requested output size down to even (1081x1921 -> 1080x1920)', async () => {
    // Round 18 forced the scale target even. The UI only ever sends
    // 1080x1920 today, so a regression here is invisible until some future
    // caller passes an odd size and libx264 refuses the whole encode.
    const outputPath = path.join(workDir, 'reframe-odd.mp4')
    await runReframe(
      {
        jobId: 'reframe-odd',
        sourcePath: landscapeSrc,
        outputPath,
        position: 'center',
        startSec: 1,
        endSec: 2,
        outputWidth: 1081,
        outputHeight: 1921
      },
      () => {}
    )
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1080)
    expect(v?.height).toBe(1920)
    // T-12: the even-snap path carries square pixels too — snapping 1081
    // down to 1080 changes the scale target, which is exactly where a
    // source-derived SAR would leak back in.
    expect(v?.sample_aspect_ratio).toBe('1:1')
  })

  it('left and right positions keep different parts of the frame', async () => {
    // Dimensions alone cannot tell a working computeCropOffset from one that
    // always returns 0 — both produce a 1080x1920 file. Compare the pixels:
    // on a 1920-wide source the two crops are ~920 px apart, so the same
    // output coordinate must land on visibly different source content.
    const leftPath = path.join(workDir, 'reframe-left.mp4')
    const rightPath = path.join(workDir, 'reframe-right.mp4')
    for (const [position, outputPath] of [
      ['left', leftPath],
      ['right', rightPath]
    ] as const) {
      await runReframe(
        {
          jobId: `reframe-${position}`,
          sourcePath: landscapeSrc,
          outputPath,
          position,
          startSec: 1,
          endSec: 1.6,
          outputWidth: 1080,
          outputHeight: 1920
        },
        () => {}
      )
    }
    const left = await meanRgb(leftPath, 0.2, 540, 960)
    const right = await meanRgb(rightPath, 0.2, 540, 960)
    expect(
      rgbDelta(left, right),
      `left ${left.join(',')} vs right ${right.join(',')} must differ`
    ).toBeGreaterThan(40)
  })

  it('rejects a missing source with the probe stage error, before spawning an encode', async () => {
    await expect(
      runReframe(
        {
          jobId: 'reframe-ghost',
          sourcePath: path.join(workDir, 'does-not-exist.mp4'),
          outputPath: path.join(workDir, 'reframe-ghost.mp4'),
          position: 'center',
          startSec: 0,
          endSec: 1,
          outputWidth: 1080,
          outputHeight: 1920
        },
        () => {}
      )
    ).rejects.toThrow(/^ffprobe exit 1: .*No such file or directory/s)
    expect(existsSync(path.join(workDir, 'reframe-ghost.mp4'))).toBe(false)
  })
})

/**
 * T-124 (16) - Reframe makes the clip the user built: the selected clip's crop and speed.
 *
 * `video:reframe` took the source, the range, a side and a size, so a clip cropped to the part of the screen that matters (or sped
 * up) was reframed from the whole frame at normal speed: the wrong-file class T-96 closed for Compile and the GIF and T-105 for the
 * rest of a clip's recipe, never for Reframe, whose output is the first step of the captioned-vertical route in USER_GUIDE.
 *
 * The fixture is T-96's: a black 1920x1080 frame with a RED block that the crop excludes (x 100-300, y 100-300) and a white SQUARE
 * at the centre of the crop. A 9:16 crop is already the output's shape, so every side takes the same strip of it, and "honored"
 * is measured on the decoded output, never on a filter string: no red at all (while the same call without the crop, on the left
 * side, has the red block in it: the control), the marker is still SQUARE, at the hand-derived size (the crop's 540 px of width
 * onto 1080 is 2x, so a 160 px marker is 320) and centered. A crop that was ignored shows the strip of the WHOLE frame instead
 * (608 px wide: the marker would be 284 px and the left side would carry the red). The speed is read the way T-105 reads it for
 * Compile: each stream's own length, the ramp's picture clock (luma = 12 x its source second) and where the 1.5 s burst lands.
 * Through the alias recipe in TESTING.md it also runs on the distro's ffmpeg 6.1.1.
 */
describe('a reframed clip keeps its crop and its speed (real ffmpeg, T-124 (16))', () => {
  const MARKER = 160
  let src = '' // 1920x1080, 4 s: red block top-left, white MARKER square at the centre, a 440 Hz tone

  const cropOf = (x: number, y: number, w: number, h: number, srcW = 1920, srcH = 1080) => ({
    x: (x + 0.25) / srcW,
    y: (y + 0.25) / srcH,
    w: (w + 0.25) / srcW,
    h: (h + 0.25) / srcH
  })
  const NINE_SIXTEEN = cropOf(690, 60, 540, 960)

  const lengths = async (file: string): Promise<{ total: number; video: number; audio: number }> => {
    const info = await ffprobeJson(file)
    const v = info.streams.find((x) => x.codec_type === 'video')
    const a = info.streams.find((x) => x.codec_type === 'audio')
    return { total: Number(info.format.duration), video: Number(v?.duration), audio: Number(a?.duration) }
  }
  const near = (actual: number, expected: number, tolerance: number, what: string): void => {
    expect(Math.abs(actual - expected), `${what}: ${actual} s, expected ${expected} s`).toBeLessThanOrEqual(tolerance)
  }

  beforeAll(async () => {
    src = path.join(workDir, 't124-reframe-marker.mp4')
    await ff([
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=black:s=1920x1080:r=30:d=4,drawbox=x=100:y=100:w=200:h=200:color=red:t=fill,drawbox=x=880:y=460:w=${MARKER}:h=${MARKER}:color=white:t=fill`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src
    ])
  }, 60_000)

  const reframe = (
    jobId: string,
    sourcePath: string,
    extra: Partial<Parameters<typeof runReframe>[0]> & { startSec: number; endSec: number }
  ): Promise<string> =>
    runReframe(
      { jobId, sourcePath, outputPath: path.join(workDir, `${jobId}.mp4`), position: 'center', outputWidth: 1080, outputHeight: 1920, ...extra },
      () => {}
    ).then((r) => r.outputPath)

  it('a cropped clip is reframed from its crop: no red, a square marker at twice the crop, centered; the same call without the crop keeps the red', async () => {
    const cropped = await reframe('t124-reframe-crop', src, { startSec: 0, endSec: 3, position: 'left', cropRect: NINE_SIXTEEN })
    const info = await ffprobeJson(cropped)
    const v = info.streams.find((x) => x.codec_type === 'video')
    expect([v?.width, v?.height]).toEqual([1080, 1920])
    expect(v?.sample_aspect_ratio).toBe('1:1')
    const red = await countTintedPixels(cropped, 0.5, 'null', 0)
    expect(red, `the crop excludes the red block, but ${red} red pixels came out`).toBe(0)
    const box = await brightBox(cropped, 0.5, 1080, 1920)
    const message = `marker came out ${box.w}x${box.h} (expected a ${MARKER * 2} px square: the crop's 540 px onto 1080)`
    expect(box.w / box.h, message).toBeGreaterThan(0.97)
    expect(box.w / box.h, message).toBeLessThan(1.03)
    expect(box.w, message).toBeGreaterThan(MARKER * 2 * 0.97)
    expect(box.w, message).toBeLessThan(MARKER * 2 * 1.03)
    expect(Math.abs(box.cx - 540), 'marker horizontal offset from centre').toBeLessThan(8)
    expect(Math.abs(box.cy - 960), 'marker vertical offset from centre').toBeLessThan(8)

    // The control: the clip with no crop, left side. The strip of the whole frame starts at x = 196 and the red block is in it.
    const whole = await reframe('t124-reframe-nocrop', src, { startSec: 0, endSec: 3, position: 'left' })
    const wholeRed = await countTintedPixels(whole, 0.5, 'null', 0)
    expect(wholeRed, 'the uncropped clip still has its red block').toBeGreaterThan(5000)
  }, 120_000)

  it('a 2x clip is half as long in both streams, plays its picture and its sound at that speed, and 1x is unchanged', async () => {
    const fast = await reframe('t124-reframe-2x', rampSrc, { startSec: 8, endSec: 14, speedMultiplier: 2 })
    const len = await lengths(fast)
    near(len.total, 3, 0.3, '2x: the file')
    near(len.video, 3, 0.3, '2x: the picture')
    near(len.audio, 3, 0.3, '2x: the sound')
    // ramp.mp4's burst (source 10.0-11.5 s) measures about -21 dB and its bed 34 dB under that. At 2x over source 8-14 s it is at
    // output 1.0-1.75 s: atempo keeps the pitch, so the burst's position IS the tempo.
    const burst = await bandMeanVolume(fast, 1.1, 0.55, 440)
    expect(burst, `the burst is at 1.1-1.65 s of the output (${burst} dB)`).toBeGreaterThan(-30)
    for (const [from, to] of [[0.1, 0.8], [2.0, 2.9]] as const) {
      const bed = await bandMeanVolume(fast, from, to - from, 440)
      expect(bed, `only the quiet bed at ${from}-${to} s (${bed} dB)`).toBeLessThan(-40)
    }
    // The picture clock: output 0.5 s is source 9 s (luma 108), output 2.8 s is source 13.6 s (luma 163).
    for (const [t, expected] of [[0.5, 108], [2.8, 163]] as const) {
      const got = await meanLuma(fast, t)
      expect(Math.abs(got - expected), `the picture at ${t} s is source frame ${expected / 12} s (luma ${got}, expected ${expected})`).toBeLessThan(14)
    }
    // The control: the same range at 1x is 6 s long.
    const normal = await reframe('t124-reframe-1x', rampSrc, { startSec: 8, endSec: 14 })
    near((await lengths(normal)).total, 6, 0.3, '1x: the file')
  }, 180_000)

  it('a cropped clip at 2x is both: the crop\'s geometry and half the length, in one file', async () => {
    const out = await reframe('t124-reframe-crop-2x', src, { startSec: 0.5, endSec: 3.5, speedMultiplier: 2, cropRect: NINE_SIXTEEN })
    const len = await lengths(out)
    near(len.total, 1.5, 0.3, 'crop + 2x: the file')
    near(len.video, 1.5, 0.3, 'crop + 2x: the picture')
    near(len.audio, 1.5, 0.3, 'crop + 2x: the sound')
    expect(await countTintedPixels(out, 0.4, 'null', 0), 'the crop is honored at 2x').toBe(0)
    const box = await brightBox(out, 0.4, 1080, 1920)
    expect(box.w / box.h).toBeGreaterThan(0.97)
    expect(box.w / box.h).toBeLessThan(1.03)
    expect(box.w).toBeGreaterThan(MARKER * 2 * 0.97)
    expect(box.w).toBeLessThan(MARKER * 2 * 1.03)
  }, 120_000)

  it('a clip with no sound still reframes at its speed (the sound filter is only added where there is sound)', async () => {
    const out = await reframe('t124-reframe-silent-2x', noAudioSrc, { startSec: 0, endSec: 3, speedMultiplier: 2 })
    const info = await ffprobeJson(out)
    expect(info.streams.filter((x) => x.codec_type === 'audio')).toHaveLength(0)
    near(Number(info.format.duration), 1.5, 0.3, 'a silent 3 s clip at 2x')
  }, 120_000)
})

describe('a reframed clip is the clip the user built: grade, text, zoom and shake (real ffmpeg, T-125 (9))', () => {
  // T-124 (16) gave Reframe the clip's crop and speed on the premise that "grade stays out, matching Compile". That premise was false:
  // Compile passes all four of the rest through `buildVideoFilter` (T-105), and the lesson of T-105 is the shared builder with a
  // different frame, never another subset. A clip's hook text, its color grade, Auto Zoom and Hype Shake were dropped from the
  // vertical file the guide's captioned-vertical route starts with. The strip is `buildVideoFilter` at the 9:16 frame, with the
  // position-aware strip in place of the centered aspect stage.
  //
  // 1920x1080, 4 s: the left half dark gray, the right half blue. The centered 9:16 strip (606 px of the 1080 rows' width) takes the
  // gray from 657 to 960 and the blue from 960 to 1263, scaled 1080 / 606: gray fills the output's left 540 columns, blue the right.
  let src = ''
  const GRAY: [number, number] = [200, 960]
  const BLUE: [number, number] = [900, 960]
  const spread = (c: readonly [number, number, number]): number => Math.max(...c) - Math.min(...c)

  const grade = (patch: Partial<{ brightness: number; saturation: number; temperature: number }>) => ({
    brightness: 0,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    ...patch
  })
  const reframe = (
    jobId: string,
    extra: Partial<Parameters<typeof runReframe>[0]> = {}
  ): Promise<string> =>
    runReframe(
      { jobId, sourcePath: src, outputPath: path.join(workDir, `${jobId}.mp4`), position: 'center', startSec: 1, endSec: 4, outputWidth: 1080, outputHeight: 1920, ...extra },
      () => {}
    ).then((r) => r.outputPath)

  beforeAll(async () => {
    src = path.join(workDir, 't125-reframe-look.mp4')
    await ff([
      '-y',
      // A thin white bar in the gray half, 43 px inside the strip: something with an edge for Auto Zoom and Hype Shake to move.
      '-f', 'lavfi', '-i', 'color=c=0x303030:s=1920x1080:r=30:d=4,drawbox=x=960:y=0:w=960:h=1080:color=0x4070c0:t=fill,drawbox=x=700:y=300:w=20:h=400:color=white:t=fill',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src
    ])
  }, 60_000)

  it('a graded clip is graded: brightness lifts both halves, no saturation turns the blue gray, and the ungraded clip is the source', async () => {
    const control = await reframe('t125-reframe-grade-control')
    const bright = await reframe('t125-reframe-grade-bright', { colorGrade: grade({ brightness: 0.3 }) })
    const flat = await reframe('t125-reframe-grade-flat', { colorGrade: grade({ saturation: 0 }) })
    const rgb = (f: string, at: readonly [number, number]) => meanRgb(f, 1, at[0], at[1])

    const grayControl = await rgb(control, GRAY)
    const blueControl = await rgb(control, BLUE)
    expect(grayControl[0], `the control's gray half ${grayControl}`).toBeGreaterThan(38)
    expect(grayControl[0], `the control's gray half ${grayControl}`).toBeLessThan(56)
    expect(spread(blueControl), `the control's blue half is saturated (${blueControl})`).toBeGreaterThan(100)

    const grayBright = await rgb(bright, GRAY)
    const blueBright = await rgb(bright, BLUE)
    for (let c = 0; c < 3; c++) {
      expect(grayBright[c] ?? 0, `brightened gray ${grayBright} vs ${grayControl}`).toBeGreaterThan((grayControl[c] ?? 0) + 40)
      expect(blueBright[c] ?? 0, `brightened blue ${blueBright} vs ${blueControl}`).toBeGreaterThan((blueControl[c] ?? 0) + 40)
    }
    const blueFlat = await rgb(flat, BLUE)
    expect(spread(blueFlat), `desaturated blue ${blueFlat} (control spread ${spread(blueControl)})`).toBeLessThan(15)
  }, 180_000)

  describe('a text overlay (the drawbox stand-in paints it on every build; drawtext itself is win32-only, see the T-51 block)', () => {
    const overlay: TextOverlay = {
      id: 'ov-hook',
      text: 'HOOK',
      font: 'Arial',
      sizePx: 48,
      colorHex: '#ff3b30',
      x: 0.1,
      y: 0.1,
      // SOURCE-absolute seconds: 1.5-2.5 s of the source is 0.5-1.5 s into a clip that starts at 1 s.
      startSec: 1.5,
      endSec: 2.5
    }
    // The stand-in box is 200 x 120 at (x, y) of the 1080x1920 frame: x = 108, y = 192, in the gray half.
    const BOX = 'crop=200:120:108:192'

    it('shows in its window on the clip\'s own clock, and not before or after it', async () => {
      const out = await reframeWithDrawboxStandIn({
        jobId: 't125-reframe-text', sourcePath: src, outputPath: path.join(workDir, 't125-reframe-text.mp4'),
        position: 'center', startSec: 1, endSec: 4, outputWidth: 1080, outputHeight: 1920, textOverlays: [overlay]
      })
      const on = await countTintedPixels(out, 1.0, BOX, 0)
      expect(on, `the hook text is on 1.0 s into the clip (${on} red px)`).toBeGreaterThan(5000)
      for (const t of [0.2, 2.0]) {
        const off = await countTintedPixels(out, t, BOX, 0)
        expect(off, `and not at ${t} s (${off} red px)`).toBe(0)
      }
    }, 180_000)

    it('at 2x the window is on the clip\'s clock at its speed: 0.25-0.75 s of the output', async () => {
      const out = await reframeWithDrawboxStandIn({
        jobId: 't125-reframe-text-2x', sourcePath: src, outputPath: path.join(workDir, 't125-reframe-text-2x.mp4'),
        position: 'center', startSec: 1, endSec: 4, outputWidth: 1080, outputHeight: 1920, speedMultiplier: 2, textOverlays: [overlay]
      })
      const on = await countTintedPixels(out, 0.5, BOX, 0)
      expect(on, `on at 0.5 s of the 2x output (${on} red px)`).toBeGreaterThan(5000)
      const off = await countTintedPixels(out, 1.0, BOX, 0)
      expect(off, `and gone by 1.0 s, not running to 2.0 (${off} red px)`).toBe(0)
    }, 180_000)

    it('a clip with no text carries none: the same call without the overlay paints nothing there', async () => {
      const out = await reframeWithDrawboxStandIn({
        jobId: 't125-reframe-notext', sourcePath: src, outputPath: path.join(workDir, 't125-reframe-notext.mp4'),
        position: 'center', startSec: 1, endSec: 4, outputWidth: 1080, outputHeight: 1920
      })
      expect(await countTintedPixels(out, 1.0, BOX, 0)).toBe(0)
    }, 180_000)
  })

  it('Auto Zoom pulses the picture about its centre and Hype Shake jitters it; the whole recipe at once is one valid vertical file (1080x1920, square pixels, the clip\'s length)', async () => {
    const plain = await reframe('t125-reframe-fx-plain')
    const zoomed = await reframe('t125-reframe-fx-zoom', { autoZoom: true })
    const shaken = await reframe('t125-reframe-fx-shake', { hypeShake: true })
    const all = await reframe('t125-reframe-fx-all', {
      autoZoom: true, hypeShake: true, speedMultiplier: 1.5, colorGrade: grade({ brightness: 0.1, temperature: 0.5 }),
      cropRect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }
    })
    // The bar's centre column. Plain, it is at about 94 (43 px into the strip, scaled by 1080 / 606). Auto Zoom is z = 1 + 0.05 |sin(0.6 t)|
    // about the middle of the frame (column 540): no zoom at t = 0, 5% at t = 2.6 s, which pulls a bar 446 px left of the middle 22 px closer.
    const barAt = async (f: string, t: number): Promise<number> => (await brightBox(f, t, 1080, 1920)).cx
    const plainStart = await barAt(plain, 0.05)
    const plainPeak = await barAt(plain, 2.6)
    expect(Math.abs(plainPeak - plainStart), `the plain clip's bar does not move (${plainStart} -> ${plainPeak})`).toBeLessThan(2)
    expect(plainStart, 'the bar is where the strip puts it').toBeGreaterThan(85)
    expect(plainStart).toBeLessThan(105)
    const zoomStart = await barAt(zoomed, 0.05)
    const zoomPeak = await barAt(zoomed, 2.6)
    expect(Math.abs(zoomStart - plainStart), `Auto Zoom has not started at t=0 (${zoomStart} vs ${plainStart})`).toBeLessThan(3)
    expect(plainPeak - zoomPeak, `Auto Zoom pulled the bar toward the middle by 5% of its distance (${plainPeak} -> ${zoomPeak})`).toBeGreaterThan(15)
    // Hype Shake crops 6 px and moves the window by 3 + 3 sin(2 pi t 8) px: at the second frame (1/30 s) the sine is at its crest, the
    // window is 3 px further right than centered and the bar sits about 10 px further left than in the plain clip.
    const shakeNow = await barAt(shaken, 0.03)
    const plainNow = await barAt(plain, 0.03)
    expect(plainNow - shakeNow, `Hype Shake moved the bar (${plainNow} -> ${shakeNow})`).toBeGreaterThan(5)

    const info = await ffprobeJson(all)
    const v = info.streams.find((x) => x.codec_type === 'video')
    expect([v?.width, v?.height]).toEqual([1080, 1920])
    expect(v?.sample_aspect_ratio).toBe('1:1')
    expect(v?.pix_fmt).toBe('yuv420p')
    near(Number(info.format.duration), 2, 0.3, 'a 3 s range at 1.5x')
    const sizes = await decodeSizes(all)
    expect(sizes.videoKiB).toBeGreaterThan(0)
    expect(sizes.audioKiB).toBeGreaterThan(0)
  }, 240_000)
})

describe('PiP composite (real ffmpeg)', () => {
  // PiP is the feature whose IPC validator rejected every call until round
  // 18 (overlayWidth was range-checked as a fraction while concat.ts scales
  // it as pixels), so the composite itself had never been proven to run.
  // The overlay fixture is flat green: "did the overlay land at the right
  // place and size" becomes a pixel readback, and the base source doubles
  // as the no-overlay control at identical coordinates.
  const OVERLAY_TIME = 1

  it('composites a 480px overlay into the top-left corner', async () => {
    const outputPath = path.join(workDir, 'pip-topleft.mp4')
    const res = await runPipComposite(
      'pip-topleft',
      landscapeSrc,
      pipOverlaySrc,
      outputPath,
      { overlayWidth: 480, position: 'top-left', margin: 20 }
    )
    expect(res.outputPath).toBe(outputPath)

    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1920)
    expect(v?.height).toBe(1080)
    expect(v?.pix_fmt).toBe('yuv420p')
    // -map 0:a? must carry the base track through; the overlay has none.
    expect(info.streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1)
    const sizes = await decodeSizes(outputPath)
    expect(sizes.videoKiB).toBeGreaterThan(0)
    expect(sizes.audioKiB).toBeGreaterThan(0)
    await assertFaststart(outputPath)

    // scale=480:-1 on a 640x360 overlay is 480x270, placed at (20, 20):
    // it covers x 20..500, y 20..290.
    const inside = await meanRgb(outputPath, OVERLAY_TIME, 250, 150)
    expect(
      rgbDelta(inside, PIP_OVERLAY_RGB),
      `overlay centre ${inside.join(',')} must be the overlay colour`
    ).toBeLessThan(25)

    // Same coordinate in the base source is not the overlay colour, so the
    // reading above cannot be the base leaking through.
    const baseUnder = await meanRgb(landscapeSrc, OVERLAY_TIME, 250, 150)
    expect(
      rgbDelta(baseUnder, PIP_OVERLAY_RGB),
      `base ${baseUnder.join(',')} must differ from the overlay colour`
    ).toBeGreaterThan(80)

    // The requested 480px width is real: x=420 is inside a 480-wide overlay
    // and outside a 240-wide one.
    const nearRightEdge = await meanRgb(outputPath, OVERLAY_TIME, 420, 150)
    expect(rgbDelta(nearRightEdge, PIP_OVERLAY_RGB)).toBeLessThan(25)

    // Far from the overlay the base must survive untouched.
    const untouched = await meanRgb(outputPath, OVERLAY_TIME, 960, 700)
    const baseThere = await meanRgb(landscapeSrc, OVERLAY_TIME, 960, 700)
    expect(
      rgbDelta(untouched, baseThere),
      `outside the overlay box the base must pass through unchanged`
    ).toBeLessThan(30)
  })

  it('composites a 240px overlay into the bottom-right corner', async () => {
    const outputPath = path.join(workDir, 'pip-bottomright.mp4')
    await runPipComposite('pip-bottomright', landscapeSrc, pipOverlaySrc, outputPath, {
      overlayWidth: 240,
      position: 'bottom-right',
      margin: 40
    })
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1920)
    expect(v?.height).toBe(1080)

    // scale=240:-1 is 240x135; main_w-overlay_w-40 = 1640, main_h-overlay_h-40
    // = 905, so the box is x 1640..1880, y 905..1040.
    const inside = await meanRgb(outputPath, OVERLAY_TIME, 1760, 970)
    expect(
      rgbDelta(inside, PIP_OVERLAY_RGB),
      `overlay centre ${inside.join(',')} must be the overlay colour`
    ).toBeLessThan(25)

    // Just left of the box the base shows through — proves the smaller
    // overlayWidth was honoured rather than reused from the 480px case.
    const outsideLeft = await meanRgb(outputPath, OVERLAY_TIME, 1560, 970)
    expect(
      rgbDelta(outsideLeft, PIP_OVERLAY_RGB),
      `x=1560 is outside a 240-wide overlay and must not be green`
    ).toBeGreaterThan(80)

    // Top-left corner is where the previous case put its overlay; here it
    // must still be untouched base.
    const topLeft = await meanRgb(outputPath, OVERLAY_TIME, 250, 150)
    const baseTopLeft = await meanRgb(landscapeSrc, OVERLAY_TIME, 250, 150)
    expect(rgbDelta(topLeft, baseTopLeft)).toBeLessThan(30)
  })

  it('rejects a missing overlay file with the pip runner error', async () => {
    const outputPath = path.join(workDir, 'pip-missing.mp4')
    await expect(
      runPipComposite('pip-missing', landscapeSrc, path.join(workDir, 'no-overlay.mp4'), outputPath, {
        overlayWidth: 240,
        position: 'top-left',
        margin: 10
      })
    ).rejects.toThrow(/^pip exit \d+: .*No such file or directory/s)
    expect(existsSync(outputPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// T-02 — multi-clip concat
// ---------------------------------------------------------------------------

describe('multi-clip concat (real ffmpeg)', () => {
  // runConcat is a two-stage job: re-encode each segment to a normalized
  // shape, then stream-copy them together through the concat demuxer. The
  // classic failure is silent — mismatched timebase/SAR between segments
  // makes the demuxer drop or desync one of them while still exiting 0, so
  // duration alone is not enough. The ramp fixture lets us read back which
  // second of the source each part of the output actually came from.
  //
  // Note on shape: runConcat takes ONE sourcePath plus N ranges, so "two
  // clips with different properties" means two ranges of a source whose
  // resolution (640x480), frame rate (24) and audio layout (mono 44.1k) all
  // differ from the 1280x720 target it normalizes to (the rate it keeps: T-130 (q)).

  it('joins two ranges of a mismatched-property source into one compilation', async () => {
    const { outputPath } = await runConcat({
      jobId: 'concat-ramp',
      sourcePath: rampSrc,
      outDir: workDir,
      segments: [
        { startSec: 2, endSec: 4, name: 'first' },
        { startSec: 12, endSec: 14, name: 'second' }
      ],
      fadeMs: 0,
      width: 1280,
      height: 720
    })
    expect(existsSync(outputPath)).toBe(true)

    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    expect(v?.codec_name).toBe('h264')
    expect(v?.width).toBe(1280)
    expect(v?.height).toBe(720)
    // T-130 (q): the source is 24 fps, and a compilation follows its source's rate (it was 30 for everything). The container's own rate is
    // exact; the average over a join is not (its stamps are whole milliseconds: 24 fps reads 32000/1333), so that one gets a quarter of a percent.
    expect(v?.r_frame_rate).toBe('24/1')
    const [avgN, avgD] = (v?.avg_frame_rate ?? '0/1').split('/').map(Number)
    expect(Math.abs((avgN ?? 0) / (avgD || 1) - 24) / 24, `average ${v?.avg_frame_rate}`).toBeLessThan(0.0025)
    expect(a?.codec_name).toBe('aac')

    // Duration is the sum of the two ranges (2s + 2s), within half a second.
    const dur = Number(info.format.duration)
    expect(dur).toBeGreaterThan(3.5)
    expect(dur).toBeLessThan(4.5)

    // Both streams decode end-to-end, not merely appear in ffprobe.
    const sizes = await decodeSizes(outputPath)
    expect(sizes.videoKiB).toBeGreaterThan(0)
    expect(sizes.audioKiB).toBeGreaterThan(0)

    // Content order: output t=0.5 is 0.5s into the first range (source
    // t=2.5, luma 30); output t=2.5 is 0.5s into the second (source t=12.5,
    // luma 150). A dropped or reordered segment fails here while duration
    // and stream counts stay perfectly plausible.
    const firstPart = await meanLuma(outputPath, 0.5)
    const secondPart = await meanLuma(outputPath, 2.5)
    expect(Math.abs(firstPart - 30), `first segment luma ${firstPart}`).toBeLessThan(12)
    expect(Math.abs(secondPart - 150), `second segment luma ${secondPart}`).toBeLessThan(12)
    expect(secondPart - firstPart).toBeGreaterThan(100)

    await assertFaststart(outputPath)
  })

  it('joins portrait ranges with cross-fades applied to both video and audio', async () => {
    // The fade/afade branch only fires with fadeMs > 0 and more than one
    // segment, and its `st=` value is computed from the segment duration —
    // exactly the sort of expression a unit test pins as a string and
    // ffmpeg rejects at runtime.
    const { outputPath } = await runConcat({
      jobId: 'concat-fade',
      sourcePath: portraitSrc,
      outDir: workDir,
      segments: [
        { startSec: 0, endSec: 1.5, name: 'a' },
        { startSec: 2, endSec: 3.5, name: 'b' }
      ],
      fadeMs: 250,
      width: 720,
      height: 1280
    })
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(720)
    expect(v?.height).toBe(1280)
    const dur = Number(info.format.duration)
    expect(dur).toBeGreaterThan(2.5)
    expect(dur).toBeLessThan(3.5)
    const sizes = await decodeSizes(outputPath)
    expect(sizes.videoKiB).toBeGreaterThan(0)
    expect(sizes.audioKiB).toBeGreaterThan(0)
  })

  it('PINNED: a source with no audio stream yields a video-only compilation, not an error', async () => {
    // concat.ts has no audio guard: it always passes -c:a aac (and -af
    // afade when fading), and ffmpeg's stream selection simply finds no
    // audio to map. The defined outcome is success with a single video
    // stream — pinned here so a future change to defaults (an explicit
    // -map, an anullsrc pad, or a hard rejection) has to be deliberate.
    const { outputPath } = await runConcat({
      jobId: 'concat-noaudio',
      sourcePath: noAudioSrc,
      outDir: workDir,
      segments: [
        { startSec: 0, endSec: 1, name: 'a' },
        { startSec: 2, endSec: 3.5, name: 'b' }
      ],
      fadeMs: 300,
      width: 1280,
      height: 720
    })
    const info = await ffprobeJson(outputPath)
    expect(info.streams).toHaveLength(1)
    expect(info.streams.filter((s) => s.codec_type === 'audio')).toHaveLength(0)
    const v = info.streams.find((s) => s.codec_type === 'video')
    expect(v?.width).toBe(1280)
    expect(v?.height).toBe(720)
    const dur = Number(info.format.duration)
    expect(dur).toBeGreaterThan(2)
    expect(dur).toBeLessThan(3)
    const sizes = await decodeSizes(outputPath)
    expect(sizes.videoKiB).toBeGreaterThan(0)
    expect(sizes.audioKiB).toBe(0)
  })

  it('rejects a reversed segment range with its own named guard', async () => {
    // Defense in depth: the IPC validator checks this too, but runConcat
    // repeats the check so non-IPC callers cannot produce a -ss > -to
    // invocation. The message names the offending index.
    await expect(
      runConcat({
        jobId: 'concat-reversed',
        sourcePath: rampSrc,
        outDir: workDir,
        segments: [
          { startSec: 0, endSec: 1, name: 'ok' },
          { startSec: 3, endSec: 2, name: 'reversed' }
        ],
        fadeMs: 0,
        width: 1280,
        height: 720
      })
    ).rejects.toThrow(/^segments\[1\] range invalid \(endSec must exceed startSec\)$/)
  })
})

describe('a compilation keeps the sound on its picture across many joins (real ffmpeg, T-125 (1))', () => {
  // Every AAC segment carries 1024 samples of encoder priming and about 8 ms of end padding, and an MP4 honors one edit
  // list, the first: a stream-copy join of eight AAC segments moved the sound later by about 29.3 ms PER JOIN (0 / 30 / 59 /
  // 88 / 118 / 147 / 176 / 206 ms at the eight segments, identical on both majors) while every duration check stayed green.
  // The segments are PCM in Matroska now and the sound is encoded to AAC once, at the join.
  let src = ''
  const SEGMENTS = 8

  beforeAll(async () => {
    src = path.join(workDir, 't125-drift-source.mp4')
    // One flash (the whole frame white) and one 1 kHz beep in the first 0.1 s of every second, so the picture's mark and the
    // sound's mark start on the same instant and any offset between them in an output is the output's own.
    await ff([
      '-y',
      '-f', 'lavfi', '-i', "color=c=black:s=640x360:r=30:d=33,drawbox=x=0:y=0:w=640:h=360:color=white:t=fill:enable='lt(mod(t,1),0.1)'",
      '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,1),0.1),0.8*sin(2*PI*1000*t),0)':s=48000:d=33",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-shortest', src
    ])
  }, 60_000)

  const join = (jobId: string): Promise<{ outputPath: string }> =>
    runConcat({
      jobId,
      sourcePath: src,
      outDir: workDir,
      // 3 s of each 4 s, starting half a second in: a start on the frame grid, three flashes and three beeps in each.
      segments: Array.from({ length: SEGMENTS }, (_, i) => ({ startSec: 0.5 + 4 * i, endSec: 3.5 + 4 * i, name: `s${i}` })),
      fadeMs: 0,
      width: 640,
      height: 360
    })

  it('the source is what it says: a flash and a beep on the same instant every second', async () => {
    const flashes = await flashStarts(src)
    const beeps = await soundBurstStarts(src, 0.3, 0.5)
    expect(flashes).toHaveLength(33)
    expect(beeps).toHaveLength(33)
    const worst = Math.max(...flashes.map((f, i) => Math.abs((beeps[i] ?? 0) - f) * 1000))
    expect(worst, `the source's own flash-to-beep offset is ${worst.toFixed(1)} ms`).toBeLessThan(5)
  }, 60_000)

  it(`${SEGMENTS} segments joined: the beep stays on the flash at every one (under 15 ms), and nothing is lost`, async () => {
    const { outputPath } = await join('t125-drift')
    const flashes = await flashStarts(outputPath)
    const beeps = await soundBurstStarts(outputPath, 0.3, 0.5)
    expect(flashes, 'three flashes in each of the segments').toHaveLength(SEGMENTS * 3)
    expect(beeps, 'three beeps in each of the segments').toHaveLength(SEGMENTS * 3)
    const offsets = flashes.map((f, i) => Math.round(((beeps[i] ?? 0) - f) * 1000))
    const perSegment = offsets.filter((_, i) => i % 3 === 0)
    expect(
      Math.max(...offsets.map(Math.abs)),
      `the sound drifted off its picture: beep minus flash at each segment is ${perSegment.join(' / ')} ms`
    ).toBeLessThan(15)

    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    expect(v?.codec_name).toBe('h264')
    expect(a?.codec_name, 'the sound is AAC in the finished file, whatever the segments were').toBe('aac')
    // Both streams are the length of the 24 s that was asked for.
    near(Number(v?.duration), SEGMENTS * 3, 0.1, 'the picture')
    near(Number(a?.duration), SEGMENTS * 3, 0.1, 'the sound')
    await assertFaststart(outputPath)
  }, 180_000)

  it('the scratch the compilation made is gone when it finishes, and when it is canceled', async () => {
    const scratch = path.join(os.tmpdir(), 'imagii-concat')
    const mine = async (id: string): Promise<string[]> =>
      existsSync(scratch) ? (await readdir(scratch)).filter((f) => f.includes(id)) : []
    // A name of its own for each run: scratch a broken earlier run left behind is not this run's.
    const stamp = Date.now().toString(36)
    const done = `t125-scratch-done-${stamp}`
    const canceled = `t125-scratch-cancel-${stamp}`
    await join(done)
    expect(await mine(done), 'segments and the list file after a finished join').toEqual([])
    const running = join(canceled).then(
      () => null,
      (err: unknown) => err
    )
    // A segment is being written by now (the first spawn follows the probe).
    await new Promise((r) => setTimeout(r, 1500))
    cancelConcatJob(canceled)
    const err = await running
    expect(isCancelledError(err), 'the join ended as a cancel').toBe(true)
    await new Promise((r) => setTimeout(r, 500))
    expect(await mine(canceled), 'segments and the list file after a canceled join').toEqual([])
  }, 120_000)
})

describe('fractional segments do not walk the picture off its sound across the joins (real ffmpeg, T-127 (4))', () => {
  // The T-125 (1) block above cuts whole seconds from a 30 fps source: every segment there is a whole number of frames, and that is the one
  // shape this drift cannot happen on. A segment whose length is NOT a whole number of frames (a cut at 1.37 s to 4.91 s from a 25 fps
  // recording, which is what almost every cut is) wrote one or two extra video frames (the fps stage, a fractional -ss, the end-of-file
  // fill). The join's concat demuxer offsets each next segment by the container's picture-led length, and the join's AAC encode swallows the
  // gap in the sound, so the picture fell further behind its sound at every join: cumulative, and invisible to a duration check. The
  // fix is `-shortest` on the segment command. Each flash of the output is paired with the beep that was made on the same instant, and the
  // SERIES of picture-minus-sound lags is read: the defect is a series that grows across the joins, the fix a series that stays flat.
  const FPS = 25
  const SECS = 40
  // Every boundary falls in the dark part of its second (the source flashes in the first 0.1 s), so no segment cuts a flash in half and
  // the number of flashes in a segment is exact: the integers in its range.
  // T-130 (q): a compilation is written at its source's rate now (25 fps here; it was converted to 30), and a picture can only show a flash on
  // a frame: 40 ms apart, where 33 ms were. A start that puts the first flash BETWEEN two frames (1.37 s: 25.25 frames before the flash at 2 s)
  // is read up to half a frame (20 ms) from the beep whatever the join does, and the series' 15 ms bound then measures the rounding, not the
  // drift. So every START is on the 25 fps grid (the whole frames to the next flash: 16, 19, 17, 13, 3, 15, 20, 18) and every END is not (the
  // segment lengths stay a fraction of a frame, which is the shape the defect needs).
  const SEGMENTS: Array<[number, number]> = [
    [1.36, 4.91], [7.24, 10.58], [12.32, 15.77], [17.48, 20.62], [22.88, 26.33], [27.4, 29.9], [31.2, 33.8], [35.28, 38.7]
  ]
  const flashesIn = ([a, b]: [number, number]): number => Math.floor(b) - Math.ceil(a) + 1
  let src = ''

  beforeAll(async () => {
    src = path.join(workDir, 't127-fractional-source.mp4')
    await ff([
      '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=640x360:r=${FPS}:d=${SECS},drawbox=x=0:y=0:w=640:h=360:color=white:t=fill:enable='lt(mod(t,1),0.1)'`,
      '-f', 'lavfi', '-i', `aevalsrc='if(lt(mod(t,1),0.1),0.8*sin(2*PI*1000*t),0)':s=48000:d=${SECS}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-shortest', src
    ])
  }, 60_000)

  /** The picture's start minus the sound's start at every flash of the compilation, in ms (positive: the picture is LATE). */
  async function lagSeries(segments: Array<[number, number]>, jobId: string): Promise<{ lags: number[]; firstOfSegment: number[] }> {
    const { outputPath } = await runConcat({
      jobId,
      sourcePath: src,
      outDir: workDir,
      segments: segments.map(([startSec, endSec], i) => ({ startSec, endSec, name: `s${i}` })),
      fadeMs: 0,
      width: 640,
      height: 360
    })
    const flashes = await flashStarts(outputPath)
    const beeps = await soundBurstStarts(outputPath, 0.3, 0.5)
    const expected = segments.reduce((n, seg) => n + flashesIn(seg), 0)
    expect(flashes, 'a flash for every whole second inside a segment').toHaveLength(expected)
    expect(beeps, 'and a beep for every one').toHaveLength(expected)
    const firstOfSegment: number[] = []
    let at = 0
    for (const seg of segments) {
      firstOfSegment.push(at)
      at += flashesIn(seg)
    }
    return { lags: flashes.map((f, i) => Math.round((f - (beeps[i] ?? 0)) * 1000)), firstOfSegment }
  }

  it('the source is what it says: 25 fps, a flash and a beep on the same instant every second', async () => {
    const info = await ffprobeJson(src)
    expect(info.streams.find((s) => s.codec_type === 'video')?.r_frame_rate).toBe('25/1')
    const flashes = await flashStarts(src)
    const beeps = await soundBurstStarts(src, 0.3, 0.5)
    expect(flashes).toHaveLength(SECS)
    expect(beeps).toHaveLength(SECS)
    expect(Math.max(...flashes.map((f, i) => Math.abs((beeps[i] ?? 0) - f) * 1000))).toBeLessThan(5)
  }, 60_000)

  it(`${SEGMENTS.length} fractional segments at 25 fps: the picture-minus-sound lag is the same at the last join as at the first (a flat series, within 15 ms)`, async () => {
    const { lags, firstOfSegment } = await lagSeries(SEGMENTS, 't127-fractional')
    const perSegment = firstOfSegment.map((i) => lags[i] as number)
    const spread = Math.max(...lags) - Math.min(...lags)
    expect(
      spread,
      `the picture walked off its sound: picture minus sound at the first flash of each segment is ${perSegment.join(' / ')} ms, every flash ${lags.join(' ')}`
    ).toBeLessThanOrEqual(15)
    // And no segment is off by an amount a viewer would notice, whatever the others do (the encoder's own delay puts a correct file's beep
    // a few ms after its flash).
    expect(Math.max(...lags.map(Math.abs)), `every flash ${lags.join(' ')}`).toBeLessThanOrEqual(30)
  }, 180_000)
})

describe('a compilation survives a source whose sound does not cover a segment (real ffmpeg, T-131 (1))', () => {
  // T-127 (4) put `-shortest` on the segment command so a segment ends where its SHORTER stream does. A source whose sound is shorter than
  // its picture (Record's own mic-drop takes, T-125 (25); a clip captured with the sound starting late) made that a hazard: a range that
  // lies past the sound's end, or straddles it, ended where the sound did. Entirely past: no packets at all, ffmpeg's "Output file is empty,
  // nothing was encoded" and exit 0, a ~970-byte Matroska stub. The join then opened that stub, logged "Impossible to open", stopped there
  // and exited 0 too: every segment from the stub on was missing and the panel said "Saved" (a [1,3] [7,9] [2,4] compilation of a 10 s
  // picture with 6 s of sound came out 2.0 s long, not 6.0; the straddling one 5.014 s of 7). The segment's last `-af` stage is now
  // `apad=whole_dur=<its length in the output>`: the sound is padded with silence up to the picture's length and `-shortest` then ends the
  // segment at the PICTURE (finite: a bare `apad` hangs with `-c:v copy` and brought the join drift back on 6.1.1). And a segment ffmpeg
  // wrote nothing for, or a join that cannot open one, is an error in a sentence, not a partial file.
  // Each source flashes the whole frame white and beeps at 1 kHz in the first 0.1 s of every second, so what is in an output is counted
  // and where the sound sits against the picture is read.
  const COVER = {
    short: [0, 6], // the sound ends at 6 s of a 12 s picture
    late: [3, 12], // the sound starts at 3 s
    mic: [0, 5] // a WebM whose microphone dropped at 5 s of a 12 s take
  } as const
  const files = { short: '', late: '', mic: '' }

  beforeAll(async () => {
    const picture = (secs: number): string[] => [
      '-f', 'lavfi', '-i', `color=c=black:s=640x360:r=30:d=${secs},drawbox=x=0:y=0:w=640:h=360:color=white:t=fill:enable='lt(mod(t,1),0.1)'`
    ]
    const sound = (secs: number): string[] => [
      '-f', 'lavfi', '-i', `aevalsrc='if(lt(mod(t,1),0.1),0.8*sin(2*PI*1000*t),0)':s=48000:d=${secs}`
    ]
    const h264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1']
    // No `-shortest` anywhere here: the file keeps the longer stream's length, the picture's 12 s.
    files.short = path.join(workDir, 't131-sound-ends-at-6.mp4')
    await ff(['-y', ...picture(12), ...sound(6), ...h264, files.short])
    files.late = path.join(workDir, 't131-sound-starts-at-3.mp4')
    await ff(['-y', ...picture(12), '-itsoffset', '3', ...sound(9), '-map', '0:v', '-map', '1:a', ...h264, files.late])
    files.mic = path.join(workDir, 't131-mic-drop.webm')
    await ff([
      '-y', ...picture(12), ...sound(5),
      '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-c:a', 'libopus', '-ac', '1', files.mic
    ])
  }, 120_000)

  /** The flashes a range holds: one per whole second inside it (the boundaries below all fall in the dark part of their second). */
  const flashesIn = ([a, b]: readonly [number, number]): number => Math.floor(b) - Math.ceil(a) + 1
  /** The beeps a range holds that the source's sound covers: a beep is whole from its second to 0.1 s after it. */
  const beepsIn = ([a, b]: readonly [number, number], [from, to]: readonly [number, number]): number => {
    let n = 0
    for (let s = Math.ceil(a); s <= Math.floor(b); s++) if (s >= from && s + 0.1 <= to) n++
    return n
  }

  /** Where the last packet of the file's sound ends, in seconds (ffprobe's stream `duration` of a sound that starts late differs by major). */
  async function soundEnd(file: string): Promise<number> {
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(ffprobePath, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', file])
      let text = ''
      child.stdout.on('data', (b) => (text += String(b)))
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(`ffprobe exit ${code} for ${file}`))))
    })
    return Math.max(...out.split('\n').filter((l) => l.trim() !== '').map((l) => { const [t, d] = l.split(','); return Number(t) + Number(d) }))
  }

  async function compile(
    source: keyof typeof files,
    segments: Array<[number, number]>,
    jobId: string,
    fadeMs = 0,
    /** Beep minus flash is held to 40 ms for the first N beeps only (default: every one). See the late-start case. */
    lagChecked = Infinity
  ): Promise<number[]> {
    const { outputPath } = await runConcat({
      jobId,
      sourcePath: files[source],
      outDir: workDir,
      segments: segments.map(([startSec, endSec], i) => ({ startSec, endSec, name: `s${i}` })),
      fadeMs,
      width: 640,
      height: 360
    })
    const want = segments.reduce((n, [a, b]) => n + (b - a), 0)
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    near(Number(v?.duration), want, 0.15, `${jobId}: the picture of ${segments.length} segment(s)`)
    near(await soundEnd(outputPath), want, 0.15, `${jobId}: the sound of ${segments.length} segment(s) ends with the picture, padded with silence where the source had none`)
    const flashes = await flashStarts(outputPath)
    const beeps = await soundBurstStarts(outputPath, 0.3, 0.5)
    expect(flashes, `${jobId}: a flash for every whole second inside a segment`).toHaveLength(segments.reduce((n, seg) => n + flashesIn(seg), 0))
    expect(beeps, `${jobId}: a beep for every one the source's sound covers, and none where it does not`).toHaveLength(
      segments.reduce((n, seg) => n + beepsIn(seg, COVER[source]), 0)
    )
    // Wherever there is a beep it is on its flash: silence in front of the sound (a late start) is silence, not a sound moved earlier.
    const lags = beeps.map((b) => Math.round(1000 * (b - flashes.reduce((best, f) => (Math.abs(f - b) < Math.abs(best - b) ? f : best), Infinity))))
    expect(Math.max(0, ...lags.slice(0, lagChecked).map(Math.abs)), `${jobId}: beep minus flash at each beep, in ms: ${lags.join(' ')}`).toBeLessThanOrEqual(40)
    return lags
  }

  it('the sources are what they say: the sound ends at 6 s, starts at 3 s, and a WebM microphone drops at 5 s of 12', async () => {
    for (const [key, ext] of [['short', 6], ['late', 12], ['mic', 5]] as const) {
      const info = await ffprobeJson(files[key])
      const a = info.streams.find((s) => s.codec_type === 'audio')
      const flashes = await flashStarts(files[key])
      expect(flashes, `${key}: the picture is all 12 s`).toHaveLength(12)
      const beeps = await soundBurstStarts(files[key], 0.3, 0.5)
      expect(beeps.at(-1) ?? -1, `${key}: the last beep`).toBeLessThan(ext)
      expect(beeps.length, `${key}: one beep for each second the sound covers`).toBe(beepsIn([-0.5, 11.9], COVER[key]))
      expect(a, `${key} has a sound stream`).toBeDefined()
    }
  }, 60_000)

  it('the sound ends in the middle of a segment: the segment is as long as its picture, silent after the sound', async () => {
    await compile('short', [[4.37, 8.91]], 't131-mid')
  }, 120_000)

  it('a segment entirely past the end of the sound is kept, in the middle of the list and alone (it used to end the compilation there)', async () => {
    await compile('short', [[1.37, 3.91], [7.37, 9.91], [2.37, 4.91]], 't131-past')
    await compile('short', [[7.37, 9.91]], 't131-past-alone')
  }, 180_000)

  it('the straddle in a list, with fades: the segments after it are still there', async () => {
    await compile('short', [[1.37, 3.91], [4.37, 8.91], [2.37, 4.91]], 't131-straddle', 500)
  }, 120_000)

  it('the sound starts late: a segment entirely before it is kept, and one that straddles its start has the sound where it was', async () => {
    await compile('late', [[0.37, 2.91], [4.37, 7.91]], 't131-late-before')
    // The first segment holds 1.6 s of picture before the sound begins. Its sound is placed right (checked: its three beeps are on their
    // flashes), but it is that much SHORTER than its picture (the pad is at the end, not the start), and the join then pulls the next
    // segment's sound earlier by the picture's 60 ms excess: measured -64 ms for the second segment's beeps on both majors. Held to
    // the ticket's mechanism (see the `simplification:` note in concat.ts), so the later beeps are not asserted: everything else is.
    const lags = await compile('late', [[1.37, 5.91], [6.37, 9.91]], 't131-late-straddle', 500, 3)
    expect(lags, 'six beeps: three in each segment').toHaveLength(6)
  }, 180_000)

  it('a Record take whose microphone dropped (WebM): every clip after the drop is kept', async () => {
    await compile('mic', [[1.37, 3.91], [7.37, 9.91], [10.37, 11.91]], 't131-mic')
  }, 120_000)

  it('a segment of a range the PICTURE does not reach is an error in a sentence, not a shorter file that says Saved', async () => {
    const outDir = await mkdtemp(path.join(workDir, 't131-empty-'))
    const err = await runConcat({
      jobId: 't131-empty',
      sourcePath: files.short,
      outDir,
      segments: [{ startSec: 1.37, endSec: 3.91, name: 'a' }, { startSec: 13.37, endSec: 15.91, name: 'b' }],
      fadeMs: 0,
      width: 640,
      height: 360
    }).then(() => null, (e: Error) => e)
    // T-132 (12): by the name the person gave it ('b' on the wire), not its position in the list.
    expect(err?.message, 'it names the clip').toBe('The clip "b" has no picture in the video (check its start and end), so nothing was saved.')
    expect(await readdir(outDir), 'no compilation was written').toEqual([])
    const scratch = path.join(os.tmpdir(), 'imagii-concat')
    expect((await readdir(scratch)).filter((f) => f.includes('t131-empty')), 'and the scratch is gone').toEqual([])
  }, 120_000)

  it('what ffmpeg says of an empty segment and of a join it cannot finish is what the runner listens for (this binary)', async () => {
    const stub = path.join(workDir, 't131-stub.mkv')
    const good = path.join(workDir, 't131-good.mkv')
    const cut = (a: number, b: number, out: string): Promise<{ stderr: string }> =>
      ff(['-y', '-ss', String(a), '-to', String(b), '-i', files.short, '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'pcm_s16le', out])
    expect((await cut(20, 22, stub)).stderr, 'a range past the picture: exit 0 and this line').toMatch(FFMPEG_EMPTY_OUTPUT)
    expect((await cut(1, 2, good)).stderr).not.toMatch(FFMPEG_EMPTY_OUTPUT)
    const list = path.join(workDir, 't131-list.txt')
    await writeFile(list, [good, stub, good].map((p) => `file '${p}'`).join('\n'))
    const joined = await ff(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'copy', '-c:a', 'aac', path.join(workDir, 't131-joined.mp4')])
    expect(joined.stderr, 'the join exits 0 and this line').toMatch(FFMPEG_UNREADABLE_PART)
  }, 60_000)

  it('the join\'s "Impossible to open" line names the segment file, and the runner reads its index off the real line (T-132 (12), this binary)', async () => {
    // The runner's segments are seg-<job>-<index>.mkv in its scratch folder; ffmpeg prints the one it cannot open. Real files, real binary.
    const dir = await mkdtemp(path.join(workDir, 't132-lost-'))
    const make = (a: number, b: number, out: string): Promise<{ stderr: string }> =>
      ff(['-y', '-ss', String(a), '-to', String(b), '-i', files.short, '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'pcm_s16le', out])
    const parts = [0, 1, 2].map((i) => path.join(dir, `seg-t132lost-${i}.mkv`))
    await make(1, 2, parts[0] as string)
    await make(20, 22, parts[1] as string) // a range past the picture: the stub the join cannot open
    await make(3, 4, parts[2] as string)
    const list = path.join(dir, 'list.txt')
    await writeFile(list, parts.map((p) => `file '${p}'`).join('\n'))
    const joined = await ff(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'copy', '-c:a', 'aac', path.join(dir, 'joined.mp4')])
    expect(joined.stderr, 'the join exits 0 and this line').toMatch(FFMPEG_UNREADABLE_PART)
    expect(unreadableSegmentIndex(joined.stderr, 't132lost'), 'and the line says which segment').toBe(1)
    expect(unreadableSegmentIndex(joined.stderr, 'someone-else'), 'only for its own job').toBeNull()
  }, 60_000)
})

describe('the sweep-17 replication: a 10 s picture with 6 s of sound, through production runConcat (real ffmpeg, T-131 (1))', () => {
  // The expediter's own harness, as the ticket quotes it: a 10 s testsrc2 video with 6 s of sine AAC (the file keeps the longer stream's
  // length), and the two compilations that were wrong. Before the pad: [1,3],[7,9],[2,4] came out 2.0 s (the stub at [7,9] ended the
  // join) and [1,3],[5,8],[2,4] 5.014 s. Whole seconds on a 15 fps grid, so every length here is exact to a frame.
  let source = ''

  beforeAll(async () => {
    source = path.join(workDir, 't131-testsrc2-10s-sine-6s.mp4')
    await ff([
      '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '150k', '-c:a', 'aac', '-b:a', '48k', source
    ])
  }, 60_000)

  async function compileLength(segments: Array<[number, number]>, jobId: string): Promise<{ video: number; sound: number }> {
    const { outputPath } = await runConcat({
      jobId,
      sourcePath: source,
      outDir: workDir,
      segments: segments.map(([startSec, endSec], i) => ({ startSec, endSec, name: `s${i}` })),
      fadeMs: 0,
      width: 320,
      height: 180
    })
    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    return { video: Number(v?.duration), sound: await packetsEnd(outputPath, 'a:0') }
  }

  it('[1,3] [7,9] [2,4]: all three clips, 6.0 s of picture and 6.0 s of sound (it was 2.0 s)', async () => {
    const out = await compileLength([[1, 3], [7, 9], [2, 4]], 't131-rep-a')
    near(out.video, 6, 0.15, 'the picture of the three clips')
    near(out.sound, 6, 0.15, 'the sound of the three clips')
  }, 120_000)

  it('[1,3] [5,8] [2,4]: the clip that straddles the end of the sound, and the one after it: 7.0 s (it was 5.014 s)', async () => {
    const out = await compileLength([[1, 3], [5, 8], [2, 4]], 't131-rep-b')
    near(out.video, 7, 0.15, 'the picture of the three clips')
    near(out.sound, 7, 0.15, 'the sound of the three clips')
  }, 120_000)
})

describe('a sound shorter than the picture does not shorten the file: re-attach and picture-in-picture (real ffmpeg, T-131 (2))', () => {
  // `-shortest` at attachAudio and compositePip ended the output where the SHORTER stream ended. Record's mic-drop takes (T-125 (25)) are that
  // shape: a 12 s picture whose microphone dropped at 5 s re-attached to a 5.0 s file (a PiP base the same; the stream-copy branch 6.0 s of a
  // 6 s sound). The sound is now padded to the picture's length, finite (`apad=whole_dur`: a bare `apad` hangs `-c:v copy`), and `-shortest`
  // stays, so the output ends at the PICTURE whichever stream is shorter. Same flash-and-beep fixtures as T-131 (1): a beep in the first 0.1 s
  // of every second, the picture white at the same instants, so what is in the output is counted. Small and low-bitrate on purpose.
  const PICTURE_SEC = 12
  const SOUND_SEC = 5
  const files = { copyBase: '', micWebm: '', cleaned: '', longCleaned: '', silentBase: '', overlay: '', longOverlay: '', streamedMic: '' }

  const picture = (secs: number): string[] => [
    '-f', 'lavfi', '-i', `color=c=black:s=320x180:r=10:d=${secs},drawbox=x=0:y=0:w=320:h=180:color=white:t=fill:enable='lt(mod(t,1),0.1)'`
  ]
  const sound = (secs: number): string[] => [
    '-f', 'lavfi', '-i', `aevalsrc='if(lt(mod(t,1),0.1),0.8*sin(2*PI*1000*t),0)':s=48000:d=${secs}`
  ]

  beforeAll(async () => {
    // An mp4 (H.264: the stream-copy branch) whose sound is 5 s of a 12 s picture. No -shortest: the file keeps the picture's 12 s.
    files.copyBase = path.join(workDir, 't131-2-base-sound-5of12.mp4')
    await ff(['-y', ...picture(PICTURE_SEC), ...sound(SOUND_SEC), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', files.copyBase])
    // The take as Record writes it with Convert off: a WebM (VP8 cannot be copied into an mp4: the re-encode branch), microphone dropped at 5 s.
    files.micWebm = path.join(workDir, 't131-2-mic-drop.webm')
    await ff(['-y', ...picture(PICTURE_SEC), ...sound(SOUND_SEC), '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '300k', '-c:a', 'libopus', '-ac', '1', files.micWebm])
    // What Audio Studio hands the mux: the cleaned sound, 5 s of the same beeps (and one LONGER than the picture, the control).
    files.cleaned = path.join(workDir, 't131-2-cleaned-5s.wav')
    await ff(['-y', ...sound(SOUND_SEC), '-ac', '2', '-c:a', 'pcm_s16le', files.cleaned])
    files.longCleaned = path.join(workDir, 't131-2-cleaned-15s.wav')
    await ff(['-y', ...sound(15), '-ac', '2', '-c:a', 'pcm_s16le', files.longCleaned])
    files.silentBase = path.join(workDir, 't131-2-silent-base.mp4')
    await ff(['-y', ...picture(PICTURE_SEC), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', files.silentBase])
    // PiP overlays: as long as the base, and longer than it.
    files.overlay = path.join(workDir, 't131-2-overlay-12s.mp4')
    await ff(['-y', '-f', 'lavfi', '-i', `color=c=0x1edf4a:s=160x90:r=10:d=${PICTURE_SEC}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', files.overlay])
    files.longOverlay = path.join(workDir, 't131-2-overlay-20s.mp4')
    await ff(['-y', '-f', 'lavfi', '-i', 'color=c=0x1edf4a:s=160x90:r=10:d=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', files.longOverlay])
  }, 120_000)

  /** The beeps a 5 s sound holds when it is laid on a picture second for second (a beep is whole from its second to 0.1 s after it). */
  const BEEPS_IN_SOUND = 5

  /** What an output must be: the picture's length, the sound reaching it (silent after the drop), the beeps that existed and no others. */
  async function expectWhole(file: string, secs: number, what: string, beeps = BEEPS_IN_SOUND): Promise<void> {
    const info = await ffprobeJson(file)
    expect(Number((info as { format?: { duration?: string } }).format?.duration), `${what}: the container's length`).toBeGreaterThan(secs - 0.2)
    expect(Number((info as { format?: { duration?: string } }).format?.duration), `${what}: the container's length`).toBeLessThan(secs + 0.2)
    const v = info.streams.find((x) => x.codec_type === 'video')
    near(Number(v?.duration) || (await packetsEnd(file, 'v:0')), secs, 0.2, `${what}: the picture`)
    near(await packetsEnd(file, 'a:0'), secs, 0.2, `${what}: the sound reaches the end of the picture`)
    const heard = await soundBurstStarts(file, 0.3, 0.5)
    expect(heard, `${what}: a beep for every one the sound held, none after it`).toHaveLength(beeps)
    expect(Math.max(...heard), `${what}: the last beep`).toBeLessThan(SOUND_SEC)
  }

  it('the sources are what they say: a 12 s picture, a sound that ends at 5 s, and a cleaned sound of 5 s and of 15 s', async () => {
    for (const key of ['copyBase', 'micWebm'] as const) {
      const info = await ffprobeJson(files[key])
      expect((await flashStarts(files[key])).length, `${key}: the picture is all 12 s`).toBe(PICTURE_SEC)
      expect(await packetsEnd(files[key], 'a:0'), `${key}: the sound ends at 5 s`).toBeLessThan(SOUND_SEC + 0.3)
      expect(info.streams.some((x) => x.codec_type === 'audio')).toBe(true)
    }
    near(await packetsEnd(files.cleaned, 'a:0'), SOUND_SEC, 0.05, 'the cleaned sound')
    near(await packetsEnd(files.longCleaned, 'a:0'), 15, 0.05, 'the long cleaned sound')
  }, 60_000)

  it('Re-attach, the picture stream-copied (H.264): 12 s of picture, the sound padded with silence after its 5 s (it was 5.0 s)', async () => {
    const out = path.join(workDir, 't131-2-mux-copy.mp4')
    await runAudioMux('t131-2-mux-copy', files.copyBase, files.cleaned, out, () => {})
    expect((await ffprobeJson(out)).streams.find((x) => x.codec_type === 'video')?.codec_name, 'the picture was copied').toBe('h264')
    await expectWhole(out, PICTURE_SEC, 'copy')
  }, 120_000)

  it('Re-attach, the picture re-encoded (a VP8 WebM, the take as Record saves it): 12 s, not the 5.0 s the sound had', async () => {
    const out = path.join(workDir, 't131-2-mux-webm.mp4')
    await runAudioMux('t131-2-mux-webm', files.micWebm, files.cleaned, out, () => {})
    expect((await ffprobeJson(out)).streams.find((x) => x.codec_type === 'video')?.codec_name, 'the picture was re-encoded').toBe('h264')
    await expectWhole(out, PICTURE_SEC, 'webm')
  }, 120_000)

  it('Re-attach through the whole flow (extract the sound of the mic-drop take, clean it, put it back): 12 s again', async () => {
    const extracted = await extractAudioFromVideo(files.micWebm)
    try {
      const out = path.join(workDir, 't131-2-reattach.mp4')
      await runAudioReattach(
        { jobId: 't131-2-reattach', videoPath: files.micWebm, sourcePath: extracted.wavPath, outputPath: out, chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [] } },
        () => {}
      )
      await expectWhole(out, PICTURE_SEC, 'the whole flow')
    } finally {
      await extracted.cleanup()
    }
  }, 120_000)

  it('Re-attach with a cut: the output is the picture less the cut (10 s), the short sound padded to it', async () => {
    const out = path.join(workDir, 't131-2-mux-cut.mp4')
    await runAudioMux('t131-2-mux-cut', files.copyBase, files.cleaned, out, () => {}, [{ startSec: 7, endSec: 9 }])
    // The cut is in the silent part of the sound, so every beep of the 5 s it held is still there.
    await expectWhole(out, PICTURE_SEC - 2, 'cut')
  }, 120_000)

  it('the control: a sound LONGER than the picture is still cut at the picture (-shortest stays)', async () => {
    const out = path.join(workDir, 't131-2-mux-long.mp4')
    await runAudioMux('t131-2-mux-long', files.copyBase, files.longCleaned, out, () => {})
    const info = await ffprobeJson(out)
    near(await packetsEnd(out, 'a:0'), PICTURE_SEC, 0.2, 'the sound is cut at the picture')
    near(Number(info.streams.find((x) => x.codec_type === 'video')?.duration), PICTURE_SEC, 0.2, 'and the picture is whole')
    expect(await soundBurstStarts(out, 0.3, 0.5), 'twelve beeps: one per second of the picture').toHaveLength(PICTURE_SEC)
  }, 120_000)

  it('Picture-in-picture, a base whose sound ends at 5 s of 12: 12 s, the overlay and the base whole (it was 5.0 s)', async () => {
    const out = path.join(workDir, 't131-2-pip.mp4')
    await runPipComposite('t131-2-pip', files.copyBase, files.overlay, out, { overlayWidth: 80, position: 'top-left', margin: 8 })
    await expectWhole(out, PICTURE_SEC, 'pip')
  }, 120_000)

  it('Picture-in-picture over the mic-drop WebM (the re-encode of a take as Record saves it): 12 s', async () => {
    const out = path.join(workDir, 't131-2-pip-webm.mp4')
    await runPipComposite('t131-2-pip-webm', files.micWebm, files.overlay, out, { overlayWidth: 80, position: 'bottom-right', margin: 8 })
    await expectWhole(out, PICTURE_SEC, 'pip webm')
  }, 120_000)

  it('Picture-in-picture, an overlay LONGER than the base: still ends with the base (-shortest stays)', async () => {
    const out = path.join(workDir, 't131-2-pip-long-overlay.mp4')
    await runPipComposite('t131-2-pip-long-overlay', files.copyBase, files.longOverlay, out, { overlayWidth: 80, position: 'top-right', margin: 8 })
    await expectWhole(out, PICTURE_SEC, 'pip with a 20 s overlay')
  }, 120_000)

  it('Picture-in-picture over a base with no sound at all: no audio stream appears, the length is the picture\'s', async () => {
    const out = path.join(workDir, 't131-2-pip-silent.mp4')
    await runPipComposite('t131-2-pip-silent', files.silentBase, files.overlay, out, { overlayWidth: 80, position: 'top-left', margin: 8 })
    const info = await ffprobeJson(out)
    expect(info.streams.filter((x) => x.codec_type === 'audio'), 'a silent base stays silent').toHaveLength(0)
    near(await packetsEnd(out, 'v:0'), PICTURE_SEC, 0.2, 'the picture')
  }, 120_000)
})

describe('the picture lands on its sound at every frame rate (real ffmpeg, T-126 (21))', () => {
  // `-r N` alone is the ENCODER's rate. The output vsync it sets drops a frame only once the output runs more than 1.1 frames ahead, so
  // whenever the effective input rate is above the preset's - any 60 / 59.94 / 50 / 120 / 48 fps recording (OBS's usual), or a 30 fps clip
  // sped up past 30 - the picture sat about two OUTPUT frames behind its sound: +67 ms for a 60 fps recording on every platform export,
  // Reframe and Compile (302 frames and the flash first visible at 5.0667 s where 300 and 5.000 s were right; the beep at 5.013 s in both),
  // and +45 to +80 ms for a 30 fps clip at 1.25x / 2x. The one control in the repo was Auto Zoom, whose chain carried `fps=30` already and
  // measured 0 ms. The fix is `fps=N` in `buildVideoFilter`, right after the retime; these read it back on the real output of all three
  // runners. Both fixtures put a flash and a beep on the same instant at the start of every second.
  const SECS = 14
  let src60 = ''
  let src30 = ''

  async function flashBeep(file: string, fps: number): Promise<void> {
    await ff([
      '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=640x360:r=${fps}:d=${SECS},drawbox=x=0:y=0:w=640:h=360:color=white:t=fill:enable='lt(mod(t,1),0.1)'`,
      '-f', 'lavfi', '-i', `aevalsrc='if(lt(mod(t,1),0.1),0.8*sin(2*PI*1000*t),0)':s=48000:d=${SECS}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-shortest', file
    ])
  }

  /** The picture's start minus the sound's start at every flash of `file`, in ms (positive: the picture is LATE). */
  async function lagsMs(file: string, gapSec = 0.5): Promise<{ lags: number[]; flashes: number }> {
    const flashes = await flashStarts(file)
    const beeps = await soundBurstStarts(file, 0.3, gapSec)
    expect(beeps.length, `${path.basename(file)}: a beep for every flash`).toBe(flashes.length)
    return { lags: flashes.map((f, i) => Math.round((f - (beeps[i] ?? 0)) * 1000)), flashes: flashes.length }
  }

  // The encoder's own delay puts the beep ~13 ms after its flash on a correct file (measured on both majors); the defect is +54 ms and more.
  const WITHIN_MS = 30
  const aligned = (lags: number[], what: string): void =>
    expect(
      Math.max(...lags.map((l) => Math.abs(l))),
      `${what}: picture minus sound at each flash is ${lags.join(' / ')} ms`
    ).toBeLessThanOrEqual(WITHIN_MS)

  beforeAll(async () => {
    src60 = path.join(workDir, 't126-lag-60.mp4')
    src30 = path.join(workDir, 't126-lag-30.mp4')
    await flashBeep(src60, 60)
    await flashBeep(src30, 30)
  }, 120_000)

  it('the fixtures are what they say: a flash and a beep on the same instant, at 60 and at 30 fps', async () => {
    for (const [file, fps] of [[src60, '60/1'], [src30, '30/1']] as const) {
      expect((await ffprobeJson(file)).streams.find((s) => s.codec_type === 'video')?.r_frame_rate, path.basename(file)).toBe(fps)
      const { lags, flashes } = await lagsMs(file)
      expect(flashes).toBe(SECS)
      aligned(lags, `the source ${path.basename(file)}`)
    }
  }, 120_000)

  it('a platform export of a 60 fps recording: the picture is on its sound, and the file is the clip\'s 10 s of 300 frames', async () => {
    const clip = makeClip({ startSec: 2, endSec: 12 })
    const res = await runExportJob(makeJob(src60, 'youtube', clip, 't126-lag-export-60'), () => {})
    const { lags, flashes } = await lagsMs(res.outputPath)
    expect(flashes, 'ten flashes in ten seconds').toBe(10)
    aligned(lags, 'the 60 fps export')
    const v = (await ffprobeJson(res.outputPath)).streams.find((s) => s.codec_type === 'video')
    near(Number(v?.duration), 10, 0.04, 'the picture is the length of the clip (302 frames, 10.07 s, before)')
  }, 180_000)

  it('Reframe of a 60 fps recording: the same', async () => {
    const outputPath = path.join(workDir, 't126-lag-reframe-60.mp4')
    await runReframe(
      { jobId: 't126-lag-reframe', sourcePath: src60, outputPath, position: 'center', startSec: 2, endSec: 12, outputWidth: 1080, outputHeight: 1920 },
      () => {}
    )
    const { lags, flashes } = await lagsMs(outputPath)
    expect(flashes).toBe(10)
    aligned(lags, 'the 60 fps reframe')
    const v = (await ffprobeJson(outputPath)).streams.find((s) => s.codec_type === 'video')
    near(Number(v?.duration), 10, 0.04, 'the reframed picture')
  }, 180_000)

  it('a compilation of two ranges of a 60 fps recording: the same, at both segments', async () => {
    const { outputPath } = await runConcat({
      jobId: 't126-lag-concat',
      sourcePath: src60,
      outDir: workDir,
      segments: [
        { startSec: 2, endSec: 5, name: 'a' },
        { startSec: 7, endSec: 10, name: 'b' }
      ],
      fadeMs: 0,
      width: 640,
      height: 360
    })
    const { lags, flashes } = await lagsMs(outputPath)
    expect(flashes, 'three flashes in each of the two segments').toBe(6)
    aligned(lags, 'the 60 fps compilation')
  }, 180_000)

  it('a 30 fps clip sped up to 2x, which is 60 frames a second after the retime: the same', async () => {
    const clip = makeClip({ startSec: 2, endSec: 12, speedMultiplier: 2 })
    const res = await runExportJob(makeJob(src30, 'youtube', clip, 't126-lag-export-2x'), () => {})
    // At 2x the beeps are 0.05 s long and half a second apart.
    const { lags, flashes } = await lagsMs(res.outputPath, 0.2)
    expect(flashes, 'ten flashes in five seconds').toBe(10)
    aligned(lags, 'the 2x export')
    const v = (await ffprobeJson(res.outputPath)).streams.find((s) => s.codec_type === 'video')
    near(Number(v?.duration), 5, 0.04, 'the sped-up picture')
  }, 180_000)
})

describe('the compilation follows the source\'s frame rate, up to 60 (real ffmpeg, T-130 (q))', () => {
  // Every compilation was written at 30 fps, so the montage of a 60 fps recording (OBS's usual) had half its frames while a platform export of
  // the same recording had all of them, and a 24 fps film gained duplicated ones. The rate is now the source's, capped at 60: the fps stage and
  // `-r` of every segment. Each source has a flash and a beep on the same instant at the start of every second, so the output is judged on the
  // clock: two 3 s ranges (source seconds 2-5 and 7-10) are 6 s with a flash at 0, 1, 2, 3, 4 and 5 s, and a count of frames that is the rate
  // times six. `r_frame_rate` is ffprobe's reading of the container (the exact rate), not the average over a join.
  const SECS = 12
  const RANGES = [{ startSec: 2, endSec: 5, name: 'a' }, { startSec: 7, endSec: 10, name: 'b' }]
  const sources: Record<'fps60' | 'ntsc60' | 'fps120', string> = { fps60: '', ntsc60: '', fps120: '' }

  async function flashBeepAt(file: string, rate: string): Promise<void> {
    await ff([
      '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=640x360:r=${rate}:d=${SECS},drawbox=x=0:y=0:w=640:h=360:color=white:t=fill:enable='lt(mod(t,1),0.1)'`,
      '-f', 'lavfi', '-i', `aevalsrc='if(lt(mod(t,1),0.1),0.8*sin(2*PI*1000*t),0)':s=48000:d=${SECS}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-shortest', file
    ])
  }

  /** The container's exact rate (`r_frame_rate`) is `exact`, and the average over the whole file is within `within` (a quarter of a percent) of `rate` (a join's stamps are whole milliseconds). */
  const expectRate = async (file: string, exact: string, rate: number, what: string, within = 0.0025): Promise<void> => {
    const v = (await ffprobeJson(file)).streams.find((s) => s.codec_type === 'video')
    expect(v?.r_frame_rate, `${what}: the container's rate`).toBe(exact)
    const [n, d] = (v?.avg_frame_rate ?? '0/1').split('/').map(Number)
    const avg = (n ?? 0) / (d || 1)
    expect(Math.abs(avg - rate) / rate, `${what}: average ${v?.avg_frame_rate} = ${avg} fps`).toBeLessThan(within)
  }

  /** The compilation of RANGES from `src`, with the flashes and beeps read back. */
  async function compileRanges(src: string, jobId: string): Promise<{ outputPath: string; flashes: number[]; lags: number[]; frames: number }> {
    const { outputPath } = await runConcat({ jobId, sourcePath: src, outDir: workDir, segments: RANGES, fadeMs: 0, width: 640, height: 360 })
    const flashes = await flashStarts(outputPath)
    const beeps = await soundBurstStarts(outputPath, 0.3, 0.5)
    expect(beeps, 'a beep for every flash').toHaveLength(flashes.length)
    return {
      outputPath,
      flashes,
      lags: flashes.map((f, i) => Math.round((f - (beeps[i] ?? 0)) * 1000)),
      frames: (await videoPacketTimes(outputPath)).length
    }
  }

  /** Six flashes, each on its second of the compiled timeline to within `toleranceSec`, and each on its beep to within 30 ms. */
  function onTheIdealTimeline(got: { flashes: number[]; lags: number[] }, toleranceSec: number, what: string): void {
    expect(got.flashes, `${what}: a flash for each of the six whole seconds`).toHaveLength(6)
    got.flashes.forEach((f, i) => near(f, i, toleranceSec, `${what}: flash ${i}`))
    expect(Math.max(...got.lags.map(Math.abs)), `${what}: picture minus sound at each flash is ${got.lags.join(' / ')} ms`).toBeLessThanOrEqual(30)
  }

  beforeAll(async () => {
    sources.fps60 = path.join(workDir, 't130-q-60.mp4')
    sources.ntsc60 = path.join(workDir, 't130-q-5994.mp4')
    sources.fps120 = path.join(workDir, 't130-q-120.mp4')
    await flashBeepAt(sources.fps60, '60')
    await flashBeepAt(sources.ntsc60, '60000/1001')
    await flashBeepAt(sources.fps120, '120')
  }, 180_000)

  it('the fixtures are what they say: 60, 59.94 and 120 fps', async () => {
    await expectRate(sources.fps60, '60/1', 60, 'the 60 fps source')
    await expectRate(sources.ntsc60, '60000/1001', 60000 / 1001, 'the 59.94 source')
    await expectRate(sources.fps120, '120/1', 120, 'the 120 fps source')
  })

  it('a 60 fps source is compiled at 60: 360 frames in six seconds, and every flash on its second and on its beep', async () => {
    const got = await compileRanges(sources.fps60, 't130-q-60')
    await expectRate(got.outputPath, '60/1', 60, 'the 60 fps compilation')
    expect(Math.abs(got.frames - 360), `${got.frames} frames in the six seconds (a 30 fps compilation has 180)`).toBeLessThanOrEqual(3)
    onTheIdealTimeline(got, 0.03, 'the 60 fps compilation')
  }, 240_000)

  it('59.94 stays 59.94 - the container reads 60000/1001, not 60 - and keeps its frames and its flashes', async () => {
    const got = await compileRanges(sources.ntsc60, 't130-q-5994')
    await expectRate(got.outputPath, '60000/1001', 60000 / 1001, 'the 59.94 compilation')
    expect(Math.abs(got.frames - 360), `${got.frames} frames`).toBeLessThanOrEqual(3)
    onTheIdealTimeline(got, 0.04, 'the 59.94 compilation')
  }, 240_000)

  it('a 120 fps source is brought down to 60, not written at 120', async () => {
    const got = await compileRanges(sources.fps120, 't130-q-120')
    await expectRate(got.outputPath, '60/1', 60, 'the 120 fps compilation')
    expect(Math.abs(got.frames - 360), `${got.frames} frames (720 at 120 fps)`).toBeLessThanOrEqual(3)
    onTheIdealTimeline(got, 0.03, 'the 120 fps compilation')
  }, 240_000)

  it('a source slower than 30 keeps its own rate: the 24 fps ramp compiles at 24, with its content in order', async () => {
    const { outputPath } = await runConcat({
      jobId: 't130-q-24',
      sourcePath: rampSrc,
      outDir: workDir,
      segments: [{ startSec: 2, endSec: 4, name: 'first' }, { startSec: 12, endSec: 14, name: 'second' }],
      fadeMs: 0,
      width: 640,
      height: 360
    })
    await expectRate(outputPath, '24/1', 24, 'the 24 fps compilation')
    near((await videoPacketTimes(outputPath)).length / 24, 4, 0.1, 'four seconds of 24 fps frames')
    // The ramp's luma is 12 * t: 0.5 s into each range is source seconds 2.5 and 12.5.
    near(await meanLuma(outputPath, 0.5), 30, 12, 'the first range, by its luma')
    near(await meanLuma(outputPath, 2.5), 150, 12, 'the second range, by its luma')
  }, 120_000)

  it('a source whose container states no rate (a Record take, 1000/1) falls back to 30, not to the cap', async () => {
    // The trap the fallback exists for: the stream's own rate reads 1000, which is its clock; taking it at its word and capping it would write a
    // 60 fps compilation of a recording made at about 30. The probe reads it as "no rate" (0, T-120) and the compilation is the fallback.
    const raw = path.join(workDir, 't130-q-record.webm')
    const saved = path.join(workDir, 't130-q-record-saved.webm')
    await mediaRecorderWebm('libvpx', raw, 4)
    await remuxWebm('recording', raw, saved)
    expect((await ffprobeJson(saved)).streams.find((s) => s.codec_type === 'video')?.avg_frame_rate, 'the fixture reads 1000/1').toBe('1000/1')
    expect((await probeVideo(saved)).fps, 'and the product\'s probe says it states no rate').toBe(0)
    const { outputPath } = await runConcat({
      jobId: 't130-q-record',
      sourcePath: saved,
      outDir: workDir,
      segments: [{ startSec: 0.2, endSec: 1.6, name: 'a' }, { startSec: 2, endSec: 3.4, name: 'b' }],
      fadeMs: 0,
      width: 320,
      height: 240
    })
    // A jittered take (+-11 ms a packet) and a `-shortest` edge on each range: a few percent of slack on the average, none on the container's rate.
    await expectRate(outputPath, '30/1', 30, 'the fallback compilation', 0.03)
    near((await videoPacketTimes(outputPath)).length / 30, 2.8, 0.15, 'the 2.8 s of the two ranges at 30 fps')
  }, 240_000)

  it('YouTube 1080p60 exports a 60 fps recording at 60: 300 frames in five seconds, every flash on its second and its beep', async () => {
    const clip = makeClip({ startSec: 2, endSec: 7, selectedPresets: ['youtube60'] })
    const res = await runExportJob(makeJob(sources.fps60, 'youtube60', clip, 't130-q-youtube60'), () => {})
    await expectRate(res.outputPath, '60/1', 60, 'the YouTube 1080p60 export')
    const v = (await ffprobeJson(res.outputPath)).streams.find((s) => s.codec_type === 'video')
    expect([v?.width, v?.height]).toEqual([1920, 1080])
    expect(Math.abs((await videoPacketTimes(res.outputPath)).length - 300)).toBeLessThanOrEqual(2)
    const flashes = await flashStarts(res.outputPath)
    const beeps = await soundBurstStarts(res.outputPath, 0.3, 0.5)
    expect(flashes, 'a flash in each of the five seconds').toHaveLength(5)
    flashes.forEach((f, i) => near(f, i, 0.03, `flash ${i}`))
    expect(Math.max(...flashes.map((f, i) => Math.abs(f - (beeps[i] ?? 0)) * 1000)), 'picture on its sound').toBeLessThanOrEqual(30)
  }, 240_000)

  it('YouTube 1080p60 of a 30 fps recording is still a 60 fps file (the preset\'s rate is the fps stage\'s, whatever the source was)', async () => {
    const clip = makeClip({ startSec: 1, endSec: 4, selectedPresets: ['youtube60'] })
    const res = await runExportJob(makeJob(landscapeSrc, 'youtube60', clip, 't130-q-youtube60-from30'), () => {})
    await expectRate(res.outputPath, '60/1', 60, 'the YouTube 1080p60 export of a 30 fps recording')
    near(Number(((await ffprobeJson(res.outputPath)).format.duration)), 3, 0.15, 'the clip\'s three seconds')
  }, 240_000)
})

describe('a Clip Kit thumbnail is the clip\'s cropped picture (real ffmpeg, T-130 (t))', () => {
  // The kit's three thumbnails were taken from the WHOLE frame, so a 16:9 recording cropped to 9:16 (the usual way a streamer makes a vertical clip)
  // got three landscape pictures of everything the crop had thrown away. The fixture is a red frame (the part the crop excludes) with a blue square
  // outside the crop, and inside it a green strip (the exact 9:16 cut of the frame's middle) carrying a white square: "the crop reached the picture"
  // is a question about the colors of its pixels. 220/640 and 200/640 are exact in binary, so the region is exactly 200x360 at x=220.
  const CROP = { x: 220 / 640, y: 0, w: 200 / 640, h: 1 }
  let src = ''

  beforeAll(async () => {
    src = path.join(workDir, 't130-t-thumb-source.mp4')
    await ff([
      '-y',
      '-f', 'lavfi', '-i',
      'color=c=red:s=640x360:r=5:d=2,drawbox=x=60:y=100:w=60:h=60:color=blue:t=fill,drawbox=x=220:y=0:w=200:h=360:color=green:t=fill,drawbox=x=230:y=20:w=40:h=40:color=white:t=fill',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv444p', src
    ])
  }, 60_000)

  const sizeOf = async (file: string): Promise<[number | undefined, number | undefined]> => {
    const v = (await ffprobeJson(file)).streams.find((s) => s.codec_type === 'video')
    return [v?.width, v?.height]
  }

  it('the control: with no crop the thumbnail is the whole frame - the red, the blue square and the green strip are all in it', async () => {
    const out = path.join(workDir, 't130-t-thumb-whole.jpg')
    await extractFrame(src, 1, out)
    expect(await sizeOf(out)).toEqual([640, 360])
    expect(await countTintedPixels(out, 0, 'null', 0), 'red pixels (outside the crop)').toBeGreaterThan(100_000)
    expect(await countTintedPixels(out, 0, 'null', 2), 'blue pixels (outside the crop)').toBeGreaterThan(2000)
    expect(await countTintedPixels(out, 0, 'null', 1), 'green pixels (the strip)').toBeGreaterThan(50_000)
  }, 60_000)

  it('a cropped clip\'s thumbnail is the crop: 200x360, the strip and its white square in, no red and no blue anywhere', async () => {
    const out = path.join(workDir, 't130-t-thumb-cropped.jpg')
    await extractFrame(src, 1, out, CROP)
    expect(await sizeOf(out), 'exactly the cropped region, not the frame').toEqual([200, 360])
    expect(await countTintedPixels(out, 0, 'null', 0), 'no red: everything outside the crop is gone').toBe(0)
    expect(await countTintedPixels(out, 0, 'null', 2), 'no blue: the square outside the crop is gone').toBe(0)
    const green = await countTintedPixels(out, 0, 'null', 1)
    expect(green, `${green} of ${200 * 360} pixels are the strip's green`).toBeGreaterThan(200 * 360 * 0.9)
    // The white square sits at (10, 20) of the crop, 40 px across: its middle is white, the strip's green is not.
    const square = await regionLuma(out, 0, 'crop=20:20:20:30')
    const strip = await regionLuma(out, 0, 'crop=20:20:140:250')
    expect(square.min, `the white square is where the crop puts it (luma ${square.min}..${square.max})`).toBeGreaterThan(220)
    expect(strip.max, `the strip beside it is not (luma ${strip.min}..${strip.max})`).toBeLessThan(200)
  }, 60_000)

  it('the three kit moments of a cropped clip are all the crop', async () => {
    // The kit takes its thumbnails at 25 / 50 / 75 % of the clip, one extractFrame each, all with the clip's crop.
    for (const [i, at] of [0.25, 0.5, 0.75].entries()) {
      const out = path.join(workDir, `t130-t-thumb-kit-${i}.jpg`)
      await extractFrame(src, at * 2, out, CROP)
      expect(await sizeOf(out), `thumbnail ${i + 1}`).toEqual([200, 360])
      expect(await countTintedPixels(out, 0, 'null', 0), `thumbnail ${i + 1}: no red`).toBe(0)
    }
  }, 120_000)

  it('a crop with odd edges (the editor\'s fractions are never whole pixels) still writes a JPEG of even size inside the frame', async () => {
    const out = path.join(workDir, 't130-t-thumb-odd.jpg')
    await extractFrame(src, 1, out, { x: 0.3417, y: 0.0101, w: 0.3123, h: 0.9701 })
    const [w, h] = await sizeOf(out)
    expect([(w ?? 1) % 2, (h ?? 1) % 2], `${w}x${h}`).toEqual([0, 0])
    expect(w, '0.3123 of 640 is 199.9: the even pixel below it').toBe(198)
    expect(h, 'about 0.9701 of 360').toBeLessThanOrEqual(350)
  }, 60_000)

  it('an odd-sized source (1919x1079) with a crop writes a thumbnail of the crop', async () => {
    const odd = path.join(workDir, 't130-t-thumb-odd-source.mp4')
    await ff([
      '-y', '-f', 'lavfi', '-i',
      'color=c=red:s=1919x1079:r=5:d=1,drawbox=x=600:y=0:w=640:h=1079:color=green:t=fill',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv444p', odd
    ])
    const out = path.join(workDir, 't130-t-thumb-odd-source.jpg')
    await extractFrame(odd, 0.5, out, { x: 610 / 1919, y: 0, w: 600 / 1919, h: 1 })
    const [w, h] = await sizeOf(out)
    expect([(w ?? 1) % 2, (h ?? 1) % 2], `${w}x${h}`).toEqual([0, 0])
    expect(await countTintedPixels(out, 0, 'null', 0), 'no red: the crop is inside the green strip').toBe(0)
  }, 60_000)
})

// ---------------------------------------------------------------------------
// T-04 — highlight discovery and clip cutting
// ---------------------------------------------------------------------------

describe('a clip with no picture is an error in a sentence, not a file that says Exported (real ffmpeg, T-132 (4))', () => {
  // Export, Reframe and the Clip Kit's thumbnails closed on `code === 0` alone. ffmpeg exits 0 for a range that lies past the PICTURE, having written
  // one of two things: a 261-byte container with no streams (the range is past the end of the whole file - a project restored over a recording that got
  // shorter, OBS reusing a file name - and stderr says "Output file is empty"), or an audio-only mp4 (the range is past the last frame of a file whose
  // SOUND runs longer than its picture, and stderr says nothing of the kind). The fact that holds in both is the last progress block's `frame=0`.
  // The fixtures: `short` is a 5 s picture with 5 s of sound; `longaudio` is a 5 s picture with 9 s of sound (the second shape's trigger).
  const NO_PICTURE = (name: string): string => `The clip "${name}" has no picture in the video (check its start and end), so nothing was exported.`
  let short = ''
  let longAudio = ''

  beforeAll(async () => {
    short = path.join(workDir, 't132-4-short.mp4')
    await ff([
      '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '48k', short
    ])
    longAudio = path.join(workDir, 't132-4-long-audio.mp4')
    await ff([
      '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=9',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '48k', longAudio
    ])
  }, 60_000)

  const outDirFor = (name: string): Promise<string> => mkdtemp(path.join(workDir, `t132-4-${name}-`))
  const exportRange = async (source: string, name: string, startSec: number, endSec: number): Promise<{ error: Error | null; outDir: string; outputPath: string | null }> => {
    const outDir = await outDirFor(name)
    const clip = makeClip({ name: 'Boss fight', startSec, endSec })
    try {
      const res = await runExportJob({ jobId: `t132-4-${name}`, sourcePath: source, outDir, clip, preset: 'youtube' }, () => {})
      return { error: null, outDir, outputPath: res.outputPath }
    } catch (e) {
      return { error: e as Error, outDir, outputPath: null }
    }
  }
  const streamsOf = async (file: string): Promise<string[]> => (await ffprobeJson(file)).streams.map((x) => x.codec_type)

  it('the control: a clip inside the picture exports a file with a picture and a sound', async () => {
    const run = await exportRange(short, 'control', 1, 3)
    expect(run.error, 'a normal clip is a success').toBeNull()
    expect(await streamsOf(run.outputPath as string)).toEqual(['video', 'audio'])
  }, 120_000)

  it('the range is past the end of the file (a restored project whose recording got shorter): a sentence, and no stub left in the folder', async () => {
    const run = await exportRange(short, 'past-end', 8, 10)
    expect(run.error?.message).toBe(NO_PICTURE('Boss fight'))
    expect(await readdir(run.outDir), 'the 261-byte streamless stub is the job\'s wreckage and is gone').toEqual([])
  }, 120_000)

  it('the range is past the last frame of a file whose sound runs on (the audio-only shape): the same sentence, and no audio-only mp4 left', async () => {
    const run = await exportRange(longAudio, 'audio-only', 6, 8)
    expect(run.error?.message).toBe(NO_PICTURE('Boss fight'))
    expect(await readdir(run.outDir), 'an mp4 with a sound and no picture is not an export').toEqual([])
  }, 120_000)

  it('a range that STRADDLES the last frame is still an export: the picture that is there is written', async () => {
    const run = await exportRange(longAudio, 'straddle', 4, 8)
    expect(run.error, 'part of the range has a picture').toBeNull()
    expect(await streamsOf(run.outputPath as string)).toContain('video')
    const frames = Number((await ffprobeJson(run.outputPath as string)).streams.find((x) => x.codec_type === 'video')?.nb_frames)
    expect(frames, 'about one second of 30 fps picture').toBeGreaterThan(15)
  }, 120_000)

  it.each([['20 ms', 1, 1.02], ['10 ms', 1, 1.01]])('discrimination: a legitimate %s clip is a success with a picture in it (not mistaken for an empty file)', async (_label, a, b) => {
    const run = await exportRange(short, `tiny-${a}-${b}`.replace('.', '_'), a, b)
    expect(run.error, 'a clip of one or two frames is a picture').toBeNull()
    const info = await ffprobeJson(run.outputPath as string)
    const v = info.streams.find((x) => x.codec_type === 'video')
    expect(v, 'it has a picture').toBeDefined()
    expect(Number(v?.nb_frames)).toBeGreaterThanOrEqual(1)
  }, 120_000)

  it('Reframe: past the end of the file and past the last frame are the same sentence, with no file written; a clip with a picture is a vertical file', async () => {
    const reframe = async (source: string, name: string, startSec: number, endSec: number): Promise<{ error: Error | null; outputPath: string }> => {
      const outputPath = path.join(await outDirFor(`rf-${name}`), 'vertical.mp4')
      try {
        await runReframe({ jobId: `t132-4-rf-${name}`, sourcePath: source, outputPath, position: 'center', startSec, endSec, outputWidth: 1080, outputHeight: 1920 }, () => {})
        return { error: null, outputPath }
      } catch (e) {
        return { error: e as Error, outputPath }
      }
    }
    const NONE = 'This part of the video has no picture (check the clip\'s start and end), so no 9:16 file was saved.'
    const past = await reframe(short, 'past', 8, 10)
    expect(past.error?.message).toBe(NONE)
    expect(existsSync(past.outputPath)).toBe(false)
    const audioOnly = await reframe(longAudio, 'audio-only', 6, 8)
    expect(audioOnly.error?.message).toBe(NONE)
    expect(existsSync(audioOnly.outputPath)).toBe(false)
    const tiny = await reframe(short, 'tiny', 1, 1.02)
    expect(tiny.error, 'a 20 ms clip is a picture').toBeNull()
    expect(await streamsOf(tiny.outputPath)).toContain('video')
    const ok = await reframe(short, 'ok', 1, 3)
    expect(ok.error).toBeNull()
    expect(await streamsOf(ok.outputPath)).toEqual(['video', 'audio'])
  }, 180_000)

  it('extractFrame: a time past the last frame is a sentence (it used to resolve with no file); a time inside it is a JPEG', async () => {
    const dir = await outDirFor('frame')
    const past = path.join(dir, 'past.jpg')
    for (const [source, at] of [[short, 7], [longAudio, 7]] as const) {
      const err = await extractFrame(source, at, past).then(() => null, (e: Error) => e)
      expect(err?.message, `${path.basename(source)} at ${at} s`).toBe('The video has no picture at that point (check the clip\'s start and end), so the thumbnail was not saved.')
      expect(existsSync(past), 'nothing was written').toBe(false)
    }
    const good = path.join(dir, 'good.jpg')
    await extractFrame(short, 2, good)
    expect((await stat(good)).size).toBeGreaterThan(0)
    expect(await streamsOf(good)).toEqual(['video'])
  }, 120_000)

  it('what ffmpeg prints for each shape is what the runners read (this binary): the empty-output line for the stub, a final frame=0 for both', async () => {
    const probe = async (source: string, a: number, b: number): Promise<{ stderr: string; stdout: string }> => {
      const out = path.join(await outDirFor('read'), 'o.mp4')
      return ff(['-y', '-ss', String(a), '-to', String(b), '-i', source, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-progress', 'pipe:1', '-nostats', out])
    }
    const stub = await probe(short, 8, 10)
    expect(stub.stderr, 'a range past the end of the file').toMatch(FFMPEG_EMPTY_OUTPUT)
    const stubFrames = new PictureFrames()
    stubFrames.feed(stub.stdout)
    expect(stubFrames.none, 'and its last progress block says no frame').toBe(true)
    const audioOnly = await probe(longAudio, 6, 8)
    expect(audioOnly.stderr, 'an audio-only output is NOT announced as empty: that line alone cannot catch it').not.toMatch(FFMPEG_EMPTY_OUTPUT)
    const audioFrames = new PictureFrames()
    audioFrames.feed(audioOnly.stdout)
    expect(audioFrames.none, 'but the progress block still says no frame').toBe(true)
    const normal = await probe(short, 1, 2)
    const normalFrames = new PictureFrames()
    normalFrames.feed(normal.stdout)
    expect(normalFrames.none, 'a normal clip reports frames').toBe(false)
    expect(normal.stderr).not.toMatch(FFMPEG_EMPTY_OUTPUT)
  }, 60_000)

  // T-134 (4): the comment and the guide said a compilation's segments read BOTH facts (the stderr line and `frame=0`); `concat.ts` reads the line
  // alone, and the sweep asked whether that is enough for the audio-only shape (the sound outlasts the picture), the one the line cannot catch in
  // Export. Measured on both majors by three parties: it is. A segment is written with `apad=whole_dur` and `-shortest`, so a range past the last
  // frame of this 5 s picture / 9 s sound source ends where the PICTURE does: a truly streamless stub and the line, never an audio-only file.
  it('a compilation segment past the last frame of a 5 s picture with 9 s of sound is a streamless stub AND the empty-output line, so the line alone is enough (T-134 (4), this binary)', async () => {
    // The segment as the runner writes it: the production filters, the production codecs, -shortest.
    const writeSegment = async (startSec: number, endSec: number, out: string): Promise<{ stderr: string }> => {
      const filters = buildSegmentFilters({ startSec, endSec }, { width: 320, height: 180 }, 320, 180, 0, 0, 30)
      return ff([
        '-y', '-ss', startSec.toFixed(3), '-to', endSec.toFixed(3), '-i', longAudio,
        '-vf', filters.video, '-af', filters.audio,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', SEGMENT_AUDIO_CODEC, '-r', '30',
        '-shortest',
        out
      ])
    }
    const dir = await outDirFor('segment-shape')
    const stub = path.join(dir, `past.${SEGMENT_EXTENSION}`)
    const written = await writeSegment(6, 8, stub)
    expect(written.stderr, 'the line the runner reads').toMatch(FFMPEG_EMPTY_OUTPUT)
    expect((await stat(stub)).size, 'a stub of a kilobyte, not a media file').toBeLessThan(2048)
    // ffprobe cannot read it at all (a stream-less Matroska header: "Read error", exit 1), so ask for the streams and accept the failure.
    const streamTypes = await new Promise<string[]>((resolve, reject) => {
      const child = spawn(ffprobePath, ['-v', 'quiet', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', stub])
      let out = ''
      child.stdout.on('data', (b) => (out += String(b)))
      child.on('error', reject)
      child.on('close', () => resolve(out.split('\n').map((l) => l.trim()).filter((l) => l !== '')))
    })
    expect(streamTypes, 'with no picture and no sound in it').toEqual([])
    // (The other three runners cannot do with the line alone: their commands have no `-shortest`/`apad`, and the same range there is an audio-only
    // file with no line at all - pinned just above, "what ffmpeg prints for each shape".) Through the production runner, in a list: the clip that
    // has no picture is named, and nothing is left behind.
    const outDir = await outDirFor('segment-run')
    const err = await runConcat({
      jobId: 't134-4-segments',
      sourcePath: longAudio,
      outDir,
      segments: [{ startSec: 1, endSec: 2, name: 'a' }, { startSec: 6, endSec: 8, name: 'b' }],
      fadeMs: 0,
      width: 320,
      height: 180
    }).then(() => null, (e: Error) => e)
    expect(err?.message).toBe('The clip "b" has no picture in the video (check its start and end), so nothing was saved.')
    expect(await readdir(outDir), 'no compilation was written').toEqual([])
  }, 120_000)
})

describe('a ranged caption burn-in of a range with no picture is an error in a sentence, not "Captions burned in" (real ffmpeg, T-133 (4))', () => {
  // The burn-in was the one ranged video writer left without T-131 (1) / T-132 (4)'s guard. Executed on both majors (7.0.2 and 6.1.1), with the
  // subtitles stage and without it: a range past the PICTURE exits 0, prints nothing to stderr, reports `frame=0` in its last progress block and
  // writes an audio-only mp4 (`-c:a copy` copies the sound that is there), and `code === 0` alone resolved. `short` is a 5 s picture with 5 s of
  // sound; `longaudio` is a 5 s picture with 9 s of sound. The subtitles filter is in this binary on both majors (the bundled linux 7.0.2 has no
  // drawtext, which the burn-in does not use), so these run wherever the rest of the burn-in cases do.
  let short = ''
  let longAudio = ''
  let srt = ''

  beforeAll(async () => {
    short = path.join(workDir, 't133-4-short.mp4')
    await ff([
      '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '48k', short
    ])
    longAudio = path.join(workDir, 't133-4-long-audio.mp4')
    await ff([
      '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=9',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '48k', longAudio
    ])
    // A cue in every range the cases burn, so the `subtitles` stage is in the graph (the shape a real captioned clip has).
    srt = path.join(workDir, 't133-4-cues.srt')
    await writeFile(
      srt,
      '1\n00:00:01,200 --> 00:00:02,500\nINSIDE THE PICTURE\n\n' + '2\n00:00:04,200 --> 00:00:04,800\nNEAR THE LAST FRAME\n\n' + '3\n00:00:06,200 --> 00:00:07,800\nAFTER THE PICTURE\n\n' + '4\n00:00:08,200 --> 00:00:09,800\nPAST THE FILE\n',
      'utf8'
    )
  }, 60_000)

  const outDirFor = (name: string): Promise<string> => mkdtemp(path.join(workDir, `t133-4-${name}-`))
  const burn = async (source: string, name: string, startSec: number | undefined, endSec: number | undefined, srtPath = srt): Promise<{ error: Error | null; outDir: string; outputPath: string; captioned?: boolean }> => {
    const outDir = await outDirFor(name)
    const outputPath = path.join(outDir, 'captioned.mp4')
    try {
      const res = await runBurnIn(
        { jobId: `t133-4-${name}`, videoPath: source, srtPath, outputPath, fontSizePct: 4, ...(startSec === undefined ? {} : { startSec, endSec }) },
        () => {}
      )
      return { error: null, outDir, outputPath, captioned: res.captioned }
    } catch (e) {
      return { error: e as Error, outDir, outputPath }
    }
  }
  const streamsOf = async (file: string): Promise<string[]> => (await ffprobeJson(file)).streams.map((x) => x.codec_type)
  /** Files beside the SRT that start with its name: a leaked shifted copy. */
  const srtSiblings = async (): Promise<string[]> => (await readdir(path.dirname(srt))).filter((f) => f.startsWith(path.basename(srt)) && f !== path.basename(srt))

  it('the control: a range inside the picture burns a file with a picture, a sound and its caption', async () => {
    const run = await burn(short, 'control', 1, 3)
    expect(run.error, 'a normal range is a success').toBeNull()
    expect(run.captioned).toBe(true)
    expect(await streamsOf(run.outputPath)).toEqual(['video', 'audio'])
  }, 120_000)

  it('the range is past the end of the file (a restored project whose recording got shorter): a sentence, and no file left', async () => {
    const run = await burn(short, 'past-end', 8, 10)
    expect(run.error?.message).toBe(BURN_IN_NO_PICTURE_MESSAGE)
    expect(await readdir(run.outDir), 'the audio-only output is the job\'s wreckage and is gone').toEqual([])
    expect(await srtSiblings(), 'and so is the shifted SRT').toEqual([])
  }, 120_000)

  it('the range is past the last frame of a file whose sound runs on (the audio-only shape): the same sentence, with the subtitles stage and without it', async () => {
    const withCue = await burn(longAudio, 'audio-only', 6, 8)
    expect(withCue.error?.message).toBe(BURN_IN_NO_PICTURE_MESSAGE)
    expect(await readdir(withCue.outDir), 'an mp4 with a sound and no picture is not the captioned video').toEqual([])
    // No cue inside the range: the burn has no subtitle stage at all (T-81), and is held to the same fact.
    const noCueSrt = path.join(workDir, 't133-4-no-cue-here.srt')
    await writeFile(noCueSrt, '1\n00:00:01,000 --> 00:00:02,000\nONLY INSIDE THE PICTURE\n', 'utf8')
    const bare = await burn(longAudio, 'audio-only-bare', 6, 8, noCueSrt)
    expect(bare.error?.message).toBe(BURN_IN_NO_PICTURE_MESSAGE)
    expect(await readdir(bare.outDir)).toEqual([])
    expect(await srtSiblings()).toEqual([])
  }, 180_000)

  it('a range that STRADDLES the last frame is still a burn: the picture that is there is written', async () => {
    const run = await burn(longAudio, 'straddle', 4, 8)
    expect(run.error, 'part of the range has a picture').toBeNull()
    expect(await streamsOf(run.outputPath)).toContain('video')
    const frames = Number((await ffprobeJson(run.outputPath)).streams.find((x) => x.codec_type === 'video')?.nb_frames)
    expect(frames, 'about one second of 15 fps picture').toBeGreaterThan(10)
  }, 120_000)

  it.each([['20 ms', 1, 1.02], ['10 ms', 1, 1.01]])('discrimination: a legitimate %s range is a success with a picture in it (not mistaken for an empty file)', async (_label, a, b) => {
    const run = await burn(short, `tiny-${a}-${b}`.replace('.', '_'), a, b)
    expect(run.error, 'a range of one frame is a picture').toBeNull()
    const v = (await ffprobeJson(run.outputPath)).streams.find((x) => x.codec_type === 'video')
    expect(v, 'it has a picture').toBeDefined()
    expect(Number(v?.nb_frames)).toBeGreaterThanOrEqual(1)
  }, 120_000)

  it('a burn of the whole video (no range) is a success, and the guard does not touch it', async () => {
    const run = await burn(short, 'whole', undefined, undefined)
    expect(run.error).toBeNull()
    expect(await streamsOf(run.outputPath)).toEqual(['video', 'audio'])
  }, 120_000)
})

describe('the highlight scans compute no true peak, and read the same series without it (real ffmpeg, T-126 (23))', () => {
  // `ebur128=...:peak=true` oversamples every block 4x to find the true peak, and the parser reads only `t:` and `M:`: the scan paid about
  // 3x its time on a VOD (14.7 s against 4.8 s on 30 minutes) for numbers it threw away. The production string is `EBUR128_SCAN_FILTER`
  // (both passes use it); this runs the REAL binary on it and on the same string with the true peak switched on, and holds that dropping the
  // option changes the cost and nothing else: no true-peak output at all, and the series the parser reads is the same, sample for sample.
  const scan = async (filter: string): Promise<string> =>
    (await ff(['-hide_banner', '-i', rampSrc, '-vn', '-af', filter, '-f', 'null', '-'])).stderr

  it('the production filter computes no true peak, and the control (peak=true) does: the check can see what it is looking for', async () => {
    const without = await scan(EBUR128_SCAN_FILTER)
    const withPeak = await scan(`${EBUR128_SCAN_FILTER}:peak=true`)
    expect(withPeak, 'peak=true prints a true-peak column on every line').toMatch(/TPK:/)
    expect(withPeak, '...and a true-peak summary').toMatch(/True peak/i)
    expect(without, 'the production filter prints no true peak on any line').not.toMatch(/TPK:/)
    expect(without, '...and no summary of one').not.toMatch(/True peak/i)
  }, 60_000)

  it('the series the parser reads is identical with and without it: every t and every M, so every window found is the same', async () => {
    const without = highlightsTesting.parseEbur128(await scan(EBUR128_SCAN_FILTER))
    const withPeak = highlightsTesting.parseEbur128(await scan(`${EBUR128_SCAN_FILTER}:peak=true`))
    expect(without.length, 'a 20 s source is about 200 samples at 10 a second').toBeGreaterThan(150)
    expect(without).toEqual(withPeak)
  }, 60_000)
})

describe('highlight clip cutting (real ffmpeg)', () => {
  // The seek/cut boundary had never run against ffmpeg. "Exit 0 with the
  // right duration" is satisfied by a cut that silently starts at t=0, so
  // every case here also reads the ramp fixture's per-frame clock back out
  // of the output.

  it('cuts at a known timestamp with the right duration AND the right start frame', async () => {
    const clip = makeClip({ name: 'cut-at-8', startSec: 8, endSec: 11 })
    const res = await runExportJob(
      makeJob(rampSrc, 'youtube', clip, 'cut-at-8'),
      () => {}
    )
    const info = await ffprobeJson(res.outputPath)
    const dur = Number(info.format.duration)
    expect(dur).toBeGreaterThan(2.6)
    expect(dur).toBeLessThan(3.4)

    const cutStart = await meanLuma(res.outputPath, 0)
    const sourceAtCut = await meanLuma(rampSrc, 8)
    const sourceAtZero = await meanLuma(rampSrc, 0)
    // The first output frame is the source frame at 8s...
    expect(
      Math.abs(cutStart - sourceAtCut),
      `cut starts at ${cutStart}, source@8s is ${sourceAtCut}`
    ).toBeLessThan(8)
    // ...and emphatically not the source's own first frame.
    expect(cutStart - sourceAtZero).toBeGreaterThan(50)

    // Two seconds in, the output tracks source t=10 — the cut is a window,
    // not a single seek followed by arbitrary content.
    const cutMid = await meanLuma(res.outputPath, 2)
    const sourceAtTen = await meanLuma(rampSrc, 10)
    expect(Math.abs(cutMid - sourceAtTen)).toBeLessThan(8)
  })

  it('a cut at a different timestamp starts on different content', async () => {
    // Guards the degenerate pass where every cut starts at 0: this output
    // must differ from the 8s cut by the ramp's own arithmetic.
    const clip = makeClip({ name: 'cut-at-2', startSec: 2, endSec: 4 })
    const res = await runExportJob(
      makeJob(rampSrc, 'youtube', clip, 'cut-at-2'),
      () => {}
    )
    const cutStart = await meanLuma(res.outputPath, 0)
    const sourceAtTwo = await meanLuma(rampSrc, 2)
    const sourceAtEight = await meanLuma(rampSrc, 8)
    expect(Math.abs(cutStart - sourceAtTwo)).toBeLessThan(8)
    expect(sourceAtEight - cutStart).toBeGreaterThan(50)
  })

  it('findHighlights finds the burst the fixture actually contains', async () => {
    // T-09, the flip of the round-21 KNOWN BUG pin. Until framelog=info,
    // the scan asked ebur128 for `framelog=quiet` and then parsed the
    // per-frame "t: … M: …" lines that setting suppresses: parseEbur128 saw
    // zero samples, the `samples.length < 5` early-out fired, and every VOD
    // ever scanned returned []. The old pin asserted exactly that empty
    // array, so this test IS the regression test — it cannot pass on the
    // pre-fix command.
    //
    // The fixture's audio is a quiet 440 Hz bed with one 1.5 s full-scale
    // burst at 10.0-11.5 s, so a working scan has to (a) return something,
    // (b) put it over the burst, and (c) not simply flag the whole file.
    const candidates = await findHighlights('highlights-scan', rampSrc, () => {})
    expect(candidates.length, 'a scan of a file with an obvious burst is not empty')
      .toBeGreaterThan(0)

    // Candidates are padded ±5 s around the detected peak, so the burst
    // window must sit inside one of them.
    const hit = candidates.find((c) => c.startSec <= 10 && c.endSec >= 11.5)
    expect(
      hit,
      `no candidate covers the 10.0-11.5s burst: ${JSON.stringify(candidates)}`
    ).toBeTruthy()
    // Its measured peak is the burst's real loudness, not the -70 floor or
    // the ~-55 LUFS bed either side of it.
    expect(hit?.peakDb).toBeGreaterThan(-35)
    expect(hit?.peakDb).toBeLessThan(0)
    // And it is a detection, not a shrug that returns the whole 20 s source:
    // the padding alone cannot reach past 16.9 s.
    expect(hit?.startSec).toBeGreaterThan(1)
    expect(hit?.endSec).toBeLessThan(19)

    const loud = await momentaryLoudness(rampSrc, 10, 1.5)
    const quiet = await momentaryLoudness(rampSrc, 2, 1.5)
    expect(loud.length, 'framelog=info yields parseable frames').toBeGreaterThan(4)
    expect(quiet.length).toBeGreaterThan(4)
    const loudPeak = Math.max(...loud)
    const quietPeak = Math.max(...quiet)
    expect(
      loudPeak - quietPeak,
      `burst ${loudPeak} LUFS vs bed ${quietPeak} LUFS is a detectable highlight`
    ).toBeGreaterThan(20)
  }, 120_000)

  it('analyzeClipHook tells a loud window from a quiet one', async () => {
    // T-10, the flip of the second round-21 pin. Same root cause as T-09 in
    // the per-clip pass: `ebur128=metadata=1:peak=true` left framelog at a
    // default ffmpeg demotes below stderr once metadata is on, no "M:" line
    // ever arrived, and the parser's -70 LUFS floor became the score for
    // every clip in the app. The old pin asserted both windows read exactly
    // -70, so nothing below can pass on the pre-fix command.
    const loudWindow = await analyzeClipHook(rampSrc, 10, 1.5)
    const quietWindow = await analyzeClipHook(rampSrc, 2, 1.5)

    // Neither window is the parser's give-up value...
    expect(loudWindow.audioEnergyDb).not.toBe(-70)
    expect(quietWindow.audioEnergyDb).not.toBe(-70)
    // ...both are plausible momentary-loudness readings...
    expect(loudWindow.audioEnergyDb).toBeGreaterThan(-30)
    expect(loudWindow.audioEnergyDb).toBeLessThan(0)
    expect(quietWindow.audioEnergyDb).toBeGreaterThan(-70)
    expect(quietWindow.audioEnergyDb).toBeLessThan(-40)
    // ...and the hook indicator can actually tell them apart. The fixture's
    // burst-to-bed gap is ~34 LU; 20 leaves room for encoder variance while
    // still being far more than any parser artefact could produce.
    expect(
      loudWindow.audioEnergyDb - quietWindow.audioEnergyDb,
      `loud ${loudWindow.audioEnergyDb} vs quiet ${quietWindow.audioEnergyDb} LUFS`
    ).toBeGreaterThan(20)
  })

  it('analyzeClipHook rejects a window longer than its 30s cap', async () => {
    await expect(analyzeClipHook(rampSrc, 0, 31)).rejects.toThrow(
      /^Assertion failed: durationSec must be in \(0, 30\]$/
    )
  })

  it('analyzeClipHook rejects a zero-length window', async () => {
    await expect(analyzeClipHook(rampSrc, 0, 0)).rejects.toThrow(
      /^Assertion failed: durationSec must be in \(0, 30\]$/
    )
  })

  it('analyzeClipHook rejects a negative start time', async () => {
    await expect(analyzeClipHook(rampSrc, -1, 3)).rejects.toThrow(
      /^Assertion failed: startSec must be finite >= 0$/
    )
  })

  it('analyzeClipHook rejects an empty source path', async () => {
    await expect(analyzeClipHook('', 0, 3)).rejects.toThrow(
      /^Assertion failed: sourcePath required$/
    )
  })
})

// ---------------------------------------------------------------------------
// T-05 — caption burn-in
// ---------------------------------------------------------------------------

describe('caption burn-in (real ffmpeg)', () => {
  // Burn-in is ffmpeg-only — no whisper.exe, no model — so it runs
  // everywhere the rest of this suite runs. Subtitle *path* escaping is
  // already covered above; what was never proven is that runBurnIn's
  // filter (escaped path + force_style from buildForceStyle) actually
  // paints pixels.
  //
  // The control is another runBurnIn through the identical pipeline whose
  // only cue sits a minute past the end of the render. Comparing against
  // that instead of a hand-built no-filter encode isolates the rendered
  // text: both files went through runBurnIn's own command and encoder
  // settings, so any difference is the caption itself rather than drift
  // from a different command. (Since T-81 a window with no cue in it burns
  // with no subtitle stage at all — ffmpeg cannot open a cue-less SRT — so
  // the control no longer passes through libass; the tests below pass
  // against it with their thresholds unchanged.)
  const CAPTION_BAND = 'crop=1920:200:0:860'
  const TOP_BAND = 'crop=1920:200:0:0'
  let captionedSrt = ''
  let controlSrt = ''
  let controlOut = ''

  beforeAll(async () => {
    captionedSrt = path.join(workDir, 'two-line.srt')
    await writeFile(
      captionedSrt,
      '1\n00:00:00,200 --> 00:00:01,500\nFIRST LINE OF CAPTION\n\n' +
        '2\n00:00:01,600 --> 00:00:02,900\nSECOND LINE OF CAPTION\n',
      'utf8'
    )
    controlSrt = path.join(workDir, 'control.srt')
    await writeFile(
      controlSrt,
      '1\n00:01:00,000 --> 00:01:02,000\nNEVER VISIBLE IN THIS RANGE\n',
      'utf8'
    )
    controlOut = path.join(workDir, 'burnin-control.mp4')
    await runBurnIn(
      {
        jobId: 'burnin-control',
        videoPath: landscapeSrc,
        srtPath: controlSrt,
        outputPath: controlOut,
        fontSizePct: 4,
        startSec: 0,
        endSec: 3
      },
      () => {}
    )
  }, 120_000)

  it('burns a 2-line SRT into the caption band and leaves the rest of the frame alone', async () => {
    const outputPath = path.join(workDir, 'burnin-bottom.mp4')
    const phases: string[] = []
    const res = await runBurnIn(
      {
        jobId: 'burnin-bottom',
        videoPath: landscapeSrc,
        srtPath: captionedSrt,
        outputPath,
        fontSizePct: 4,
        startSec: 0,
        endSec: 3
      },
      (p) => phases.push(p.phase)
    )
    expect(res.outputPath).toBe(outputPath)
    // T-89: cues in range, so the file is captioned (the band-diff below is
    // the bytes this flag has to agree with).
    expect(res.captioned).toBe(true)
    expect(phases[0]).toBe('burning-in')
    expect(phases[phases.length - 1]).toBe('done')

    const info = await ffprobeJson(outputPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    expect(v?.codec_name).toBe('h264')
    expect(v?.width).toBe(1920)
    expect(v?.height).toBe(1080)
    // -c:a copy: the source's aac track rides along untouched.
    expect(a?.codec_name).toBe('aac')
    const dur = Number(info.format.duration)
    expect(dur).toBeGreaterThan(2.7)
    expect(dur).toBeLessThan(3.3)
    await assertFaststart(outputPath)

    // The caption band genuinely differs from the control...
    const bandPsnr = await regionPsnr(outputPath, controlOut, CAPTION_BAND)
    expect(bandPsnr, `caption band PSNR ${bandPsnr} dB vs control`).toBeLessThan(30)
    // ...and the difference is the text, not global re-encode drift: the
    // top of the frame stays effectively identical.
    const topPsnr = await regionPsnr(outputPath, controlOut, TOP_BAND)
    expect(topPsnr, `untouched top band PSNR ${topPsnr} dB`).toBeGreaterThan(40)
    expect(topPsnr - bandPsnr).toBeGreaterThan(15)
  }, 120_000)

  it('renders every caption position centred in the third it names', async () => {
    // T-11, the flip of the round-21 KNOWN BUG pin. buildForceStyle used to
    // emit ASS numpad alignments (top=8, middle=5, bottom=2), but libass's
    // force_style path writes the number straight into its INTERNAL
    // representation — HALIGN_LEFT/CENTRE/RIGHT = 1/2/3 OR-ed with
    // VALIGN_SUB/TOP/CENTER = 0/4/8 — skipping the numpad conversion its
    // v4+ style parser applies. So 8 became left+middle and 5 became
    // left+top: both non-default positions landed on the wrong third AND
    // lost their centring, while bottom (2 -> centre+bottom) was right by
    // coincidence. The pin asserted those wrong bands; the bands below are
    // the mirror image, so this test cannot pass on the old values.
    //
    // Technique unchanged from the pin: PSNR of a region against the control
    // render (identical pipeline, cue pushed a minute past the range), so a
    // low number means "text is painted here" and a high one means
    // "untouched".
    //
    // Geometry, measured rather than assumed: libass scales force_style's
    // FontSize by PlayResY (288 by default), so a nominal 24 renders ~90 px
    // tall on this 1080p source and the caption occupies ~70 rows. Each
    // position therefore lands wholly inside a 360-row third — top at rows
    // 160-230, middle at 505-575, bottom at 849-920 — which is what makes
    // "in the right third" a clean assertion. The clean-band floor is 35 dB,
    // not 40: an untouched third measures ~40-56 dB against the control
    // because re-encoding a frame with different text elsewhere shifts
    // x264's rate decisions slightly. The painted third sits at ~18 dB, so
    // the two populations are 20+ dB apart; the separation is asserted too.
    const bands = {
      top: 'crop=1920:360:0:0',
      middle: 'crop=1920:360:0:360',
      bottom: 'crop=1920:360:0:720'
    }
    const bandY = { top: 0, middle: 360, bottom: 720 }
    const POSITIONS = ['top', 'middle', 'bottom'] as const

    for (const position of POSITIONS) {
      const outputPath = path.join(workDir, `burnin-position-${position}.mp4`)
      await runBurnIn(
        {
          jobId: `burnin-position-${position}`,
          videoPath: landscapeSrc,
          srtPath: captionedSrt,
          outputPath,
          fontSizePct: 4,
          style: { fontSize: 24, position, primaryColor: '#ffffff', outlineColor: '#000000' },
          startSec: 0,
          endSec: 3
        },
        () => {}
      )

      // The third it names carries the text...
      const own = await regionPsnr(outputPath, controlOut, bands[position])
      expect(own, `position "${position}" paints its own third (${own} dB)`).toBeLessThan(30)
      // ...and the other two are untouched.
      for (const other of POSITIONS.filter((p) => p !== position)) {
        const psnr = await regionPsnr(outputPath, controlOut, bands[other])
        expect(
          psnr,
          `position "${position}" leaves the ${other} third clean (${psnr} dB)`
        ).toBeGreaterThan(35)
        expect(
          psnr - own,
          `position "${position}": ${other} third is clearly cleaner than its own`
        ).toBeGreaterThan(15)
      }

      // Horizontal centring, read inside the third it does paint. The
      // caption is wider than a third of the frame, so "centred" is proven
      // by symmetry rather than by empty margins — and symmetry does not
      // depend on the substituted font's metrics. The old left-aligned
      // values put ~20 dB between these two.
      const y = bandY[position]
      const centre = await regionPsnr(outputPath, controlOut, `crop=640:360:640:${y}`)
      const left = await regionPsnr(outputPath, controlOut, `crop=640:360:0:${y}`)
      const right = await regionPsnr(outputPath, controlOut, `crop=640:360:1280:${y}`)
      expect(centre, `position "${position}" paints the centre column (${centre} dB)`).toBeLessThan(30)
      expect(
        Math.abs(left - right),
        `position "${position}" is centred: left ${left} dB vs right ${right} dB`
      ).toBeLessThan(8)
    }
  }, 240_000)

  // -------------------------------------------------------------------------
  // T-81 — a ranged burn has to caption the span it burns
  // -------------------------------------------------------------------------
  //
  // Every test above burns from startSec 0, where a source-absolute cue time
  // and a clip-relative one are the same number — the exact blind spot that
  // hid T-74's overlay window. runBurnIn seeks with `-ss` BEFORE `-i`, so the
  // clip's first frame reaches `subtitles=` at t=0; Whisper's cues are
  // source-absolute. Handed the whole-source SRT, a clip cut at 2 -> 5 showed
  // the words from the first seconds of the source and none of its own.
  //
  // Fixture: the flat-gray source, because an untouched region re-encodes
  // bit-identically there (min == max), which makes "is a caption painted at
  // this instant" an exact read of the luma spread in the caption band
  // instead of a PSNR guess. Cue times below are SOURCE time; the output
  // times they should land at are in the comments.
  const CLIP_START = 2
  const CLIP_END = 5
  const PAINTED_SPREAD = 100

  async function captionSpread(file: string, atSec: number): Promise<number> {
    const { min, max } = await regionLuma(file, atSec, CAPTION_BAND)
    return max - min
  }

  /** Files that sit beside `srt` and start with its name: a leaked temp SRT. */
  async function srtSiblings(srt: string): Promise<string[]> {
    const own = path.basename(srt)
    return (await readdir(path.dirname(srt))).filter((f) => f.startsWith(own) && f !== own)
  }

  it('a ranged burn shows the cues of the burned span, on the clip clock (T-81)', async () => {
    const srt = path.join(workDir, 'range-two-cues.srt')
    await writeFile(
      srt,
      // B: before the clip. Unshifted, its window covers OUTPUT 0.2 -> 1.0.
      '1\n00:00:00,200 --> 00:00:01,000\nCUE BEFORE THE CLIP\n\n' +
        // A: inside the clip. Correct output window 1.2 -> 2.4; unshifted it
        // opens at 3.2, after the 3 s clip is over, so it never shows at all.
        '2\n00:00:03,200 --> 00:00:04,400\nCUE INSIDE THE CLIP\n',
      'utf8'
    )
    const outputPath = path.join(workDir, 'burnin-range.mp4')
    const burned = await runBurnIn(
      {
        jobId: 'burnin-range',
        videoPath: flatGraySrc,
        srtPath: srt,
        outputPath,
        fontSizePct: 4,
        startSec: CLIP_START,
        endSec: CLIP_END
      },
      () => {}
    )

    // T-89: cue A lands in the range, so the result says captioned — and the
    // luma reads below are what that claim has to be true of.
    expect(burned.captioned).toBe(true)

    const info = await ffprobeJson(outputPath)
    expect(Number(info.format.duration)).toBeGreaterThan(2.7)
    expect(Number(info.format.duration)).toBeLessThan(3.3)

    // Cue A's own window: painted.
    const inside = await captionSpread(outputPath, 1.8)
    expect(inside, `caption spread at output 1.8 s (cue A, source 3.8 s): ${inside}`).toBeGreaterThan(
      PAINTED_SPREAD
    )
    // Where only the unshifted cue B is active: nothing. This is the frame
    // the bug paints a caption onto.
    const early = await captionSpread(outputPath, 0.6)
    expect(early, `caption spread at output 0.6 s (no cue in range): ${early}`).toBe(0)
    // After A has ended: nothing.
    const late = await captionSpread(outputPath, 2.7)
    expect(late, `caption spread at output 2.7 s (past cue A): ${late}`).toBe(0)

    // The shifted copy was a means, not an output.
    expect(await srtSiblings(srt)).toEqual([])
  }, 120_000)

  it('cues straddling either edge of the range keep their visible half (T-81)', async () => {
    const srt = path.join(workDir, 'range-edge-cues.srt')
    await writeFile(
      srt,
      // C opens before the clip: visible OUTPUT 0 -> 0.6 (an SRT cannot say
      // "starts at -0.5 s", so the shifter has to clamp to 0, and libass has
      // to accept the 00:00:00,000 it writes).
      '1\n00:00:01,500 --> 00:00:02,600\nCUE OPENING BEFORE\n\n' +
        // D runs past the clip's end: visible OUTPUT 2.6 -> 3.0.
        '2\n00:00:04,600 --> 00:00:05,800\nCUE RUNNING PAST\n',
      'utf8'
    )
    const outputPath = path.join(workDir, 'burnin-range-edges.mp4')
    await runBurnIn(
      {
        jobId: 'burnin-range-edges',
        videoPath: flatGraySrc,
        srtPath: srt,
        outputPath,
        fontSizePct: 4,
        startSec: CLIP_START,
        endSec: CLIP_END
      },
      () => {}
    )
    expect(await captionSpread(outputPath, 0.3), 'C at the clip open').toBeGreaterThan(PAINTED_SPREAD)
    // Unshifted, C's window (output 1.5 -> 2.6) is what covers this frame.
    expect(await captionSpread(outputPath, 2.0), 'between C and D').toBe(0)
    expect(await captionSpread(outputPath, 2.8), 'D at the clip close').toBeGreaterThan(PAINTED_SPREAD)
    expect(await srtSiblings(srt)).toEqual([])
  }, 120_000)

  it('a range with no cue inside it still yields the clip, uncaptioned (T-81)', async () => {
    // ffmpeg cannot open a cue-less SRT ("Unable to open"), and after the
    // shift a window nobody speaks in IS cue-less. It must burn as the clip
    // with nothing painted rather than fail, or the control render the tests
    // above lean on (a cue a minute past the end) would be unmakeable.
    const srt = path.join(workDir, 'range-no-cues.srt')
    await writeFile(srt, '1\n00:00:00,200 --> 00:00:01,000\nONLY BEFORE THE CLIP\n', 'utf8')
    const outputPath = path.join(workDir, 'burnin-range-none.mp4')
    const burned = await runBurnIn(
      {
        jobId: 'burnin-range-none',
        videoPath: flatGraySrc,
        srtPath: srt,
        outputPath,
        fontSizePct: 4,
        startSec: CLIP_START,
        endSec: CLIP_END
      },
      () => {}
    )
    const info = await ffprobeJson(outputPath)
    expect(Number(info.format.duration)).toBeGreaterThan(2.7)
    expect(Number(info.format.duration)).toBeLessThan(3.3)
    // Unshifted, cue B's window (output 0.2 -> 1.0) is what would paint here.
    for (const t of [0.6, 1.5, 2.5]) {
      expect(await captionSpread(outputPath, t), `no caption at output ${t} s`).toBe(0)
    }
    // T-89: and the result SAYS so — the renderer's "No captions in this range"
    // toast is this flag, and it is only honest because the pixels above agree
    // with it (nothing painted at any of the three instants).
    expect(burned.captioned).toBe(false)
    expect(await srtSiblings(srt)).toEqual([])
  })

  it('a burn that fails inside ffmpeg still removes its shifted SRT (T-81)', async () => {
    const srt = path.join(workDir, 'range-failing-burn.srt')
    await writeFile(srt, '1\n00:00:03,200 --> 00:00:04,400\nCUE INSIDE THE CLIP\n', 'utf8')
    const outputPath = path.join(workDir, 'burnin-range-fail.mp4')
    await expect(
      runBurnIn(
        {
          jobId: 'burnin-range-fail',
          videoPath: path.join(workDir, 'no-such-video.mp4'),
          srtPath: srt,
          outputPath,
          fontSizePct: 4,
          startSec: CLIP_START,
          endSec: CLIP_END
        },
        () => {}
      )
    ).rejects.toThrow(/^burn-in exit \d+: /)
    expect(await srtSiblings(srt)).toEqual([])
  })

  it('rejects a missing SRT with the burn-in runner error', async () => {
    // Unranged on purpose: this is the path where ffmpeg itself opens the
    // SRT, so it is the one that pins the runner's own error shape. A ranged
    // burn has to READ the SRT first (T-81) — the test after this one.
    const outputPath = path.join(workDir, 'burnin-missing.mp4')
    await expect(
      runBurnIn(
        {
          jobId: 'burnin-missing',
          videoPath: landscapeSrc,
          srtPath: path.join(workDir, 'no-such-file.srt'),
          outputPath,
          fontSizePct: 4
        },
        () => {}
      )
    ).rejects.toThrow(/^burn-in exit \d+: .*Unable to open .*no-such-file\.srt/s)
    expect(existsSync(outputPath)).toBe(false)
  })

  it('a ranged burn with a missing SRT fails on the read, before any ffmpeg (T-81)', async () => {
    const outputPath = path.join(workDir, 'burnin-missing-ranged.mp4')
    await expect(
      runBurnIn(
        {
          jobId: 'burnin-missing-ranged',
          videoPath: landscapeSrc,
          srtPath: path.join(workDir, 'no-such-file.srt'),
          outputPath,
          fontSizePct: 4,
          startSec: 0,
          endSec: 1
        },
        () => {}
      )
    ).rejects.toThrow(/^ENOENT: no such file or directory, open .*no-such-file\.srt/)
    expect(existsSync(outputPath)).toBe(false)
  })
})

/**
 * T-106 — an export never replaces a file that is already there.
 *
 * Every runner that writes into the folder the user chose named its output from
 * its settings and passed `-y`: `<source>_<w>px_<fps>fps.gif`,
 * `<source>_compilation.mp4`, the template's name for a platform export,
 * `<source>_reframe-...mp4`. The next job with the same settings silently
 * replaced the last — a second GIF of a different part of the clip, a second
 * compilation after a re-order, a Clip 1 renamed back to what an earlier clip was
 * called — and, because T-100 removes the file a CANCELED job was writing, a
 * Cancel on that second job deleted the first job's finished export as well.
 *
 * Each case below runs the same job three times with DIFFERENT content (a
 * different part of the ramp fixture, so a file that was rewritten differs from
 * the one that was there) under the same name, and asks four things of the
 * folder: three runs make three files, they are named `name.ext`,
 * `name (2).ext`, `name (3).ext`, each earlier file is byte for byte what it was
 * after every later run, and each is real media.
 */
/**
 * T-111 — burned caption size follows the 16:9 picture a frame's WIDTH would make.
 *
 * libass draws a `force_style` FontSize at frame HEIGHT / PlayResY (288) pixels per
 * unit, so the same size setting drew text 1.78x as large, in proportion to the
 * frame, on a 1080x1920 clip as on a 1920x1080 one: measured on a real render, the
 * default 32 wrapped a 38-character caption into an 845 px block — 44% of the
 * frame. `runBurnIn` now probes its video and, for a frame narrower than 16:9,
 * hands libass a PlayResY (and a MarginV in step with it) that brings the scale to
 * `width * 9/16 / 288`. Landscape is the command it always was.
 *
 * The invariant is read off real frames: the white of the glyphs (luma over 200 on
 * a mid-gray frame; the outline is black and the background 128) is boxed, and the
 * box's height as a fraction of the frame's WIDTH has to be one number across
 * shapes, whichever font the platform substitutes for Arial. A one-line caption
 * that fits well inside the narrowest frame, so a wrap cannot confuse the reading.
 */
describe('burned caption size follows the frame (real ffmpeg, T-111)', () => {
  const CUE = 'Hg caption test'
  let cueSrt = ''
  const shapes: Array<{ name: string; w: number; h: number; src: string }> = []

  /** Bounding box of the glyphs' white at `t`, over the whole frame. */
  async function glyphBox(
    file: string,
    t: number,
    w: number,
    h: number
  ): Promise<{ boxH: number; boxW: number; bottom: number }> {
    const buf = await samplePixels(file, t, 'null', 'gray')
    expect(buf.length, 'the whole frame was decoded').toBe(w * h)
    let minX = w
    let maxX = -1
    let minY = h
    let maxY = -1
    for (let i = 0; i < buf.length; i++) {
      if ((buf[i] ?? 0) <= 200) continue
      const x = i % w
      const y = (i - x) / w
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    expect(maxX, 'the caption painted white glyphs').toBeGreaterThan(-1)
    return { boxH: maxY - minY + 1, boxW: maxX - minX + 1, bottom: maxY }
  }

  async function burnShape(shape: { name: string; src: string }, extra: Record<string, unknown> = {}): Promise<string> {
    const outputPath = path.join(workDir, `t111-burn-${shape.name}.mp4`)
    await runBurnIn(
      {
        jobId: `t111-burn-${shape.name}`,
        videoPath: shape.src,
        srtPath: cueSrt,
        outputPath,
        fontSizePct: 3.2,
        startSec: 0,
        endSec: 3,
        ...extra
      },
      () => {}
    )
    return outputPath
  }

  beforeAll(async () => {
    cueSrt = path.join(workDir, 't111-cue.srt')
    await writeFile(cueSrt, `1\n00:00:00,200 --> 00:00:02,900\n${CUE}\n`, 'utf8')
    shapes.push({ name: 'landscape', w: 1920, h: 1080, src: flatGraySrc })
    for (const [name, w, h] of [
      ['vertical', 1080, 1920],
      ['square', 1080, 1080],
      ['four-five', 1080, 1350]
    ] as const) {
      const src = path.join(workDir, `t111-flat-${name}.mp4`)
      await ff(['-y', '-f', 'lavfi', '-i', `color=c=0x808080:s=${w}x${h}:d=4:r=30`, '-pix_fmt', 'yuv420p', src])
      shapes.push({ name, w, h, src })
    }
  }, 120_000)

  it('the same size setting draws the same glyph height as a fraction of the frame\'s WIDTH on every shape', async () => {
    const measured: Record<string, { boxH: number; boxW: number; bottom: number; h: number; w: number }> = {}
    for (const shape of shapes) {
      const out = await burnShape(shape)
      const g = await glyphBox(out, 1.0, shape.w, shape.h)
      measured[shape.name] = { ...g, h: shape.h, w: shape.w }
    }
    const land = measured['landscape']
    if (!land) throw new Error('no landscape measurement')
    const landFrac = land.boxH / land.w
    for (const shape of shapes.filter((s) => s.name !== 'landscape')) {
      const m = measured[shape.name]
      if (!m) throw new Error(`no measurement for ${shape.name}`)
      const frac = m.boxH / m.w
      expect(
        frac / landFrac,
        `${shape.name} (${shape.w}x${shape.h}): glyph box ${m.boxH} px = ${(frac * 100).toFixed(2)}% of its width; landscape ${land.boxH} px = ${(landFrac * 100).toFixed(2)}% of its`
      ).toBeGreaterThan(0.9)
      expect(frac / landFrac).toBeLessThan(1.1)
    }
  }, 240_000)

  it('the default-size caption on a vertical clip is one line of sensible height, not the 44%-of-the-frame block it was', async () => {
    const vertical = shapes.find((s) => s.name === 'vertical')
    if (!vertical) throw new Error('no vertical fixture')
    const g = await glyphBox(await burnShape(vertical), 1.0, vertical.w, vertical.h)
    // Measured before the fix: a block 845 px tall (44% of 1920) for a 38-character
    // caption; this one is 15 characters and a single line either way, at ~3% of the height.
    expect(g.boxH / vertical.h, `glyph box ${g.boxH} px of ${vertical.h}`).toBeLessThan(0.07)
    expect(g.boxW / vertical.w, 'and it fits on one line').toBeLessThan(0.9)
  }, 120_000)

  it('the caption sits as far up a vertical frame as it does a landscape one (the margin follows the size)', async () => {
    const land = shapes.find((s) => s.name === 'landscape')
    const vertical = shapes.find((s) => s.name === 'vertical')
    if (!land || !vertical) throw new Error('missing fixtures')
    const l = await glyphBox(await burnShape(land), 1.0, land.w, land.h)
    const v = await glyphBox(await burnShape(vertical), 1.0, vertical.w, vertical.h)
    // Bottom of the glyphs as a fraction of the frame's height: ~0.87 on both. With the
    // margin left at 40 script units on the rescaled script it was 0.96 on vertical.
    expect(Math.abs(l.bottom / land.h - v.bottom / vertical.h)).toBeLessThan(0.03)
  }, 120_000)

  it('a bigger Size is bigger on a vertical clip too: the setting still means something', async () => {
    const vertical = shapes.find((s) => s.name === 'vertical')
    if (!vertical) throw new Error('no vertical fixture')
    const small = await glyphBox(await burnShape(vertical, { style: { ...DEFAULT_CAPTION_STYLE, fontSize: 24 } }), 1.0, vertical.w, vertical.h)
    const big = await glyphBox(await burnShape(vertical, { style: { ...DEFAULT_CAPTION_STYLE, fontSize: 48 } }), 1.0, vertical.w, vertical.h)
    // 48 / 24 = 2x, within what whole-pixel glyph boxes and the outline allow.
    expect(big.boxH / small.boxH).toBeGreaterThan(1.7)
    expect(big.boxH / small.boxH).toBeLessThan(2.3)
  }, 240_000)

  it('the burn\'s bar measures the file it writes: its last report is near the end, never the invented 5 + 0.5/s', async () => {
    // flatGraySrc is 6 s long. `-progress`' last block reports the full output length, so
    // the bar's last number before done is ~99 on both a whole-file and a ranged burn. The
    // old formula said 5 + 0.5 x 6 = 8 and 5 + 0.5 x 3 = 6.5.
    const reports = async (extra: Record<string, unknown>): Promise<number[]> => {
      const seen: number[] = []
      await runBurnIn(
        {
          jobId: `t111-bar-${seen.length}-${Object.keys(extra).length}`,
          videoPath: flatGraySrc,
          srtPath: cueSrt,
          outputPath: path.join(workDir, `t111-bar-${Object.keys(extra).length}.mp4`),
          fontSizePct: 3.2,
          ...extra
        },
        (p) => {
          if (p.phase === 'burning-in' && p.percent !== undefined) seen.push(p.percent)
        }
      )
      return seen
    }
    for (const extra of [{}, { startSec: 1, endSec: 4 }]) {
      const seen = await reports(extra)
      const label = JSON.stringify(extra)
      expect(seen[0], `${label}: starts at 0`).toBe(0)
      expect(Math.max(...seen), `${label}: reaches the end of the output (${seen.join(', ')})`).toBeGreaterThanOrEqual(90)
      expect(Math.max(...seen), `${label}: but never 100 until done`).toBeLessThanOrEqual(99)
      for (let i = 1; i < seen.length; i++) {
        expect(seen[i] ?? 0, `${label}: only ever moves forward`).toBeGreaterThanOrEqual(seen[i - 1] ?? 0)
      }
    }
  }, 240_000)
})

describe('an output folder that is gone is made again before anything is encoded (real ffmpeg, T-125 (10))', () => {
  // A remembered output folder is a path the person chose last week. Deleted, renamed or on a drive that is not plugged in, it is
  // still a well-formed path, and every runner handed it to ffmpeg, which could not open its output: "A file imagii needs isn't
  // there" - after a Compile had burned its whole segment encode. Each runner makes the folder (parents too) before it names or
  // encodes anything; a folder that cannot be made is refused in a sentence that names it.
  const gone = (...parts: string[]): string => path.join(workDir, 't125-gone', ...parts)
  const clip = (): Clip => makeClip({ startSec: 0, endSec: 1 })

  it('the platform export writes into a folder that does not exist yet', async () => {
    const outDir = gone('export', 'deep')
    const res = await runExportJob({ jobId: 't125-gone-export', sourcePath: landscapeSrc, outDir, clip: clip(), preset: 'youtube' }, () => {})
    expect(path.dirname(res.outputPath)).toBe(outDir)
    expect(existsSync(res.outputPath)).toBe(true)
  }, 120_000)

  it('the GIF, the reframe, the compilation and the picture-in-picture do too', async () => {
    const gifDir = gone('gif')
    const gif = await runGifExport({ jobId: 't125-gone-gif', sourcePath: landscapeSrc, outDir: gifDir, startSec: 0, endSec: 1, width: 160, fps: 10, speed: 1 })
    expect(path.dirname(gif.outputPath)).toBe(gifDir)
    expect(existsSync(gif.outputPath)).toBe(true)

    const reframeDir = gone('reframe')
    const reframed = await runReframe(
      { jobId: 't125-gone-reframe', sourcePath: landscapeSrc, outputPath: path.join(reframeDir, 'out.mp4'), position: 'center', startSec: 0, endSec: 1, outputWidth: 1080, outputHeight: 1920 },
      () => {}
    )
    expect(path.dirname(reframed.outputPath)).toBe(reframeDir)
    expect(existsSync(reframed.outputPath)).toBe(true)

    const compileDir = gone('compile')
    const compiled = await runConcat({
      jobId: 't125-gone-compile', sourcePath: landscapeSrc, outDir: compileDir,
      segments: [{ startSec: 0, endSec: 1, name: 'a' }, { startSec: 2, endSec: 3, name: 'b' }], fadeMs: 0, width: 640, height: 360
    })
    expect(path.dirname(compiled.outputPath)).toBe(compileDir)
    expect(existsSync(compiled.outputPath)).toBe(true)

    const pipDir = gone('pip')
    const pip = await runPipComposite('t125-gone-pip', landscapeSrc, pipOverlaySrc, path.join(pipDir, 'out_pip.mp4'), { overlayWidth: 240, position: 'top-left', margin: 10 })
    expect(path.dirname(pip.outputPath)).toBe(pipDir)
    expect(existsSync(pip.outputPath)).toBe(true)
  }, 240_000)

  it('a folder that cannot be made is refused in a sentence that names it, by every runner, and nothing is written', async () => {
    // A FILE where a parent should be: mkdir fails the way an unplugged drive's path does.
    const blocker = gone('blocker.txt')
    await mkdir(path.dirname(blocker), { recursive: true })
    await writeFile(blocker, 'a file, not a folder')
    const outDir = path.join(blocker, 'Clips')
    const sentence = outputFolderRefusal('Clips')
    const refused = async (work: () => Promise<unknown>): Promise<string> =>
      work().then(() => 'it ran', (e: Error) => e.message)

    expect(await refused(() => runExportJob({ jobId: 't125-nf-export', sourcePath: landscapeSrc, outDir, clip: clip(), preset: 'youtube' }, () => {}))).toBe(sentence)
    expect(await refused(() => runGifExport({ jobId: 't125-nf-gif', sourcePath: landscapeSrc, outDir, startSec: 0, endSec: 1, width: 160, fps: 10, speed: 1 }))).toBe(sentence)
    expect(
      await refused(() =>
        runReframe({ jobId: 't125-nf-reframe', sourcePath: landscapeSrc, outputPath: path.join(outDir, 'out.mp4'), position: 'center', startSec: 0, endSec: 1, outputWidth: 1080, outputHeight: 1920 }, () => {})
      )
    ).toBe(sentence)
    expect(
      await refused(() =>
        runConcat({ jobId: 't125-nf-compile', sourcePath: landscapeSrc, outDir, segments: [{ startSec: 0, endSec: 1, name: 'a' }], fadeMs: 0, width: 640, height: 360 })
      )
    ).toBe(sentence)
    expect(await refused(() => runPipComposite('t125-nf-pip', landscapeSrc, pipOverlaySrc, path.join(outDir, 'out_pip.mp4'), { overlayWidth: 240, position: 'top-left', margin: 10 }))).toBe(sentence)
    expect(sentence).toContain('"Clips"')
    expect(existsSync(outDir)).toBe(false)
  }, 240_000)
})

describe('an export never replaces a file that is already there (real ffmpeg, T-106)', () => {
  let dir = ''
  const base = (p: string): string => path.basename(p)

  beforeAll(async () => {
    dir = await mkdtemp(path.join(workDir, 't106-'))
  })

  async function assertThreeRunsThreeFiles(
    label: string,
    stem: string,
    ext: string,
    run: (n: number) => Promise<string>
  ): Promise<string[]> {
    const paths: string[] = []
    const shas: string[] = []
    for (let n = 1; n <= 3; n++) {
      paths.push(await run(n))
      shas.push(await fileSha(paths[n - 1] ?? ''))
      for (let i = 0; i < n - 1; i++) {
        expect(
          await fileSha(paths[i] ?? ''),
          `${label}: ${base(paths[i] ?? '')} is what run ${i + 1} wrote, after run ${n}`
        ).toBe(shas[i])
      }
    }
    expect(new Set(shas).size, `${label}: the three runs really wrote three different files`).toBe(3)
    expect(paths.map(base), `${label}: the names`).toEqual([
      `${stem}${ext}`,
      `${stem} (2)${ext}`,
      `${stem} (3)${ext}`
    ])
    for (const file of paths) {
      expect(path.dirname(file)).toBe(dir)
      const v = (await ffprobeJson(file)).streams.find((s) => s.codec_type === 'video')
      expect(v, `${label}: ${base(file)} is real media`).toBeDefined()
    }
    return paths
  }

  it('GIF: the same settings three times write three GIFs', async () => {
    await assertThreeRunsThreeFiles('gif', 'ramp_160px_10fps', '.gif', async (n) => {
      const res = await runGifExport({
        jobId: `t106-gif-${n}`,
        sourcePath: rampSrc,
        outDir: dir,
        startSec: 2 * n,
        endSec: 2 * n + 1,
        width: 160,
        fps: 10,
        speed: 1
      })
      return res.outputPath
    })
  }, 120_000)

  it('compilation: the same source three times writes three compilations', async () => {
    await assertThreeRunsThreeFiles('compile', 'ramp_compilation', '.mp4', async (n) => {
      const res = await runConcat({
        jobId: `t106-compile-${n}`,
        sourcePath: rampSrc,
        outDir: dir,
        segments: [
          { startSec: 2 * n, endSec: 2 * n + 1, name: 'a' },
          { startSec: 2 * n + 1, endSec: 2 * n + 2, name: 'b' }
        ],
        fadeMs: 0,
        width: 640,
        height: 360
      })
      return res.outputPath
    })
  }, 180_000)

  it('platform export: the template\'s own name three times, and the default name three times', async () => {
    await assertThreeRunsThreeFiles('export (template name)', 'dup', '.mp4', async (n) => {
      const res = await runExportJob(
        {
          ...makeJob(rampSrc, 'twitter', makeClip({ startSec: 2 * n, endSec: 2 * n + 1 }), `t106-export-${n}`),
          outDir: dir,
          outputFilename: 'dup.mp4'
        },
        () => {}
      )
      return res.outputPath
    })
    await assertThreeRunsThreeFiles('export (default name)', 'ramp_test clip_twitter', '.mp4', async (n) => {
      const res = await runExportJob(
        {
          ...makeJob(rampSrc, 'twitter', makeClip({ startSec: 2 * n, endSec: 2 * n + 1 }), `t106-default-${n}`),
          outDir: dir
        },
        () => {}
      )
      return res.outputPath
    })
  }, 240_000)

  it('picture-in-picture: the same base three times writes three composites', async () => {
    await assertThreeRunsThreeFiles('pip', 'pip', '.mp4', async (n) => {
      const res = await runPipComposite(
        `t106-pip-${n}`,
        rampSrc,
        pipOverlaySrc,
        path.join(dir, 'pip.mp4'),
        { overlayWidth: 80 * (n + 1), position: 'top-left', margin: 8 }
      )
      return res.outputPath
    })
  }, 240_000)

  it('reframe: the same position and size three times write three files', async () => {
    await assertThreeRunsThreeFiles('reframe', 'reframe', '.mp4', async (n) => {
      const res = await runReframe(
        {
          jobId: `t106-reframe-${n}`,
          sourcePath: rampSrc,
          outputPath: path.join(dir, 'reframe.mp4'),
          position: 'center',
          startSec: 2 * n,
          endSec: 2 * n + 1,
          outputWidth: 360,
          outputHeight: 640
        },
        () => {}
      )
      return res.outputPath
    })
  }, 240_000)
})


/**
 * T-113 — the Clip Kit's captions sit on the speech in the kit's OWN file.
 *
 * The kit bundled a plain copy of the whole recording's SRT: cues on the SOURCE clock beside a
 * video that is one clip at its speed, starting at 0:00. The SRT main writes now is the transcript
 * shifted to the clip and divided by its speed (`shiftSrtToRange` — the very function
 * `captions:writeKitSrt` calls). This runs the REAL export the kit's own job describes (the YouTube
 * slot of `buildKitQueue`) on a source whose speech is a measurable event — rampSrc's loud 1.5 s
 * burst at 10.0-11.5 s of its source, a quiet 0.02 amplitude either side — and measures the
 * loudness of the file the kit wrote at the moment the cue says someone is speaking. A cue left
 * on the source clock starts at 10 s, beyond the end of a 3-second file.
 */
describe('the Clip Kit\'s captions are on the clock of the kit\'s own file (real ffmpeg, T-113)', () => {
  // A transcript of the 20 s recording: the burst is the one thing said, plus a cue before and after.
  const SRT =
    '1\n00:00:03,000 --> 00:00:04,000\nbefore\n\n' +
    '2\n00:00:10,000 --> 00:00:11,500\nthe burst\n\n' +
    '3\n00:00:16,000 --> 00:00:17,000\nafter\n'

  const cuesOf = (srt: string): Array<{ start: number; end: number; text: string }> =>
    srt
      .trim()
      .split(/\n\s*\n/)
      .map((block) => {
        const lines = block.split('\n')
        const [from, to] = (lines[1] as string).split('-->').map((t) => t.trim())
        return { start: tsToSeconds(from as string), end: tsToSeconds(to as string), text: lines.slice(2).join('\n') }
      })

  async function kitFile(name: string, startSec: number, endSec: number, speedMultiplier: number) {
    const kitDir = path.join(workDir, `t113-kit-${name}`)
    await mkdir(kitDir, { recursive: true })
    const clip: Clip = {
      id: `c-${name}`,
      name,
      startSec,
      endSec,
      cropRect: null,
      textOverlays: [],
      selectedPresets: ['youtube'],
      speedMultiplier
    }
    const jobs = buildKitQueue({
      source: { filePath: rampSrc, width: 640, height: 480 },
      clip,
      kitDir,
      safeName: name,
      watermark: null,
      newJobId: () => `job-t113-${name}`
    })
    const job = jobs.find((j) => j.preset === 'youtube') as ExportJobSpec
    const written = await runExportJob(job, () => {})
    return { outputPath: written.outputPath, clip }
  }

  /**
   * M loudness (dB) of the half second of the kit file starting at `from`. Measured on this
   * fixture: the burst reads about -22 dB and the quiet either side about -56 dB, so -30 and -45
   * sit well clear of both.
   */
  const loudnessAt = async (file: string, from: number): Promise<number> =>
    (await analyzeClipHook(file, Math.max(0, from), 0.5)).audioEnergyDb

  it('a mid-file clip at 2x: the cue for the burst starts where the burst IS in the kit file', async () => {
    // Source 8-14 s at 2x is a 3 s file; the burst (source 10.0-11.5) plays at 1.0-1.75 s of it.
    const { outputPath, clip } = await kitFile('mid2x', 8, 14, 2)
    const info = await ffprobeJson(outputPath)
    expect(Math.abs(Number(info.format.duration) - 3)).toBeLessThan(0.3)

    const shifted = cuesOf(shiftSrtToRange(SRT, clip.startSec, clip.endSec, 2))
    // Only the burst falls in the clip (the cues at 3-4 s and 16-17 s are outside 8-14 s).
    expect(shifted.map((c) => c.text)).toEqual(['the burst'])
    const cue = shifted[0] as { start: number; end: number }
    expect(cue.start).toBeCloseTo(1.0, 2)
    expect(cue.end).toBeCloseTo(1.75, 2)

    // The cue lands on the speech: loud where it says someone is speaking, quiet just before it.
    const during = await loudnessAt(outputPath, cue.start + 0.1)
    const before = await loudnessAt(outputPath, cue.start - 0.6)
    expect(during, `loudness during the cue (${during} dB)`).toBeGreaterThan(-30)
    expect(before, `loudness just before it (${before} dB)`).toBeLessThan(-45)
    expect(during - before).toBeGreaterThan(25)

    // The old copy put this cue at 10 s - past the end of a file that is 3 seconds long.
    const copied = cuesOf(SRT)[1] as { start: number }
    expect(copied.start).toBe(10)
    expect(copied.start).toBeGreaterThan(Number(info.format.duration))
  }, 120_000)

  it('at 1x the shift alone is right, and a slow clip stretches the cue with the picture', async () => {
    // Source 9-13 s at 0.5x is an 8 s file; the burst plays at 2.0-5.0 s of it.
    const slow = await kitFile('mid05x', 9, 13, 0.5)
    const [cue] = cuesOf(shiftSrtToRange(SRT, 9, 13, 0.5))
    expect(cue?.start).toBeCloseTo(2.0, 2)
    expect(cue?.end).toBeCloseTo(5.0, 2)
    expect(await loudnessAt(slow.outputPath, (cue?.start ?? 0) + 0.2)).toBeGreaterThan(-30)
    expect(await loudnessAt(slow.outputPath, (cue?.start ?? 0) - 0.7)).toBeLessThan(-45)
    // ...and the cue ends with the speech: quiet just after it.
    expect(await loudnessAt(slow.outputPath, (cue?.end ?? 0) + 0.2)).toBeLessThan(-45)

    // 1x: source 8-14 s is a 6 s file and the burst plays at 2.0-3.5 s.
    const plain = await kitFile('mid1x', 8, 14, 1)
    const [one] = cuesOf(shiftSrtToRange(SRT, 8, 14, 1))
    expect(one?.start).toBeCloseTo(2.0, 2)
    expect(one?.end).toBeCloseTo(3.5, 2)
    expect(await loudnessAt(plain.outputPath, (one?.start ?? 0) + 0.2)).toBeGreaterThan(-30)
    expect(await loudnessAt(plain.outputPath, (one?.start ?? 0) - 0.7)).toBeLessThan(-45)
  }, 180_000)
})

describe('an odd-sized picture through every other libx264 command (real ffmpeg, T-114)', () => {
  // T-113 evened the re-attach re-encode and left three siblings dying at exit 187 on the same
  // input (`width not divisible by 2 ... Error while opening encoder`): the MP4 convert (a
  // screen recording's webm is where an odd size comes from, and recording.ts's finally
  // unlinks the temp webm when the convert fails - the take was lost), the caption burn-in
  // (with its subtitle stage and without one), and the picture-in-picture composite (sized by
  // its base). lavfi rounds a yuv420p picture to even by itself, so the odd size is made by a
  // `scale` after the source, and ffprobe'd before it is used. The picture is FLAT gray so
  // "is a caption painted here" is a luma spread (0 untouched, > 100 text) and "is the overlay
  // here" is a pixel color.
  const ODD_W = 321
  const ODD_H = 241
  const SECONDS = 3
  let oddWebm = ''
  let evenWebm = ''

  async function flatWebm(file: string, w: number, h: number): Promise<void> {
    await ff([
      '-y',
      '-f', 'lavfi', '-i', `color=c=0x808080:size=400x300:rate=25:duration=${SECONDS}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${SECONDS}`,
      '-vf', `scale=${w}:${h},format=yuv420p`,
      '-c:v', 'libvpx-vp9', '-b:v', '300k', '-c:a', 'libopus', '-shortest', file
    ])
  }

  /** Every frame decodes and ffmpeg has nothing to say about it. */
  async function decodesClean(file: string): Promise<void> {
    const { stderr } = await ff(['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'null', '-'])
    expect(stderr.trim(), 'decoding every frame prints nothing').toBe('')
  }

  async function videoOf(file: string) {
    const info = await ffprobeJson(file)
    return { info, v: info.streams.find((s) => s.codec_type === 'video') }
  }

  beforeAll(async () => {
    oddWebm = path.join(workDir, 't114-odd.webm')
    evenWebm = path.join(workDir, 't114-even.webm')
    await flatWebm(oddWebm, ODD_W, ODD_H)
    await flatWebm(evenWebm, ODD_W - 1, ODD_H - 1)
  }, 120_000)

  it('the fixtures: one really is odd-sized, its control is even', async () => {
    expect((await videoOf(oddWebm)).v).toMatchObject({ codec_name: 'vp9', width: ODD_W, height: ODD_H })
    expect((await videoOf(evenWebm)).v).toMatchObject({ width: ODD_W - 1, height: ODD_H - 1 })
  })

  describe('the MP4 convert (the recording flow and the importer)', () => {
    it('an odd-sized webm converts to an even-sized h264 mp4 that plays - the take is not lost', async () => {
      const out = path.join(workDir, 't114-convert-odd.mp4')
      await convertToMp4('recording', oddWebm, out, () => {})
      const { info, v } = await videoOf(out)
      expect([v?.codec_name, v?.pix_fmt]).toEqual(['h264', 'yuv420p'])
      // One pixel trimmed off the odd edge (EVEN_PICTURE is a crop since T-115, so nothing is
      // resampled - the checkerboard case below proves it): 321x241 -> 320x240.
      expect([v?.width, v?.height]).toEqual([ODD_W - 1, ODD_H - 1])
      expect(info.streams.find((s) => s.codec_type === 'audio')?.codec_name).toBe('aac')
      expect(Math.abs(Number(info.format.duration) - SECONDS)).toBeLessThan(0.5)
      await assertFaststart(out)
      await decodesClean(out)
    }, 120_000)

    it('the same through the importer, which shares the command', async () => {
      const out = await convertForImport(oddWebm)
      try {
        const { v } = await videoOf(out)
        expect([v?.width, v?.height]).toEqual([ODD_W - 1, ODD_H - 1])
        await decodesClean(out)
      } finally {
        await rm(out, { force: true })
      }
    }, 120_000)

    it('the control: an even-sized webm keeps its size exactly', async () => {
      const out = path.join(workDir, 't114-convert-even.mp4')
      await convertToMp4('recording', evenWebm, out, () => {})
      const { v } = await videoOf(out)
      expect([v?.width, v?.height]).toEqual([ODD_W - 1, ODD_H - 1])
    }, 120_000)

    /**
     * T-115 - the even-size stage is a CROP. It was `scale=trunc(iw/2)*2:trunc(ih/2)*2`, and a
     * scale from 321 to 320 resamples the picture to lose one pixel: a window capture
     * (the odd sizes a screen recording has) came out with soft text across about half the frame
     * (48.5 percent of the pixels in the band strictly between 80 and 175 on the scaled frame, 47.5 after the encode;
     * the four corners stay hard and every edge is soft at its middle). A 1-pixel
     * checkerboard is the hardest edge there is, so it shows the difference at once. Measured on
     * the unfixed stage, per sampled row of 320 pixels: row 100 had no black or white pixel at
     * all (it opens 100, 165, 93, 158 and is 129-130 across the middle); rows 7 and 233 were
     * still hard toward their two corners and soft in the middle (70 and 67 pixels in the
     * mid-gray band `hardness` counts, strictly between 80 and 175, and a middle of 120-143). Through the crop every
     * pixel of all three rows is black or white.
     * The fixture is lossless (VP9 -lossless) and made at its size by a crop, never a scale, so
     * the only resampling in the chain is the one under test; `exact=1` because crop otherwise
     * rounds a yuv420p picture down to even by itself, which would make the odd fixture even.
     */
    describe('a 1-pixel checkerboard stays hard-edged (T-115)', () => {
      let checkerOdd = ''
      let checkerEven = ''

      async function checkerWebm(file: string, w: number, h: number): Promise<void> {
        await ff([
          '-y',
          '-f', 'lavfi', '-i',
          `color=c=black:size=400x300:rate=25:duration=${SECONDS},format=yuv420p,` +
            `geq=lum='if(mod(X+Y,2),255,0)':cb=128:cr=128,crop=${w}:${h}:0:0:exact=1`,
          '-f', 'lavfi', '-i', `sine=frequency=440:duration=${SECONDS}`,
          '-shortest',
          '-c:v', 'libvpx-vp9', '-lossless', '1', '-c:a', 'libopus', file
        ])
      }

      /** One full row of luma, the way the file decodes. */
      const rowOf = (file: string, width: number, y: number): Promise<Buffer> =>
        samplePixels(file, 0.5, `crop=${width}:1:0:${y}`, 'gray')

      /** A hard 1-px checkerboard row: black/white, and every neighbor the other one. */
      function hardness(row: Buffer): { soft: number; flat: number } {
        let soft = 0
        let flat = 0
        for (let x = 0; x < row.length; x++) {
          const v = row[x] ?? 0
          if (v > 80 && v < 175) soft++
          if (x > 0 && Math.abs(v - (row[x - 1] ?? 0)) < 200) flat++
        }
        return { soft, flat }
      }

      beforeAll(async () => {
        checkerOdd = path.join(workDir, 't115-checker-odd.webm')
        checkerEven = path.join(workDir, 't115-checker-even.webm')
        await checkerWebm(checkerOdd, ODD_W, ODD_H)
        await checkerWebm(checkerEven, ODD_W - 1, ODD_H - 1)
      }, 120_000)

      it('the fixtures: one is odd, both are lossless hard checkerboards before the convert', async () => {
        expect((await videoOf(checkerOdd)).v).toMatchObject({ codec_name: 'vp9', width: ODD_W, height: ODD_H })
        expect((await videoOf(checkerEven)).v).toMatchObject({ width: ODD_W - 1, height: ODD_H - 1 })
        for (const [file, w] of [[checkerOdd, ODD_W], [checkerEven, ODD_W - 1]] as const) {
          for (const y of [7, 100, 233]) {
            expect(hardness(await rowOf(file, w, y)), `${path.basename(file)} row ${y}`).toEqual({ soft: 0, flat: 0 })
          }
        }
      }, 120_000)

      it('the control: an even checkerboard is exactly as hard after the convert (the encoder is not the softener)', async () => {
        const out = path.join(workDir, 't115-checker-even.mp4')
        await convertToMp4('recording', checkerEven, out, () => {})
        for (const y of [7, 100, 233]) {
          const row = await rowOf(out, ODD_W - 1, y)
          expect(hardness(row), `even row ${y}: ${[...row.subarray(0, 8)].join(',')}`).toEqual({ soft: 0, flat: 0 })
        }
      }, 120_000)

      it('an odd checkerboard comes out hard too: one column and one row are cut off, the rest is not resampled', async () => {
        const out = path.join(workDir, 't115-checker-odd.mp4')
        await convertToMp4('recording', checkerOdd, out, () => {})
        expect((await videoOf(out)).v).toMatchObject({ width: ODD_W - 1, height: ODD_H - 1 })
        for (const y of [7, 100, 233]) {
          const row = await rowOf(out, ODD_W - 1, y)
          const note = `odd row ${y} starts ${[...row.subarray(0, 8)].join(',')} and runs ${[...row.subarray(150, 158)].join(',')} in the middle`
          expect(hardness(row), note).toEqual({ soft: 0, flat: 0 })
        }
      }, 120_000)
    })
  })

  describe('the caption burn-in', () => {
    const BAND_H = 80
    const cuedSrt = () => path.join(workDir, 't114-cued.srt')
    const cuelessSrt = () => path.join(workDir, 't114-cueless.srt')

    beforeAll(async () => {
      await writeFile(cuedSrt(), '1\n00:00:00,200 --> 00:00:02,500\nCAPTION ON AN ODD PICTURE\n', 'utf8')
      await writeFile(cuelessSrt(), '1\n00:01:00,000 --> 00:01:02,000\nNEVER VISIBLE IN THIS RANGE\n', 'utf8')
    })

    it('an odd-sized picture is burned (subtitle stage joined to the even stage) and the text is painted', async () => {
      const out = path.join(workDir, 't114-burn-odd.mp4')
      const res = await runBurnIn(
        {
          jobId: 't114-burn-odd',
          videoPath: oddWebm,
          srtPath: cuedSrt(),
          outputPath: out,
          fontSizePct: 4,
          startSec: 0,
          endSec: SECONDS
        },
        () => {}
      )
      expect(res.captioned).toBe(true)
      const { v } = await videoOf(out)
      expect([v?.codec_name, v?.width, v?.height]).toEqual(['h264', ODD_W - 1, ODD_H - 1])
      await decodesClean(out)
      // The subtitle stage still ran after the even stage: the bottom band has text on it...
      const bottom = await regionLuma(out, 1, `crop=${ODD_W - 1}:${BAND_H}:0:${ODD_H - 1 - BAND_H}`)
      expect(bottom.max - bottom.min, 'caption pixels in the bottom band').toBeGreaterThan(100)
      // ...and the top of the frame is the flat gray it was.
      const top = await regionLuma(out, 1, `crop=${ODD_W - 1}:${BAND_H}:0:0`)
      expect(top.max - top.min, 'the top band is untouched').toBeLessThan(10)
    }, 120_000)

    it('a window with no cue in it (no subtitle stage at all) is still evened', async () => {
      const out = path.join(workDir, 't114-burn-odd-cueless.mp4')
      const res = await runBurnIn(
        {
          jobId: 't114-burn-odd-cueless',
          videoPath: oddWebm,
          srtPath: cuelessSrt(),
          outputPath: out,
          fontSizePct: 4,
          startSec: 0,
          endSec: SECONDS
        },
        () => {}
      )
      expect(res.captioned).toBe(false)
      const { v } = await videoOf(out)
      expect([v?.codec_name, v?.width, v?.height]).toEqual(['h264', ODD_W - 1, ODD_H - 1])
      await decodesClean(out)
    }, 120_000)

    it('the control: an even-sized picture is captioned at its own size', async () => {
      const out = path.join(workDir, 't114-burn-even.mp4')
      await runBurnIn(
        {
          jobId: 't114-burn-even',
          videoPath: evenWebm,
          srtPath: cuedSrt(),
          outputPath: out,
          fontSizePct: 4,
          startSec: 0,
          endSec: SECONDS
        },
        () => {}
      )
      const { v } = await videoOf(out)
      expect([v?.width, v?.height]).toEqual([ODD_W - 1, ODD_H - 1])
      const bottom = await regionLuma(out, 1, `crop=${ODD_W - 1}:${BAND_H}:0:${ODD_H - 1 - BAND_H}`)
      expect(bottom.max - bottom.min).toBeGreaterThan(100)
    }, 120_000)
  })

  describe('the picture-in-picture composite', () => {
    it('an odd-sized base composites into an even-sized mp4 with the overlay where it was asked', async () => {
      const out = path.join(workDir, 't114-pip-odd.mp4')
      await runPipComposite('t114-pip-odd', oddWebm, pipOverlaySrc, out, {
        overlayWidth: 100,
        position: 'top-left',
        margin: 10
      })
      const { info, v } = await videoOf(out)
      expect([v?.codec_name, v?.pix_fmt, v?.width, v?.height]).toEqual(['h264', 'yuv420p', ODD_W - 1, ODD_H - 1])
      expect(info.streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1)
      await decodesClean(out)
      // A 100 px overlay of a 640x360 feed is 100x56 at (10, 10): its center is the overlay's green...
      const inside = await meanRgb(out, 1, 60, 36)
      expect(rgbDelta(inside, PIP_OVERLAY_RGB), `overlay center ${inside.join(',')}`).toBeLessThan(25)
      // ...and the far corner is the base's flat gray.
      const far = await meanRgb(out, 1, 250, 180)
      expect(rgbDelta(far, [128, 128, 128]), `base ${far.join(',')}`).toBeLessThan(12)
    }, 120_000)

    it('the control: an even-sized base composites at its own size', async () => {
      const out = path.join(workDir, 't114-pip-even.mp4')
      await runPipComposite('t114-pip-even', evenWebm, pipOverlaySrc, out, {
        overlayWidth: 100,
        position: 'bottom-right',
        margin: 10
      })
      const { v } = await videoOf(out)
      expect([v?.width, v?.height]).toEqual([ODD_W - 1, ODD_H - 1])
    }, 120_000)
  })
})
