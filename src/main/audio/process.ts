import { spawn, type ChildProcess } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import { ffmpegPath } from '../ffmpeg/paths'
import { cancelledOr, killAsCancelled } from '../ffmpeg/cancelMark'
import {
  aselectForCuts,
  buildChain,
  chainEndsWithLoudnorm,
  parseLoudnormJson,
  vselectForCuts,
  type LoudnormMeasurement
} from './chain'
import { probeAudio } from './probe'
import type {
  AudioExportSpec,
  AudioJobProgress,
  AudioJobResult,
  AudioMuxSpec,
  AudioOutputFormat,
  CutRegion
} from '../../shared/audio'
import { DEFAULT_DUCK_PARAMS } from '../../shared/audio'
import { assert } from '../../shared/assert'

export type AudioProgressListener = (p: AudioJobProgress) => void

const activeJobs = new Map<string, ChildProcess>()

function codecArgsFor(format: AudioOutputFormat, bitrate?: string): string[] {
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', bitrate ?? '192k']
    case 'wav':
      return ['-c:a', 'pcm_s16le']
    case 'flac':
      return ['-c:a', 'flac', '-compression_level', '5']
    case 'aac':
      return ['-c:a', 'aac', '-b:a', bitrate ?? '192k']
  }
}

function durationFromTimemark(timemark: string): number {
  const m = timemark.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

async function runFfmpegJob(
  args: string[],
  jobId: string,
  totalDuration: number,
  pass: 'measure' | 'render' | 'mux',
  onProgress: AudioProgressListener,
  collectStderr = false
): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    activeJobs.set(jobId, child)
    let stderr = ''
    let lastEmitted = 0

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const lines = chunk.split(/\r?\n/)
      let timemark: string | undefined
      for (const line of lines) {
        const [k, v] = line.split('=')
        if (k === 'out_time' && v !== undefined) timemark = v
      }
      if (timemark) {
        const elapsed = durationFromTimemark(timemark)
        const percent =
          totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0
        if (percent - lastEmitted > 1 || percent === 100) {
          lastEmitted = percent
          onProgress({ jobId, pass, percent, timemark })
        }
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (collectStderr || stderr.length < 32768) stderr += chunk
      if (!collectStderr && stderr.length > 16384) stderr = stderr.slice(-16384)
    })

    child.on('error', (err) => {
      activeJobs.delete(jobId)
      reject(cancelledOr(child, err))
    })
    child.on('close', (code) => {
      activeJobs.delete(jobId)
      if (code === 0) resolve({ stderr })
      else reject(cancelledOr(child, new Error(`FFmpeg exit ${code}: ${stderr.trim().slice(-1000)}`)))
    })
  })
}

