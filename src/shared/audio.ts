import { ipcErrorMessage } from './ipcError'

export interface AudioProbe {
  duration: number
  sampleRate: number
  channels: number
  codec: string
  bitrate: number
  format: string
  sizeBytes: number
  /**
   * T-126 (7): the file has a real picture - a video stream that is not an attached cover image. Read from the streams, not
   * from the extension: an `.mkv` or `.mp4` can hold sound alone (a podcast, an AAC-in-MP4 voice memo), and an `.mp3` can carry
   * cover art as a "video" stream. Absent where nobody asked (the renderer's probe of a scratch WAV).
   */
  hasVideo?: boolean
}

/**
 * What `audio:extractFromVideo` answers (T-126 (7)): the scratch WAV, and whether the file it was taken from really has a picture.
 * `hasVideo` is null when the pre-extract probe could not read the file's STREAMS (a file ffprobe cannot parse): then, and only then, the
 * extension decides. A file the probe read but could not give a length (a MediaRecorder WebM and a crashed MKV carry no duration) still
 * answers, through `NoUsableDurationError` (T-127 (10)).
 */
export interface ExtractedSound {
  wavPath: string
  hasVideo: boolean | null
}

/**
 * What the audio probe throws for a file with no sound stream (T-125 (4)). The ONE probe outcome that is a verdict about the file:
 * `audio:extractFromVideo` refuses it (there is nothing to extract) and the importer words it ("no sound"), where every other probe
 * failure - no duration in a MediaRecorder WebM's header, a probe that cannot parse a crashed MKV - is a probe that could not
 * READ a length from a file that may extract fine. The text is what `importDiagnostics` matches, so both read it from here.
 */
export const NO_AUDIO_STREAM_MESSAGE = 'No audio stream found in file'

export function isNoAudioStreamError(err: unknown): boolean {
  // T-135 (11): read through the IPC envelope, so it answers in the renderer too (a probe that main threw arrives there as "Error invoking remote
  // method 'audio:probe': Error: No audio stream found in file"). The message must still be the verdict EXACTLY: a longer one is another failure.
  return err instanceof Error && ipcErrorMessage(err, '') === NO_AUDIO_STREAM_MESSAGE
}

/**
 * The refusal for a second track whose file has no sound in it (T-135 (11)), T-84 voice, a finished sentence `userFacingError` lets stand.
 * The export's `[1:a]` reference to such a file exits 234 with "matches no streams", which no known-cause pattern recognises, so the person
 * read the generic source / disk sentence - after a minutes-long loudness measurement when Even volume is on - about the WRONG file. The
 * export probes the second track first (and the panel when the file is picked) and says which file it is.
 */
export const SECOND_TRACK_NO_SOUND_MESSAGE = 'The second track has no sound in it. Remove it or pick another file.'

/**
 * The refusal for an export whose cuts remove everything (T-135 (12)), T-84 voice. ffmpeg exits 0 for such a chain having written a header-only
 * file (a 78-byte WAV, a few hundred bytes of AAC / MP3 framing) and "Cleaned audio exported" was said over nothing. "A mark" is what the cuts are
 * called on the waveform (`BAD_CUT`: "Click its mark to put it back").
 */
export const EVERYTHING_CUT_MESSAGE = 'Everything is cut out. Click a mark to put a part back.'

/**
 * What the audio probe throws when it READ the streams but the container gave no usable length (T-127 (10)): a MediaRecorder WebM and a
 * crashed MKV carry no duration in their header. It is still a probe that could not give a LENGTH, so every caller that treated the old
 * plain Error as "unreadable" keeps working (the message is unchanged), but it holds the answer the streams did give: whether the file has
 * a picture. `audio:extractFromVideo` reads it, so a durationless audio-only WebM or MKV is classified by what it contains and not by its
 * extension (which sent a sound-only file the video remedy and turned Re-attach on for it).
 */
export const NO_USABLE_DURATION_MESSAGE = 'ffprobe returned no usable duration for the audio stream'

