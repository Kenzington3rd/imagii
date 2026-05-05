export interface AiInstallStatus {
  sdExeInstalled: boolean
  sdExePath: string
  modelInstalled: boolean
  modelPath: string
  modelSizeBytes: number
  nsfwModelInstalled: boolean
  nsfwModelPath: string
  modelsDir: string
  resourcesBinDir: string
  ready: boolean
}

export type AiOperation = 'txt2img' | 'inpaint' | 'outpaint'

export interface Txt2ImgRequest {
  jobId: string
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  cfgScale: number
  seed: number
  sampler?: string
  variations: number
}

export type ExpandDirection = 'up' | 'down' | 'left' | 'right'

export interface OutpaintRequest {
  jobId: string
  basePath: string
  direction: ExpandDirection
  pixels: number
  prompt: string
  negativePrompt?: string
  steps: number
  cfgScale: number
  seed: number
}

export interface InpaintRequest {
  jobId: string
  basePath: string
  maskDataUrl: string
  prompt: string
  negativePrompt?: string
  steps: number
  cfgScale: number
  seed: number
}

export interface GeneratedImage {
  path: string
  url: string
  seed: number
  filteredOut: boolean
  filterReason?: string
}

export interface GenerationResult {
  jobId: string
  images: GeneratedImage[]
  durationMs: number
}

export interface AiJobProgress {
  jobId: string
  phase: 'safety' | 'queued' | 'generating' | 'screening' | 'done'
  variation?: number
  percent?: number
  message?: string
}