export async function runAudioExport(
  spec: AudioExportSpec,
  onProgress: AudioProgressListener
): Promise<AudioJobResult> {
  const startedAt = Date.now()
  const probe = await probeAudio(spec.sourcePath)

  let measurement: LoudnormMeasurement | undefined

  const chain = buildChain(spec.chain)

  if (chain.needsTwoPass && chain.filterPass1) {
    const args = [
      '-y',
      '-i',
      spec.sourcePath,
      '-af',
      chain.filterPass1,
      '-f',
      'null',
      '-progress',
      'pipe:1',
      '-nostats',
      '-'
    ]
    const { stderr } = await runFfmpegJob(args, spec.jobId, probe.duration, 'measure', onProgress, true)
    const parsed = parseLoudnormJson(stderr)
    if (parsed) measurement = parsed
  }

  const secondary = spec.chain.secondaryTrack
  // T-82: the cut belongs to the FINAL audio. With a secondary track the
  // chain used to cut only the primary input, so the music ran uncut beside a
  // cut voice (and the mix came out as long as the music). Here the primary's
  // own stages are built without it and the cut is applied once, to the mix —
  // the same `aselect` for voice and music, on one clock, so they cannot
  // drift. Without a secondary track the primary IS the final audio and the
  // cut stays first in its chain, ahead of the loudnorm that should measure
  // only what is kept. (The measure pass above stays cut-first on purpose:
  // loudnorm is linear there, so a gain measured on the kept audio is the
  // right constant to apply before or after the cut.)
  const cutAfterMix = Boolean(secondary)
  const finalChain = buildChain(
    cutAfterMix ? { ...spec.chain, cutRegions: [] } : spec.chain,
    measurement
  )
  const mixCut = cutAfterMix ? aselectForCuts(spec.chain.cutRegions) : null
  const args: string[] = ['-y', '-i', spec.sourcePath]
  if (secondary) {
    args.push('-i', secondary.filePath)
  }
  args.push('-vn')
  if (secondary) {
    const ducking = secondary.duckUnderPrimary
    const gainDb = secondary.gainDb
    // Match-loudness mode runs both tracks through single-pass loudnorm at the
    // same target before mixing — handy for co-host mics or game audio that
    // arrives at very different levels.
    //
    // Bug-fix (Phase 2.9): if ChainSpec.loudnorm is on, finalChain.filterPass2
    // already ends with a measurement-aware loudnorm. Appending a second
    // loudnorm produced a double-pass (the redundant filter blew up the LRA
    // and TP measurements before mixing). Skip the append in that case.
    const matchLoudness = secondary.matchLoudness === true
    const target = spec.chain.loudnormTargetLufs ?? -16
    const primaryAlreadyLoudnormed = chainEndsWithLoudnorm(finalChain.filterPass2)
    const primaryStage =
      matchLoudness && !primaryAlreadyLoudnormed
        ? `${finalChain.filterPass2},loudnorm=I=${target}:TP=-1.5:LRA=11`
        : finalChain.filterPass2
    // M5 fix (round 15): amix requires both inputs at the same sample rate
    // and channel layout. The output is forced to 48 kHz stereo below, so
    // resample + format the secondary first. Without this, a 44.1 kHz music
    // track mixed with a 48 kHz mic either silently auto-resamples (lossy)
    // or fails the filter graph entirely.
    const secondaryNormalize = 'aresample=48000,aformat=channel_layouts=stereo'
    const secondaryGainOrLoud = matchLoudness
      ? `${secondaryNormalize},loudnorm=I=${target}:TP=-1.5:LRA=11`
      : `${secondaryNormalize},volume=${gainDb}dB`
    // Phase 3.2: replace hardcoded sidechain params with duckParams from
    // the SecondaryTrack (falls back to defaults that preserve previous
    // behavior). Threshold is dBFS in the UI; ffmpeg expects linear.
    const dp = secondary.duckParams ?? DEFAULT_DUCK_PARAMS
    const thresholdLinear = Math.pow(10, dp.thresholdDb / 20)
    // INIT-A (round 15): when sidechain ducking is on, the duck already
    // attenuates the secondary; double-attenuating with amix weights 1 0.7
    // made the secondary inaudible during quiet primary passages too. Use
    // even weights and let the sidechain do its job.
    // Round 18: normalize the primary to the same 48 kHz stereo the
    // secondary is forced to — the round-15 M5 fix only covered the
    // secondary side, leaving a 44.1 kHz mono mic to hit amix mismatched.
    const primaryNormalize = 'aresample=48000,aformat=channel_layouts=stereo'
    // Round 18: a filtergraph label can only be consumed ONCE. The prior
    // ducking graph fed [primary] to sidechaincompress AND amix, which
    // ffmpeg rejects outright ("Invalid stream specifier: primary") — every
    // duck-under-primary export failed. asplit the primary: one copy keys
    // the sidechain, the other carries the audible mix. Caught by the
    // real-ffmpeg integration layer.
    // Round 18: amix's default normalization scales each input by 1/N, so
    // two tracks match-loudnessed to the target mixed ~3 LU BELOW it
    // (measured: two -16 LUFS sources → -19 LUFS mix). When the user asked
    // for a loudness target, restore it with a single-pass loudnorm on the
    // mix bus. Manual-gain mode is left un-normalized on purpose — the
    // user is gain-staging by hand there.
    // The cut sits ahead of that mix-bus loudnorm, which should measure only
    // what is kept.
    const postMixStages = [
      mixCut,
      matchLoudness || primaryAlreadyLoudnormed
        ? `loudnorm=I=${target}:TP=-1.5:LRA=11`
        : null
    ].filter((stage): stage is string => stage !== null)
    const postMix = postMixStages.length > 0 ? `;[premix]${postMixStages.join(',')}[mix]` : ''
    const mixLabel = postMix ? '[premix]' : '[mix]'
    const filterGraph = ducking
      ? `[0:a]${primaryStage},${primaryNormalize},asplit=2[primary][primary_sc];` +
        `[1:a]${secondaryGainOrLoud}[secondary_pre];` +
        `[secondary_pre][primary_sc]sidechaincompress=` +
        `threshold=${thresholdLinear.toFixed(4)}:` +
        `ratio=${dp.ratio}:` +
        `attack=${dp.attackMs}:` +
        `release=${dp.releaseMs}[secondary_ducked];` +
        `[primary][secondary_ducked]amix=inputs=2:duration=longest:dropout_transition=0:weights='1 1'${mixLabel}` +
        postMix
      : `[0:a]${primaryStage},${primaryNormalize}[primary];` +
        `[1:a]${secondaryGainOrLoud}[secondary];` +
        `[primary][secondary]amix=inputs=2:duration=longest:dropout_transition=0:weights='1 1'${mixLabel}` +
        postMix
    args.push('-filter_complex', filterGraph, '-map', '[mix]')
  } else {
    args.push('-af', finalChain.filterPass2)
  }
  args.push(
    ...codecArgsFor(spec.format, spec.bitrate),
    '-ar',
    '48000',
    '-progress',
    'pipe:1',
    '-nostats',
    spec.outputPath
  )
  await runFfmpegJob(args, spec.jobId, probe.duration, 'render', onProgress)
  onProgress({ jobId: spec.jobId, pass: 'render', percent: 100 })

  return {
    jobId: spec.jobId,
    outputPath: spec.outputPath,
    durationMs: Date.now() - startedAt
  }
}