export class NoUsableDurationError extends Error {
  readonly hasVideo: boolean
  constructor(hasVideo: boolean) {
    super(NO_USABLE_DURATION_MESSAGE)
    this.name = 'NoUsableDurationError'
    this.hasVideo = hasVideo
  }
}

export type DenoiseStrength = 'off' | 'light' | 'medium' | 'aggressive' | 'parametric'

/** Phase 3.3: parametric denoise. Maps to ffmpeg's afftdn filter. */
export interface DenoiseParams {
  /** Noise floor in dB. afftdn `nf` parameter. Real afftdn range: -80..-20. */
  noiseFloorDb: number
  /** Reduction in dB. afftdn `nr` parameter. Real afftdn floor is 0.01; UI uses 1..50. */
  reductionDb: number
  /**
   * Round 18: no longer emitted — afftdn has no `ns` option (every export
   * that included it failed to parse). Kept optional so presets saved by
   * older builds still round-trip.
   */
  sensitivity?: number
}

export const DEFAULT_DENOISE_PARAMS: DenoiseParams = {
  noiseFloorDb: -25,
  reductionDb: 12,
  sensitivity: 0
}

export type CompressorPreset = 'off' | 'voice' | 'music' | 'mixed'

export interface CutRegion {
  startSec: number
  endSec: number
}

export type SecondaryTrackRole = 'music' | 'mic2' | 'gameaudio'

/** Phase 3.2: parameters for the FFmpeg sidechaincompress filter. */
export interface DuckingParams {
  /** Primary's level above which the secondary starts compressing. -60..0 dBFS. */
  thresholdDb: number
  /** Compression ratio. 1..20. */
  ratio: number
  /** Attack in ms. 1..200. */
  attackMs: number
  /** Release in ms. 50..2000. */
  releaseMs: number
}

export const DEFAULT_DUCK_PARAMS: DuckingParams = {
  // Equivalent in linear: ~0.05 (the previous hardcoded threshold).
  thresholdDb: -26,
  ratio: 8,
  attackMs: 20,
  releaseMs: 400
}

export interface SecondaryTrack {
  filePath: string
  fileName: string
  role: SecondaryTrackRole
  gainDb: number
  duckUnderPrimary: boolean
  matchLoudness?: boolean
  /** Phase 3.2: optional ducking params; falls back to DEFAULT_DUCK_PARAMS. */
  duckParams?: DuckingParams
}

/**
 * The loudness target `loudnorm` accepts, in LUFS (T-111): its `I` option is
 * -70..-5, and the Levels panel's number box had no limit at all, so a typed -3
 * passed the old 0 ceiling and reached ffmpeg, which refused it
 * ("Value -3.0 for parameter 'I' out of range [-70 - -5]") as a bare "Export
 * failed.".
 */
export const LOUDNESS_TARGET_LUFS = { min: -70, max: -5 } as const

/**
 * What a loudness target someone typed becomes (T-112): itself inside loudnorm's range, the
 * nearest edge outside it, and the current target when what they typed is not a number.
 * The Levels panel's box runs this when typing ends — the box cannot refuse a keystroke
 * (`min`/`max` only mark it invalid), and the way to -23 passes through -2.
 */
export function commitLoudnessTarget(typed: string, current: number): number {
  if (typed.trim() === '') return current
  const n = Number(typed)
  if (!Number.isFinite(n)) return current
  return Math.min(LOUDNESS_TARGET_LUFS.max, Math.max(LOUDNESS_TARGET_LUFS.min, n))
}

/** True for a loudness target `loudnorm` will take. */
export function isLoudnessTarget(v: unknown): v is number {
  return typeof v === 'number' && v >= LOUDNESS_TARGET_LUFS.min && v <= LOUDNESS_TARGET_LUFS.max
}

/**
 * What a second track's numbers may be (T-111). Every one of them is printed into
 * the filter graph (`volume=${gainDb}dB`, `sidechaincompress=ratio=${ratio}:...`),
 * and a project file is a file a person can edit: a `gainDb` of
 * `"0dB,ametadata=mode=print:file=x"` is not a number but it is a filter, and
 * `ametadata` writes the file it is told to. The ranges are the panel's sliders
 * (gain -24..12 there; -60..12 here so an old project is never refused for a
 * generous setting) and the `DuckingParams` doc comments above.
 */
