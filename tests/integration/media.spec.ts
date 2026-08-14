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
import { convertForImport } from '../../src/main/ffmpeg/convert'
import { extractAudioFromVideo } from '../../src/main/audio/extract'
import type { Clip, ExportJobSpec, PlatformId } from '../../src/shared/clip'
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
}, 180_000)

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