/**
 * Put `audioPath` on `videoPath`'s picture. `audioPath` is already the FINAL
 * audio: when the chain closed cut regions in it (it is shorter by their total
 * length), pass the same `cutRegions` here and the picture drops them too.
 *
 * T-82 — the two cases are different jobs:
 *  - No cuts: the picture is stream-copied (byte-cheap, untouched).
 *  - Cuts: the picture is cut with the SAME expression the audio was
 *    (`vselectForCuts`, built from the same list by the same builder), which
 *    needs a re-encode — select/setpts cannot run on copied packets.
 *    Settings match the other whole-file re-encodes (burn-in, reframe):
 *    libx264 medium, yuv420p, default CRF — no bitrate cap, so the file is
 *    not squeezed to a platform preset the user never chose; frame rate is
 *    left as the source's (see -fps_mode below).
 *
 * `-shortest` stays on BOTH paths, and its job is not the one it used to
 * have. Before T-82 it papered over a mismatch: the audio was cut and the
 * picture was not, so it silently threw away the video's last N seconds
 * (N = the total cut length) while the sound ran N seconds ahead of the
 * picture. Now the cut picture and the cut audio are equal by construction
 * and `-shortest` hides nothing about the desync — the Layer 5 content reads
 * (burst positions, frame luma) are what prove that. What it still bounds is
 * a music bed LONGER than the picture: amix runs to its longest input, so the
 * mix is max(voice, music) minus the cuts, which overruns the cut picture
 * whenever the music outlasts the source; `-shortest` trims that tail (it
 * trims the END of the audio, it moves nothing). With no cuts it also trims
 * the few-millisecond tail difference between a video and the audio track
 * extracted from it.
 */
