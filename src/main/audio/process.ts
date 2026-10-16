import { spawn, type ChildProcess } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import { ffmpegPath } from '../ffmpeg/paths'
import { cancelledOr, killAsCancelled } from '../ffmpeg/cancelMark'
import { CancelLatch, type LatchRun } from '../ffmpeg/cancelLatch'
import { discardPartialOutput } from '../ffmpeg/partialOutput'
import {
  aselectForCuts,
  buildChain,
  chainEndsWithLoudnorm,
  EMPTY_CHAIN,
  keptDurationSec,
  parseLoudnormJson,
  vselectForCuts,
  type LoudnormMeasurement
} from './chain'
import { probeAudio } from './probe'
import { probeVideo, type ProbeResult } from '../ffmpeg/probe'
import { EVEN_PICTURE } from '../ffmpeg/filters'
import { canStreamCopyIntoMp4 } from '../../shared/mediaFormats'
import { cancelAllExtractions } from './extract'
import type {
  AudioExportSpec,
  AudioJobProgress,
  AudioJobResult,
  AudioMuxSpec,
  AudioOutputFormat,
  CutRegion
} from '../../shared/audio'
import { DEFAULT_DUCK_PARAMS } from '../../shared/audio'
import { assertAlways } from '../../shared/assert'

export type AudioProgressListener = (p: AudioJobProgress) => void

/**
 * The last stage of a manual-gain mix (T-111), and since T-123 (10) of a single-track export with any stage in its
 * chain: peaks above -1 dBFS are limited, nothing below it moves.
 */
const MIX_LIMITER = 'alimiter=limit=0.891:level=disabled'

const activeJobs = new Map<string, ChildProcess>()
// T-98: an export probes the file before its first child, and the picture mux
// probes the picture (T-131 (2); the cleaned audio when the picture cannot be
// read) before its own; a Cancel in either wait finds no child, so the run is
// what it marks.
const latch = new CancelLatch()

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
  run: LatchRun,
  /** The file this pass writes (the measure pass writes none): removed if the pass fails. */
  outputPath?: string,
  collectStderr = false
): Promise<{ stderr: string }> {
  let spawnedAt: number | null = null
  return new Promise<{ stderr: string }>((resolve, reject) => {
    run.check()
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    spawnedAt = Date.now()
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
  }).catch(async (err: unknown) => {
    // T-100: a render that stopped halfway is not the user's audio.
    if (outputPath !== undefined) await discardPartialOutput(outputPath, spawnedAt)
    throw err
  })
}

export async function runAudioExport(
  spec: AudioExportSpec,
  onProgress: AudioProgressListener
): Promise<AudioJobResult> {
  const run = latch.begin(spec.jobId)
  try {
    return await exportAudio(spec, onProgress, run)
  } finally {
    run.end()
  }
}

