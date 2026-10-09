export interface AudioProbe {
  duration: number
  sampleRate: number
  channels: number
  codec: string
  bitrate: number
  format: string
  sizeBytes: number
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

/** Plain words for the phase an audio export is in (never the raw pass id). */
export const AUDIO_PASS_LABELS: Record<AudioJobProgress['pass'], string> = {
  measure: 'Measuring loudness…',
  render: 'Rendering…',
  mux: 'Attaching to video…'
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