export const SECONDARY_GAIN_DB = { min: -60, max: 12 } as const
export const DUCK_LIMITS = {
  thresholdDb: { min: -60, max: 0 },
  ratio: { min: 1, max: 20 },
  attackMs: { min: 1, max: 200 },
  releaseMs: { min: 50, max: 2000 }
} as const

function isNumberIn(v: unknown, range: { min: number; max: number }): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= range.min && v <= range.max
}

/**
 * The first thing wrong with a second track's gain or ducking numbers, as the
 * path-shaped detail a console line wants — or `null` when they are all
 * numbers inside their ranges. Pure, so main's IPC gate and the project
 * validator hold the SAME line.
 */
export function secondaryTrackProblem(secondary: Record<string, unknown>): string | null {
  if (!isNumberIn(secondary.gainDb, SECONDARY_GAIN_DB)) {
    return `secondaryTrack.gainDb must be a number in [${SECONDARY_GAIN_DB.min}, ${SECONDARY_GAIN_DB.max}]`
  }
  const duck = secondary.duckParams
  if (duck === undefined || duck === null) return null
  if (typeof duck !== 'object' || Array.isArray(duck)) return 'secondaryTrack.duckParams must be an object'
  const fields = duck as Record<string, unknown>
  for (const key of Object.keys(DUCK_LIMITS) as Array<keyof typeof DUCK_LIMITS>) {
    const range = DUCK_LIMITS[key]
    if (!isNumberIn(fields[key], range)) {
      return `secondaryTrack.duckParams.${key} must be a number in [${range.min}, ${range.max}]`
    }
  }
  return null
}

/**
 * T-90: the mains frequency the hum notch is tuned to. 60 Hz is the US/Canada
 * grid, 50 Hz most of the rest of the world — a notch at the wrong one removes
 * nothing. It is a TWO-value type on purpose: `chain.ts` interpolates it into
 * a filter string, so only these literals may ever reach ffmpeg.
 */
export type MainsHz = 50 | 60

export interface ChainSpec {
  denoise: DenoiseStrength
  /** Phase 3.3: parameters used when denoise === 'parametric'. */
  denoiseParams?: DenoiseParams
  /**
   * Hum removal on/off. The name is from when 60 Hz was the only choice and
   * is kept because it is stored in saved projects and presets; the
   * frequency is `humHz`.
   */
  hum60: boolean
  /** T-90: which mains the notch targets. Absent (every project and preset
   *  saved before 50 Hz existed) means 60, which is what they always did. */
  humHz?: MainsHz
  rumbleHighpass: boolean
  deEss: boolean
  compressor: CompressorPreset
  loudnorm: boolean
  loudnormTargetLufs: number
  gainDb: number
  cutRegions: CutRegion[]
  secondaryTrack?: SecondaryTrack | null
}

export const DEFAULT_CHAIN_SPEC: ChainSpec = {
  denoise: 'off',
  hum60: false,
  rumbleHighpass: false,
  deEss: false,
  compressor: 'off',
  loudnorm: false,
  loudnormTargetLufs: -16,
  gainDb: 0,
  cutRegions: [],
  secondaryTrack: null
}

export type AudioOutputFormat = 'mp3' | 'wav' | 'flac' | 'aac'

/**
 * What the save dialog and the suggested file name are asked for: an export
 * format, or `mp4` for "Re-attach to video" (the cleaned sound back on the
 * picture). The renderer has always asked for the second with the first
 * list's validator in the way — see `audio:pickOutputFile`.
 */
export const AUDIO_SAVE_FORMATS = ['mp3', 'wav', 'flac', 'aac', 'mp4'] as const
export type AudioSaveFormat = (typeof AUDIO_SAVE_FORMATS)[number]

