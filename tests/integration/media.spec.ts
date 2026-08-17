import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ffmpegPath, ffprobePath } from '../../src/main/ffmpeg/paths'
import { runExportJob } from '../../src/main/ffmpeg/export'
import { runGifExport } from '../../src/main/ffmpeg/gif'
import { runAudioExport, runAudioMux } from '../../src/main/audio/process'
import { probeVideo } from '../../src/main/ffmpeg/probe'
import { probeAudio } from '../../src/main/audio/probe'
import {
  convertForImport,
  convertToMp4,
  cancelConverts,
  ConvertCancelledError
} from '../../src/main/ffmpeg/convert'
import { extractAudioFromVideo } from '../../src/main/audio/extract'
import { runReframe } from '../../src/main/ffmpeg/reframe'
import { runConcat, runPipComposite } from '../../src/main/ffmpeg/concat'
import { analyzeClipHook, findHighlights } from '../../src/main/ffmpeg/highlights'
import { runBurnIn } from '../../src/main/sidecars/whisperManager'
import type {
  Clip,
  ExportJobSpec,
  PlatformId,
  TextOverlay,
  WatermarkSpec
} from '../../src/shared/clip'
import type { CustomPreset } from '../../src/shared/customPresets'
import { DEFAULT_CHAIN_SPEC, type AudioExportSpec, type ChainSpec } from '../../src/shared/audio'
import { escapeSubtitlesPath } from '../../src/shared/captions'
import { ALL_PRESET_IDS, PLATFORM_PRESETS } from '../../src/main/ffmpeg/presets'

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
    width?: number
    height?: number
    pix_fmt?: string
    sample_rate?: string
    channels?: number
    avg_frame_rate?: string
    sample_aspect_ratio?: string
    display_aspect_ratio?: string
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

/** moov atom must precede mdat for a faststart (streamable) MP4. */
async function assertFaststart(file: string): Promise<void> {
  const buf = await readFile(file)
  const moov = buf.indexOf('moov')
  const mdat = buf.indexOf('mdat')
  expect(moov, `moov atom present in ${path.basename(file)}`).toBeGreaterThan(-1)
  expect(mdat, `mdat atom present in ${path.basename(file)}`).toBeGreaterThan(-1)
  expect(moov, `moov before mdat (faststart) in ${path.basename(file)}`).toBeLessThan(mdat)
}