async function exportAudio(
  spec: AudioExportSpec,
  onProgress: AudioProgressListener,
  run: LatchRun
): Promise<AudioJobResult> {
  const startedAt = Date.now()
  const probe = await run.guard(probeAudio(spec.sourcePath))

  let measurement: LoudnormMeasurement | undefined

  // T-123 (11): a mono source with no second track is exported as the mono file it is, so its loudnorm is
  // measured as dual mono (the way a stereo playback hears it) on both passes. With a second track the
  // primary is forced to stereo ahead of the mix's own last stage, which is not told.
  const dualMono = probe.channels === 1 && !spec.chain.secondaryTrack
  const chain = buildChain(spec.chain, undefined, dualMono)
  // T-125 (6): ffmpeg's `out_time` is a position in the file this job WRITES, which is the source less its cuts, so that is the
  // length both bars are measured against (the measure pass is cut-first, like the render).
  const writtenSeconds = keptDurationSec(probe.duration, spec.chain.cutRegions)

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
    const { stderr } = await runFfmpegJob(
      args,
      spec.jobId,
      writtenSeconds,
      'measure',
      onProgress,
      run,
      undefined,
      true
    )
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
    measurement,
    dualMono
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
    // mix bus.
    //
    // T-111: that "1/N" is the number of inputs STILL RUNNING, not the number
    // that started. A music bed shorter than the voice ends at, say, 3 s, and
    // from that instant the survivor is scaled by 1 instead of 1/2: the voice
    // steps up 6 dB in the middle of the recording (measured: -30.1 -> -24.1 dB
    // in the voice's own band, then the player's loudness jumps with it).
    // `normalize=0` keeps every input at the weight it was given, so the voice
    // is one level from the first second to the last and the bed's own gain is
    // the only thing that sets how loud it sits under it. Summing at full
    // weight can pass full scale, so the mix bus always ends in a stage that
    // answers for its peaks: the loudnorm above when a target was asked for
    // (its true-peak limit is -1.5 dB), otherwise a plain limiter at -1 dBFS.
    // `level=disabled` matters: alimiter's default re-levels its output back up
    // toward the limit, which would turn a quiet mix into a loud one.
    // The cut sits ahead of that last stage, which should measure and limit only
    // what is kept.
    const postMixStages = [
      mixCut,
      matchLoudness || primaryAlreadyLoudnormed
        ? `loudnorm=I=${target}:TP=-1.5:LRA=11`
        : MIX_LIMITER
    ].filter((stage): stage is string => stage !== null)
    const postMix = `;[premix]${postMixStages.join(',')}[mix]`
    const amix = `amix=inputs=2:duration=longest:dropout_transition=0:weights='1 1':normalize=0`
    const filterGraph = ducking
      ? `[0:a]${primaryStage},${primaryNormalize},asplit=2[primary][primary_sc];` +
        `[1:a]${secondaryGainOrLoud}[secondary_pre];` +
        `[secondary_pre][primary_sc]sidechaincompress=` +
        `threshold=${thresholdLinear.toFixed(4)}:` +
        `ratio=${dp.ratio}:` +
        `attack=${dp.attackMs}:` +
        `release=${dp.releaseMs}[secondary_ducked];` +
        `[primary][secondary_ducked]${amix}[premix]` +
        postMix
      : `[0:a]${primaryStage},${primaryNormalize}[primary];` +
        `[1:a]${secondaryGainOrLoud}[secondary];` +
        `[primary][secondary]${amix}[premix]` +
        postMix
    args.push('-filter_complex', filterGraph, '-map', '[mix]')
  } else {
    // T-123 (10): the mix bus above always ends in a stage that answers for its peaks; this path did not
    // unless Even volume was on, so +12 dB of Manual gain on a -2 dBFS source exported at 0.0 dBFS. A chain
    // with a stage in it now ends in the same limiter, and a bare 'anull' is still a pass-through (nothing
    // switched on is the file that went in). Even volume's own last stage is loudnorm, whose true-peak limit
    // (-1.5 dB) is the answer, so it gets no second one.
    const limited = !spec.chain.loudnorm && finalChain.filterPass2 !== EMPTY_CHAIN
    args.push('-af', limited ? `${finalChain.filterPass2},${MIX_LIMITER}` : finalChain.filterPass2)
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
  await runFfmpegJob(args, spec.jobId, writtenSeconds, 'render', onProgress, run, spec.outputPath)
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
 *  - No cuts: the picture is stream-copied (byte-cheap, untouched) — when an
 *    mp4 can carry its codec (`canStreamCopyIntoMp4`, T-111); a picture in
 *    anything else (wmv2, vp8, mpeg2...) is re-encoded the way a cut one is.
 *  - Cuts: the picture is cut with the SAME expression the audio was
 *    (`vselectForCuts`, built from the same list by the same builder), which
 *    needs a re-encode — select/setpts cannot run on copied packets.
 *    Settings match the caption burn-in's whole-file re-encode: libx264
 *    medium, yuv420p, default CRF — no bitrate cap, so the file is not
 *    squeezed to a platform preset the user never chose; frame rate is left
 *    as the source's (see -fps_mode below). (Reframe is a different job: it
 *    re-encodes a trimmed range at 6 Mbps and 30 fps, so it is not a model
 *    for this one.)
 *
 * `-shortest` stays on BOTH paths, and its job is not the one it used to
 * have. Before T-82 it papered over a mismatch: the audio was cut and the
 * picture was not, so it silently threw away the video's last N seconds
 * (N = the total cut length) while the sound ran N seconds ahead of the
 * picture. Now the cut picture and the cut audio drop the same frames; at
 * each cut they agree to within one 256-sample block of sound (5.3 ms at
 * 48 kHz: `aselectForCuts` re-chunks the sound to 256 samples before `aselect`
 * drops whole blocks, T-124 (32)), and the errors add up over several cuts
 * (T-110(i)). `-shortest` hides nothing about the desync — the
 * Layer 5 content reads (burst positions, frame luma) are what prove that.
 * What it still bounds is
 * a music bed LONGER than the picture, when the mix can be longer than the
 * voice at all. That depends on Duck (T-110(af), a product call still open):
 * with Duck OFF, `amix=duration=longest` runs to its longest input, so the
 * mix is max(voice, music) minus the cuts and overruns the cut picture
 * whenever the music outlasts the source; with Duck ON the bed goes through
 * `sidechaincompress`, which ends with its shorter input (the voice, which
 * keys it), so the ducked bed stops where the voice does and there is no
 * tail to trim.
 * `-shortest` trims that tail where there is one (it trims the END of the
 * audio, it moves nothing). With no cuts it also trims the few-millisecond
 * tail difference between a video and the audio track extracted from it.
 *
 * T-131 (2): the same flag ended the output where a SHORTER sound ended. A
 * Record take whose microphone dropped at 5 s of 12 re-attached to a 5.0 s
 * file, the picture cut off with it (measured; the stream-copy branch too).
 * The sound is now padded with silence to the picture's length
 * (`apad=whole_dur=<the picture's length after the cuts>`, finite: a bare
 * `apad` hangs `-c:v copy`), so `-shortest` ends the output at the PICTURE
 * whichever stream is shorter, and the music-bed bound above is unchanged.
 */