/**
 * The file extension a format is saved under (T-90). The AAC option writes
 * `.m4a`: ffmpeg picks the container from the extension, and a bare `.aac` is
 * a raw ADTS stream that most players, editors and upload forms do not treat
 * as a normal audio file. The codec is the same either way — only the
 * container around it changes.
 */
export function audioFileExtension(format: AudioSaveFormat): string {
  return format === 'aac' ? 'm4a' : format
}

/** The Export panel's format names. AAC says what the file will be called. */
export const AUDIO_FORMAT_LABELS: Record<AudioOutputFormat, string> = {
  mp3: 'MP3',
  wav: 'WAV',
  flac: 'FLAC',
  aac: 'AAC (.m4a)'
}

/** Plain words for what each pass is doing (never the raw pass id). */
const AUDIO_PASS_WORDS: Record<AudioJobProgress['pass'], string> = {
  measure: 'measuring loudness',
  render: 'rendering',
  mux: 'attaching to video'
}

/**
 * The passes an export will make, in the order it makes them. Loudness
 * normalization measures first (the render can only start once it has the
 * numbers); re-attaching to a video renders to a scratch file and then puts it
 * on the picture. Each pass reports its own 0-100%, so the bar restarts at 0 at
 * every one of them.
 */
export function audioPassPlan(opts: {
  loudnorm: boolean
  reattach: boolean
}): Array<AudioJobProgress['pass']> {
  return [
    ...(opts.loudnorm ? (['measure'] as const) : []),
    'render',
    ...(opts.reattach ? (['mux'] as const) : [])
  ]
}

/**
 * What the progress row says for the pass an export is in (T-100). The bar
 * restarting at 0 at each pass read as a stall — the render "went backwards"
 * from the measure's 100% — so a multi-pass export names where it is in its
 * steps ("Step 2 of 2 — rendering"), which makes the restart read as the next
 * step starting. A single-pass export has no steps to count and just says
 * "Rendering…".
 */
export function audioPassLabel(
  pass: AudioJobProgress['pass'],
  plan: ReadonlyArray<AudioJobProgress['pass']>
): string {
  const step = plan.indexOf(pass) + 1
  if (plan.length < 2 || step === 0) {
    const word = AUDIO_PASS_WORDS[pass]
    return `${word.charAt(0).toUpperCase()}${word.slice(1)}…`
  }
  return `Step ${step} of ${plan.length} — ${AUDIO_PASS_WORDS[pass]}`
}

export interface AudioExportSpec {
  jobId: string
  sourcePath: string
  outputPath: string
  chain: ChainSpec
  format: AudioOutputFormat
  bitrate?: string
}

/**
 * "Re-attach to video": render `chain` over `sourcePath` (the video's own
 * extracted track) and put the result back on `videoPath`'s picture as
 * `outputPath` (.mp4). The intermediate audio file never crosses the IPC
 * boundary — main names it, and main deletes it.
 */
export interface AudioMuxSpec {
  jobId: string
  /** The recording whose picture is kept — and cut where the audio is. */
  videoPath: string
  /** The audio the chain is rendered from (the video's extracted track). */
  sourcePath: string
  outputPath: string
  chain: ChainSpec
}

export interface AudioJobProgress {
  jobId: string
  pass: 'measure' | 'render' | 'mux'
  percent: number
  timemark?: string
}

export interface AudioJobResult {
  jobId: string
  outputPath: string
  durationMs: number
}

/**
 * T-129: how many points the waveform is drawn from, and so the most a peaks answer carries over IPC.
 *
 * The waveform used to be drawn from the WHOLE file, decoded in the renderer (wavesurfer's `url` alone): a 1 h WAV took
 * 3.25 GB of the renderer's memory and a 2 h one 6.5 GB (measured, sweep 12), so T-123 refused anything over two hours.
 * Main now reads the sound as a stream (`main/audio/peaks.ts`) and folds it into this many highest/lowest pairs, whatever
 * the length: 4000 is more bars than the panel has pixels at any window size (wavesurfer's own `exportPeaks` default is
 * 8000 for its line mode), and two arrays of it are about 64 KB however long the recording is.
 */
