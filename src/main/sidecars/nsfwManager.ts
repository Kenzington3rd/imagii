import type { NsfwResult, NsfwScore } from '../../shared/safety'
import { nudenetOnnxPath } from './paths'

interface OrtSession {
  inputNames: string[]
  outputNames: string[]
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
}

interface OrtTensor {
  data: Float32Array | Uint8Array
  dims: number[]
}

interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> }
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor
}

let ortPromise: Promise<OrtModule | null> | null = null

async function loadOrt(): Promise<OrtModule | null> {
  if (!ortPromise) {
    ortPromise = (async () => {
      try {
        const mod = (await import('onnxruntime-node')) as unknown as OrtModule
        return mod
      } catch {
        return null
      }
    })()
  }
  return ortPromise
}

let sessionPromise: Promise<OrtSession | null> | null = null

async function loadSession(): Promise<OrtSession | null> {
  const status = nudenetOnnxPath()
  if (!status.exists) return null
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await loadOrt()
      if (!ort) return null
      try {
        return await ort.InferenceSession.create(status.path)
      } catch {
        return null
      }
    })()
  }
  return sessionPromise
}

const BLOCKED_LABELS = new Set([
  'EXPOSED_GENITALIA_F',
  'EXPOSED_GENITALIA_M',
  'EXPOSED_BREAST_F',
  'EXPOSED_BUTTOCKS',
  'EXPOSED_ANUS'
])

const NSFW_LABELS = [
  'EXPOSED_BELLY',
  'EXPOSED_BUTTOCKS',
  'EXPOSED_BREAST_F',
  'EXPOSED_GENITALIA_F',
  'COVERED_GENITALIA_F',
  'EXPOSED_BREAST_M',
  'EXPOSED_GENITALIA_M'
]

const BLOCK_THRESHOLD = 0.6

export interface NsfwOptions {
  threshold?: number
}

async function preprocessImage(filePath: string, _size = 320): Promise<{
  data: Float32Array
  dims: number[]
} | null> {
  try {
    const sharpModule = (await import('sharp')).default
    const buffer = await sharpModule(filePath)
      .resize(_size, _size, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer()
    const f32 = new Float32Array(_size * _size * 3)
    for (let i = 0; i < buffer.length; i += 3) {
      const r = buffer[i] / 255
      const g = buffer[i + 1] / 255
      const b = buffer[i + 2] / 255
      const idx = i / 3
      f32[idx] = r
      f32[idx + _size * _size] = g
      f32[idx + 2 * _size * _size] = b
    }
    return { data: f32, dims: [1, 3, _size, _size] }
  } catch {
    return null
  }
}

export async function isNsfwAvailable(): Promise<boolean> {
  const session = await loadSession()
  return session !== null
}

export async function screenImage(
  filePath: string,
  options: NsfwOptions = {}
): Promise<NsfwResult> {
  const threshold = options.threshold ?? BLOCK_THRESHOLD
  const session = await loadSession()
  if (!session) {
    return { blocked: false, scores: [], reason: 'NSFW model not installed (skipping screen)' }
  }
  const ort = await loadOrt()
  if (!ort) {
    return { blocked: false, scores: [], reason: 'onnxruntime not available' }
  }
  const tensor = await preprocessImage(filePath)
  if (!tensor) {
    return { blocked: false, scores: [], reason: 'Could not decode image for screening' }
  }
  try {
    const inputName = session.inputNames[0] ?? 'input'
    const feeds: Record<string, OrtTensor> = {
      [inputName]: new ort.Tensor('float32', tensor.data, tensor.dims)
    }
    const output = await session.run(feeds)
    const firstOutputName = session.outputNames[0]
    const out = firstOutputName ? output[firstOutputName] : Object.values(output)[0]
    if (!out) return { blocked: false, scores: [] }
    const scores: NsfwScore[] = []
    const data = out.data as Float32Array
    const labelCount = Math.min(NSFW_LABELS.length, data.length)
    for (let i = 0; i < labelCount; i++) {
      const score = data[i]
      scores.push({ label: NSFW_LABELS[i] ?? `class_${i}`, score: Number(score.toFixed(4)) })
    }
    const blockedHit = scores.find(
      (s) => BLOCKED_LABELS.has(s.label) && s.score > threshold
    )
    return {
      blocked: Boolean(blockedHit),
      scores,
      reason: blockedHit ? `${blockedHit.label} (${blockedHit.score.toFixed(2)})` : undefined
    }
  } catch (err) {
    return {
      blocked: false,
      scores: [],
      reason: err instanceof Error ? err.message : 'NSFW screen failed'
    }
  }
}