export async function runAudioMux(
  jobId: string,
  videoPath: string,
  audioPath: string,
  outputPath: string,
  onProgress: AudioProgressListener,
  cutRegions: CutRegion[] = []
): Promise<AudioJobResult> {
  const run = latch.begin(jobId)
  try {
    return await attachAudio(jobId, videoPath, audioPath, outputPath, onProgress, cutRegions, run)
  } finally {
    run.end()
  }
}

/**
 * `videoPath`'s probe, or null when ffprobe cannot read it (a recording with no duration). T-126 (24): the codec decides the copy, and a
 * copy of HEVC needs a tag the others do not. T-131 (2): the length decides the pad. A picture that cannot be read is neither: it is
 * re-encoded, and its sound is not padded (the old behavior: the output ends where the sound ends).
 */
async function probePicture(videoPath: string): Promise<ProbeResult | null> {
  try {
    return await probeVideo(videoPath)
  } catch {
    return null
  }
}

async function attachAudio(
  jobId: string,
  videoPath: string,
  audioPath: string,
  outputPath: string,
  onProgress: AudioProgressListener,
  cutRegions: CutRegion[],
  run: LatchRun
): Promise<AudioJobResult> {
  const startedAt = Date.now()
  const pictureCut = vselectForCuts(cutRegions)
  // T-111: the picture is copied only when an mp4 can carry it. A reopened project
  // re-attaches to the ORIGINAL video (a session that imported a .wmv muxed onto
  // the h264 working copy it had made; the saved project points at the .wmv), and
  // `-c:v copy` of wmv2 into mp4 died with "Could not find tag for codec wmv2". Such
  // a picture is re-encoded in this same step, exactly as a cut one is (a cut
  // already forces it), so the pass keeps its name and its bar — "attaching to
  // video" — and nothing is converted to a scratch file first.
  // A video that cannot be probed is re-encoded too: ffmpeg may still read what
  // ffprobe could not (a recording with no duration), and a copy of unknown video
  // is the one thing that can write a file nothing plays.
  // T-131 (2): the probe is also how long the picture is, once the cuts are taken out
  // of it, and a cut no longer skips it.
  const picture = await run.guard(probePicture(videoPath))
  const copyCodec = pictureCut === null && picture !== null && canStreamCopyIntoMp4(picture.videoCodec) ? picture.videoCodec.toLowerCase() : null
  const pictureSec = picture === null ? null : keptDurationSec(picture.duration, cutRegions)
  const reencodePicture = copyCodec === null
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
    ...(reencodePicture
      ? [
          // T-113: libx264 + yuv420p refuse an odd width or height, and a VP8/VP9 webm
          // (a screen recording) is where an odd size comes from. The stage is a crop (T-115):
          // it trims one pixel off the right and bottom edge and resamples nothing, and it runs
          // AHEAD of any cut, so the cut's `select` and `setpts` see the size the encoder will
          // get. An even picture passes through it untouched.
          '-vf',
          pictureCut ? `${EVEN_PICTURE},${pictureCut}` : EVEN_PICTURE,
          '-c:v',
          'libx264',
          '-preset',
          'medium',
          '-pix_fmt',
          'yuv420p',
          // `setpts` leaves the filter graph's output frame rate unknown. On the bundled
          // ffmpeg (7.0.x) the default is then a warning, "No information about the input
          // framerate", and a forced 25 fps CFR — duplicating frames, and turning a 60 fps
          // recording into a 25 fps one. On 6.1.1 (the shipped win32 major) there is no
          // warning and a 60 fps source stays 60/1 (measured on both, T-122): the forced rate
          // is the bundled major's behavior, not a rule. Passthrough keeps exactly the
          // frames `select` kept, on the timestamps `setpts` gave (and, for a picture
          // re-encoded only to fit an mp4, the source's own), whichever major runs it.
          // T-121: those timestamps are the survivors' OWN, moved earlier by the time the
          // cuts removed (`vselectForCuts`), never renumbered at the container's nominal
          // rate - a Record WebM reads 1000/1, which collapsed the kept picture to a few ms.
          '-fps_mode',
          'passthrough',
          // T-122: keep the filter graph's own time base for the encoder. On ffmpeg 6.1.1 (the shipped
          // win32 major) a constant-rate source gets an encoder time base of 1/fps, so every retimed stamp
          // above was ROUNDED onto the frame grid: a cut whose length is not a whole number of frames put
          // the first survivor on the frame before it (one `pts_time` written twice, "non-strictly-monotonic
          // PTS"). With `filter` the stamps land exactly where `setpts` put them. Verified on 6.1.1 and
          // 7.0.2 (7.0.2 is exact either way): Layer 5, "a cut that is not a whole number of frames long".
          '-enc_time_base:v',
          'filter'
        ]
      : [
          '-c:v',
          'copy',
          // T-126 (24): an HEVC picture copied into an mp4 is written with ffmpeg's default tag, `hev1`, which QuickTime, Safari and
          // iOS refuse to play (the file opens in VLC and in Chrome, and nowhere on a Mac or an iPhone). `hvc1` is the tag they read,
          // and a player that reads `hev1` reads `hvc1` too. The other copyable codecs keep the tag ffmpeg gives them.
          ...(copyCodec === 'hevc' ? ['-tag:v', 'hvc1'] : [])
        ]),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    // T-131 (2): the sound reaches the picture's length, so the `-shortest` below ends the output at the PICTURE when the sound is the
    // shorter stream (a take whose microphone dropped). Finite on purpose. A picture whose length is unknown is not padded.
    ...(pictureSec === null ? [] : ['-af', `apad=whole_dur=${pictureSec.toFixed(3)}`]),
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
  // on a long recording, and the output is as long as the (cut) picture: the
  // sound is padded or trimmed to it (T-131 (2)). A picture whose length is
  // unknown is measured against the cleaned audio, as it always was.
  const total = reencodePicture ? (pictureSec ?? (await run.guard(probeAudio(audioPath))).duration) : 0
  await runFfmpegJob(args, jobId, total, 'mux', onProgress, run, outputPath)
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
 * any failure, cancel or QUIT, whichever pass it came from. It lives here, in
 * main, rather than in the renderer, because only main can delete it on every
 * exit path — and because with mux-back OFF the exported audio file IS the
 * deliverable, which never goes through this function.
 *
 * T-127 (3): "on a quit" is true because this job holds a run of its own open
 * until the delete below has finished (the two passes open and close theirs
 * around each ffmpeg child, and the delete runs after the second one ends):
 * the before-quit handler waits, bounded, for every run to end
 * (`drainRuns`, cancelLatch.ts). Without it the process exited between the
 * kill and the unlink and the WAV stayed beside the output.
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
  // T-114: assertAlways - as assert() this logged and CONTINUED under
  // NODE_ENV=production and the `finally` below deleted the person's source
  // (proven by execution; `reattachCollision.test.ts` forces production on).
  assertAlways(
    tempAudioPath !== spec.sourcePath && tempAudioPath !== spec.videoPath,
    `intermediate audio path ${tempAudioPath} would overwrite a file this job reads`
  )
  const run = latch.begin(spec.jobId)
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
    run.end()
  }
  return { jobId: spec.jobId, outputPath: spec.outputPath, durationMs: Date.now() - startedAt }
}

export function cancelAudioJob(jobId: string): boolean {
  const marked = latch.cancel(jobId)
  const child = activeJobs.get(jobId)
  if (!child) return marked
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
  latch.cancelAll()
  for (const [, child] of activeJobs) killAsCancelled(child)
  activeJobs.clear()
  // T-111: the ffmpeg that pulls a recording's sound out is an audio job too.
  cancelAllExtractions()
}
