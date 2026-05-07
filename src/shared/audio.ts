export interface AudioProbe {
  duration: number
  sampleRate: number
  channels: number
  codec: string
  bitrate: number
  format: string
  sizeBytes: number
}

export type DenoiseStrength = 'off' | 'light' | 'medium' | 'aggressive'

export type CompressorPreset = 'off' | 'voice' | 'music' | 'mixed'

export interface CutRegion {
  startSec: number
  endSec: number
}

export type SecondaryTrackRole = 'music' | 'mic2' | 'gameaudio'

export interface SecondaryTrack {
  filePath: string
  fileName: string
  role: SecondaryTrackRole
  gainDb: number
  duckUnderPrimary: boolean
  matchLoudness?: boolean
}

export interface ChainSpec {
  denoise: DenoiseStrength
  hum60: boolean
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

export interface AudioExportSpec {
  jobId: string
  sourcePath: string
  outputPath: string
  chain: ChainSpec
  format: AudioOutputFormat
  bitrate?: string
}

export interface AudioMuxSpec {
  jobId: string
  videoPath: string
  audioPath: string
  outputPath: string
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