export const PEAK_BUCKETS = 4000

/**
 * What `audio:peaks` answers (T-129): the waveform of a file, drawn by wavesurfer from these numbers and never from the
 * file. `peaks[0]` is each bucket's highest sample and `peaks[1]` its lowest (-1..1), which is how wavesurfer's bars read
 * two channels (the first is the top half, the second the bottom). `duration` is the length the buckets span, in seconds:
 * the file's probed length, which is what the media element plays.
 */
export interface WaveformPeaks {
  peaks: [number[], number[]]
  duration: number
}

/** The peaks job's progress (T-129): how much of the sound it has read, 0-100. */
export interface WaveformPeaksProgress {
  jobId: string
  percent: number
}

/**
 * True for a peaks answer the waveform can be drawn from: two equally long arrays of 1 to `PEAK_BUCKETS` numbers in -1..1
 * and a positive length. What crosses IPC is checked where it lands (the renderer is not the only thing that could answer),
 * and wavesurfer throws on an empty array or a zero duration.
 */
export function isWaveformPeaks(value: unknown): value is WaveformPeaks {
  if (typeof value !== 'object' || value === null) return false
  const { peaks, duration } = value as Record<string, unknown>
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return false
  if (!Array.isArray(peaks) || peaks.length !== 2) return false
  const [high, low] = peaks as unknown[]
  if (!Array.isArray(high) || !Array.isArray(low)) return false
  if (high.length === 0 || high.length > PEAK_BUCKETS || low.length !== high.length) return false
  const inRange = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= -1 && v <= 1
  return high.every(inRange) && low.every(inRange)
}

/**
 * T-132 (5): the loudest sample of a peaks answer, in EITHER half - the number wavesurfer is told to scale the whole waveform by.
 * Its `normalize` option finds that number itself, but in channel 0 (the highs) alone, so a take whose lows run louder than its highs
 * (a mic with a DC offset, an asymmetric voice) was scaled to the quieter half and its bottom bars were drawn past the canvas edge.
 * 0 for silence or for nothing, which wavesurfer reads as "no fixed peak" and scales as it always did.
 */
export function peaksMaxMagnitude(peaks: [number[], number[]]): number {
  let max = 0
  for (const half of peaks) {
    for (const value of half) {
      const magnitude = Math.abs(value)
      if (magnitude > max) max = magnitude
    }
  }
  return max
}

/**
 * The refusal at load when main cannot read a file's sound to draw its waveform (T-129, T-84 voice): ffmpeg could not decode
 * it. The export reads the sound the same way, so a file this refuses could not be cleaned either; the studio never holds it.
 * Every route to `loadSource` (the importer, Clean audio, a restored project) shows it as written (`userFacingError`). T-133 (10): the file
 * it fires on in practice IS a WAV (one whose format tag no decoder knows), so the advice names the kind that reads - "a standard PCM WAV" -
 * as `PLAYBACK_ERROR_MESSAGE` does since T-132 (10); a bare "WAV or MP3" sent that file back to the format it is in.
 */
export const WAVEFORM_READ_FAILED =
  "imagii couldn't read the sound in this file to draw its waveform. It may be damaged or in a format imagii can't read here. Re-export it as a standard PCM WAV or MP3 and try again."

/**
 * What the person reads when the PLAYER cannot play a file that opened (T-123 (14), reworded by T-129 and T-132 (10)): the waveform
 * is drawn from main's peaks, so an ADPCM WAV (ffmpeg reads it, Chromium's media element does not) shows its waveform, and what fails
 * is playback alone. The sentence says what still works (the person's next worry is whether the file is lost), and the advice is not
 * circular for the file that fails here: that file already IS a WAV, so a WAV owner is told which kind plays - "a standard PCM WAV".
 */
export const PLAYBACK_ERROR_MESSAGE =
  "imagii can't play this file here, but the waveform, cuts and export still work on it. To hear it, re-export it as a standard PCM WAV or MP3."