export async function runAudioMux(
  jobId: string,
  videoPath: string,
  audioPath: string,
  outputPath: string,
  onProgress: AudioProgressListener,
  cutRegions: CutRegion[] = []
): Promise<AudioJobResult> {
  const startedAt = Date.now()
  const pictureCut = vselectForCuts(cutRegions)
  const args = [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    ...(pictureCut
      ? [
          '-vf',
          pictureCut,
          '-c:v',
          'libx264',
          '-preset',
          'medium',
          '-pix_fmt',
          'yuv420p',
          // `setpts` leaves the filter graph's output frame rate unknown, so
          // by default ffmpeg warns "No information about the input
          // framerate" and forces 25 fps CFR — duplicating frames, and
          // turning a 60 fps recording into a 25 fps one. Passthrough keeps
          // exactly the frames `select` kept, on the timestamps `setpts` gave.
          '-fps_mode',
          'passthrough'
        ]
      : ['-c:v', 'copy']),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    // B7 fix (round 15): muxed MP4 also needs faststart so web players
    // (and most browser previewers) don't stall on the moov atom.
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath
  ]
  // A stream-copy mux is instant and needs no bar; the re-encode is minutes
  // on a long recording, and the output is exactly as long as the (already
  // cut) audio.
  const total = pictureCut ? (await probeAudio(audioPath)).duration : 0
  await runFfmpegJob(args, jobId, total, 'mux', onProgress)
  onProgress({ jobId, pass: 'mux', percent: 100 })
  return { jobId, outputPath, durationMs: Date.now() - startedAt }
}

/**
 * "Re-attach to video" (the Export panel's mux-back branch): render the
 * cleaned audio to an intermediate WAV beside the output, then mux it onto
 * the video's picture — cutting the picture wherever the chain cut the sound
 * (T-82; see runAudioMux).
 *
 * The WAV is an implementation detail of this one job (~0.7 GB per hour of
 * audio), so it dies with the job: removed after the mux on success AND on
 * any failure or cancel, whichever pass it came from. It lives here, in main,
 * rather than in the renderer, because only main can delete it on every exit
 * path — and because with mux-back OFF the exported audio file IS the
 * deliverable, which never goes through this function.
 */
export async function runAudioReattach(
  spec: AudioMuxSpec,
  onProgress: AudioProgressListener
): Promise<AudioJobResult> {
  const startedAt = Date.now()
  const tempAudioPath = `${spec.outputPath.replace(/\.mp4$/i, '')}.cleaned.wav`
  // The delete below is unconditional, so it must never be aimed at a file
  // the job did not make. spec.outputPath cannot collide by construction
  // (the suffix differs); the two inputs can, if a file already sits there.
  assert(
    tempAudioPath !== spec.sourcePath && tempAudioPath !== spec.videoPath,
    `intermediate audio path ${tempAudioPath} would overwrite a file this job reads`
  )
  try {
    await runAudioExport(
      {
        jobId: spec.jobId,
        sourcePath: spec.sourcePath,
        outputPath: tempAudioPath,
        chain: spec.chain,
        format: 'wav'
      },
      onProgress
    )
    await runAudioMux(
      spec.jobId,
      spec.videoPath,
      tempAudioPath,
      spec.outputPath,
      onProgress,
      spec.chain.cutRegions
    )
  } finally {
    await unlink(tempAudioPath).catch(() => {})
  }
  return { jobId: spec.jobId, outputPath: spec.outputPath, durationMs: Date.now() - startedAt }
}

export function cancelAudioJob(jobId: string): boolean {
  const child = activeJobs.get(jobId)
  if (!child) return false
  killAsCancelled(child)
  activeJobs.delete(jobId)
  return true
}

/**
 * M10 fix (round 15): take down every in-flight audio job at once. Used by
 * the app-level before-quit handler so a half-finished long export doesn't
 * keep an orphaned ffmpeg child alive after the window closes.
 */
export function cancelAllAudioJobs(): void {
  for (const [, child] of activeJobs) killAsCancelled(child)
  activeJobs.clear()
}
