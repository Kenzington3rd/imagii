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
  return err instanceof Error && err.message === NO_AUDIO_STREAM_MESSAGE
}

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
 * How long a file Audio Studio will open (T-123 (14)).
 *
 * The waveform is drawn from the WHOLE file, decoded in the renderer: measured in the built app, a 1 h WAV
 * took 3.25 GB of the renderer's memory and a 2 h one 6.5 GB, growing in step with the decoded sound. A 3 to 6 h
 * stream recording is 10 to 20 GB, which is a renderer that dies with its window looking alive and nothing said.
 * Two hours (about 6.5 GB at the limit) is the ceiling T-123 chose; past it the file is refused at load, with the reason.
 *
 * simplification: a flat ceiling on the length, not a computation of the memory. The upgrade is T-110(ao): peaks
 * computed in main and handed to wavesurfer as `peaks` + `duration` (the media element already streams the file
 * over the Range-capable imagii-file protocol), which needs no decode in the renderer and retires this ceiling.
 */
// simplification: a flat 2 h ceiling on the length, not a computation of the memory it needs; the upgrade is main-side peaks (T-110(ao)).
export const WAVEFORM_MAX_SEC = 2 * 60 * 60

/**
 * The sentence shown when `durationSec` is over the ceiling, or null when the file is short enough (or the
 * probe has no usable length, which the load's other checks answer for). A finished sentence: `userFacingError`
 * lets it stand alone, so every route to `loadSource` (the importer, Clean audio, a restored project) says it.
 *
 * T-124 (7): the way out depends on what the file is. A VIDEO can be cut down in Video Studio and the shorter file
 * opened; an audio-only file cannot, because Video Studio refuses a file with no picture and sends the person back to
 * Audio Studio, so the old single sentence led a sound-only file in a circle. An audio-only file is split in another app.
 * `source` is required so that a caller has to decide.
 */
export function waveformCeilingRefusal(durationSec: number, source: 'video' | 'audio'): string | null {
  if (!Number.isFinite(durationSec) || durationSec <= WAVEFORM_MAX_SEC) return null
  return (
    'That file is longer than 2 hours, which is more than Audio Studio can draw a waveform for without running out of memory. ' +
    (source === 'video'
      ? 'Export the part you want from Video Studio first, then open that shorter file.'
      : 'Split it into shorter files in another app first, then open one of them.')
  )
}

/**
 * What the person reads when the waveform cannot be drawn for a file that did open (T-123 (14)): wavesurfer
 * could not decode it (an ADPCM WAV, a damaged file) and the panel would otherwise sit there with no waveform and
 * no word. The advice is the importer's own for a format imagii cannot read.
 */
export const WAVEFORM_ERROR_MESSAGE =
  "Couldn't draw this file's waveform. It may be damaged or in a format imagii can't read here. Re-export it as WAV or MP3 and try again."