/** Integrated LUFS of a file, measured with ebur128. */
async function measureLufs(file: string): Promise<number> {
  const { stderr } = await ff([
    '-hide_banner',
    '-i',
    file,
    '-af',
    'ebur128=framelog=verbose',
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
  await ff([
    '-y',
    '-ss', String(timeSec),
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
  flatGraySrc = path.join(workDir, 'flat-gray.mp4')
  await ff([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x808080:size=1920x1080:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
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
 * T-51 — watermark and text-overlay PIXELS.
 *
 * PER-PLATFORM CAVEAT, same class as the mpegts segfault further down:
 * ffmpeg-static ships binaries from DIFFERENT upstream builders per
 * platform, and the linux x64 one (johnvansickle 7.0.2-static) is built
 * without libfreetype, so it has no `drawtext` filter at all — the only
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
 * Timebase note for the `enable` windows: `-ss` before `-i` is input
 * seeking, so frames reach the filter graph starting at t=0. A drawtext
 * `enable` window is therefore CLIP-relative, not source-absolute.
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

  const CLIP_START = 0
  const CLIP_END = 3
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

  it.skipIf(process.platform !== 'win32')(
    'text overlays paint their own colour at the x/y they name, and only inside their enable window',
    async () => {
      // Two overlays in one export: it also proves the chain survives more
      // than one drawtext. `lower` spans the whole clip (the shape the
      // editor produces, whose window is the clip's own range); `timed`
      // carries a sub-range, which is the only thing `enable` is for.
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
        startSec: 0.4,
        endSec: 1.6
      }
      // x=0.1 -> 192 px, y -> 918 / 108 px, drawn downward from there.
      const LOWER_REGION = 'crop=768:160:128:900'
      const TIMED_REGION = 'crop=768:160:128:90'
      // The same band on the far side of the frame: proves the text landed
      // at the x it named rather than merely somewhere on that row.
      const MIRROR_REGION = 'crop=768:160:1152:900'

      const res = await runExportJob(
        {
          ...makeJob(
            flatGraySrc,
            'youtube',
            makeClip({ startSec: CLIP_START, endSec: CLIP_END, textOverlays: [lower, timed] }),
            'job-overlays'
          ),
          outputFilename: 'text-overlays.mp4'
        },
        () => {}
      )
      const out = res.outputPath

      // ── inside both windows ──
      const lowerOn = await countTintedPixels(out, SAMPLE_T, LOWER_REGION, 0)
      expect(
        lowerOn,
        `"LOWER THIRD" paints red glyphs at x=0.1,y=0.85 (${lowerOn} red px at t=${SAMPLE_T})`
      ).toBeGreaterThan(100)
      const timedOn = await countTintedPixels(out, SAMPLE_T, TIMED_REGION, 1)
      expect(
        timedOn,
        `"TIMED" paints green glyphs at x=0.1,y=0.1 inside its window (${timedOn} green px at t=${SAMPLE_T})`
      ).toBeGreaterThan(50)

      // Each overlay's colour is its own: neither region carries the other's.
      const lowerGreen = await countTintedPixels(out, SAMPLE_T, LOWER_REGION, 1)
      expect(
        lowerGreen,
        `the lower band carries no green — colorHex is per-overlay (${lowerGreen} green px)`
      ).toBe(0)
      const mirrorRed = await countTintedPixels(out, SAMPLE_T, MIRROR_REGION, 0)
      expect(
        mirrorRed,
        `the mirrored band at x=1152..1920 is untouched, so the text landed at the x it named (${mirrorRed} red px)`
      ).toBe(0)

      // ── outside the timed window ──
      // 2.5 s is past `timed`'s 1.6 s end but inside `lower`'s range, so one
      // assertion proves the gate closes and the other proves the export did
      // not simply stop drawing.
      const timedOff = await countTintedPixels(out, 2.5, TIMED_REGION, 1)
      expect(timedOff, `"TIMED" is gone at t=2.5 (${timedOff} green px)`).toBe(0)
      const timedOffLuma = await regionLuma(out, 2.5, TIMED_REGION)
      expect(
        timedOffLuma.max - timedOffLuma.min,
        `and its band is flat again at t=2.5 (luma ${timedOffLuma.min}..${timedOffLuma.max})`
      ).toBeLessThanOrEqual(4)
      const lowerStill = await countTintedPixels(out, 2.5, LOWER_REGION, 0)
      expect(
        lowerStill,
        `"LOWER THIRD" is still painted at t=2.5 (${lowerStill} red px)`
      ).toBeGreaterThan(100)
    },
    600_000
  )

  it.skipIf(process.platform === 'win32')(
    'KNOWN linux-binary gap: the bundled ffmpeg has NO drawtext filter (if this FAILS, ffmpeg-static gained it — lift the win32 gate on the pixel tests above and delete both pins)',
    async () => {
      const names = await ffFilterNames()
      // Prove the table was really read before trusting an absence. The two
      // positives also show this build has SOME text rendering — `subtitles`
      // is the libass path the caption burn-in relies on — so the gap is
      // specifically drawtext/libfreetype, not "no text at all".
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
    const lufs = await measureLufs(res.outputPath)
    expect(lufs).toBeGreaterThan(-17)
    expect(lufs).toBeLessThan(-15)
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

describe('subtitles path escaping (real ffmpeg)', () => {
  // Burn-in derives the SRT name from the untouched source filename, so
  // apostrophes/spaces/commas all reach the subtitles= filter argument.
  // escapeSubtitlesPath is the round-18 two-level escaper; this pins it
  // against ffmpeg's actual filtergraph parser, not just a string shape.
  it.each([
    "Sam's Highlight-123.srt",
    'plain.srt',
    'with space.srt',
    'weird,name;[x].srt'
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

      let recPercent = 0
      let impPercent = 0
      const recording = convertToMp4('recording', recSrc, recOut, (p) => {
        recPercent = p.percent
      })
      const importing = convertForImport(impSrc, (p) => {
        impPercent = p.percent
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
      while ((recPercent === 0 || impPercent === 0) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
      }
      expect(recPercent, 'the recording convert is running').toBeGreaterThan(0)
      expect(impPercent, 'the import convert is running').toBeGreaterThan(0)

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
  // differ from the 1280x720 @ 30fps target it normalizes to.

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
    expect(v?.avg_frame_rate).toBe('30/1')
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

// ---------------------------------------------------------------------------
// T-04 — highlight discovery and clip cutting
// ---------------------------------------------------------------------------

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
  // that instead of a plain no-filter encode isolates the rendered text:
  // both files went through libass and the same encoder settings, so any
  // difference is the caption itself rather than filter-chain colour drift.
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

  it('rejects a missing SRT with the burn-in runner error', async () => {
    const outputPath = path.join(workDir, 'burnin-missing.mp4')
    await expect(
      runBurnIn(
        {
          jobId: 'burnin-missing',
          videoPath: landscapeSrc,
          srtPath: path.join(workDir, 'no-such-file.srt'),
          outputPath,
          fontSizePct: 4,
          startSec: 0,
          endSec: 1
        },
        () => {}
      )
    ).rejects.toThrow(/^burn-in exit \d+: .*Unable to open .*no-such-file\.srt/s)
    expect(existsSync(outputPath)).toBe(false)
  })
})
