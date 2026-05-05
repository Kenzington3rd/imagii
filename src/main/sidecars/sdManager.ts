import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { aiOutputDir, modelsDir, sdExePath, sdModelPath, nudenetOnnxPath } from './paths'
import { isNsfwAvailable, screenImage } from './nsfwManager'
import type {
  AiInstallStatus,
  Txt2ImgRequest,
  GenerationResult,
  GeneratedImage,
  AiJobProgress,
  OutpaintRequest,
  InpaintRequest
} from '../../shared/ai'

export type AiProgressListener = (p: AiJobProgress) => void

export async function getInstallStatus(): Promise<AiInstallStatus> {
  const sd = sdExePath()
  const model = sdModelPath()
  const nsfw = nudenetOnnxPath()
  const nsfwReady = nsfw.exists ? await isNsfwAvailable() : false
  return {
    sdExeInstalled: sd.exists,
    sdExePath: sd.path,
    modelInstalled: model.exists,
    modelPath: model.path,
    modelSizeBytes: model.sizeBytes,
    nsfwModelInstalled: nsfwReady,
    nsfwModelPath: nsfw.path,
    modelsDir: modelsDir(),
    resourcesBinDir: path.dirname(sd.path),
    ready: sd.exists && model.exists
  }
}

async function ensureOutputDir(): Promise<string> {
  const dir = aiOutputDir()
  await mkdir(dir, { recursive: true })
  return dir
}

function spawnSd(args: string[], onLog?: (line: string) => void): Promise<number> {
  const sd = sdExePath()
  return new Promise((resolve, reject) => {
    const child = spawn(sd.path, args, { windowsHide: true })
    child.stderr.setEncoding('utf8')
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (onLog) chunk.split(/\r?\n/).forEach((l) => l && onLog(l))
    })
    child.stderr.on('data', (chunk: string) => {
      if (onLog) chunk.split(/\r?\n/).forEach((l) => l && onLog(l))
    })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? -1))
  })
}

function parseProgressLine(line: string): { step: number; total: number } | null {
  const m = line.match(/(\d+)\/(\d+)/)
  if (!m) return null
  const step = Number(m[1])
  const total = Number(m[2])
  if (!Number.isFinite(step) || !Number.isFinite(total) || total === 0) return null
  return { step, total }
}

async function runOneVariation(
  jobId: string,
  variationIdx: number,
  prompt: string,
  negative: string,
  baseArgs: string[],
  outputPath: string,
  totalVariations: number,
  onProgress: AiProgressListener
): Promise<GeneratedImage | null> {
  const status = await getInstallStatus()
  if (!status.ready) throw new Error('Stable Diffusion not installed')

  const seed =
    Number(baseArgs[baseArgs.indexOf('--seed') + 1]) || Math.floor(Math.random() * 1e9)

  const args = [
    '-m',
    status.modelPath,
    '--prompt',
    prompt,
    '--negative-prompt',
    negative,
    '--output',
    outputPath,
    ...baseArgs
  ]

  const code = await spawnSd(args, (line) => {
    const p = parseProgressLine(line)
    if (p) {
      const variationPercent = (p.step / p.total) * 100
      const overallPercent =
        ((variationIdx + variationPercent / 100) / totalVariations) * 100
      onProgress({
        jobId,
        phase: 'generating',
        variation: variationIdx,
        percent: Math.min(99, overallPercent),
        message: `${p.step}/${p.total}`
      })
    }
  })

  if (code !== 0) {
    return null
  }

  let filteredOut = false
  let filterReason: string | undefined
  onProgress({ jobId, phase: 'screening', variation: variationIdx })
  const screen = await screenImage(outputPath)
  if (screen.blocked) {
    filteredOut = true
    filterReason = screen.reason ?? 'Filtered by safety screen'
  }

  return {
    path: outputPath,
    url: '',
    seed,
    filteredOut,
    filterReason
  }
}

export async function runTxt2Img(
  req: Txt2ImgRequest,
  onProgress: AiProgressListener
): Promise<GenerationResult> {
  const startedAt = Date.now()
  const dir = await ensureOutputDir()
  const baseSeed = req.seed > 0 ? req.seed : Math.floor(Math.random() * 1e9)
  const variations = Math.max(1, Math.min(4, req.variations))
  const images: GeneratedImage[] = []

  onProgress({ jobId: req.jobId, phase: 'queued' })

  for (let i = 0; i < variations; i++) {
    const seed = baseSeed + i
    const outputPath = path.join(dir, `${req.jobId}-v${i}.png`)
    const baseArgs = [
      '--mode',
      'txt2img',
      '-W',
      String(req.width),
      '-H',
      String(req.height),
      '--steps',
      String(req.steps),
      '--cfg-scale',
      String(req.cfgScale),
      '--seed',
      String(seed)
    ]
    if (req.sampler) baseArgs.push('--sampling-method', req.sampler)

    const result = await runOneVariation(
      req.jobId,
      i,
      req.prompt,
      req.negativePrompt ?? '',
      baseArgs,
      outputPath,
      variations,
      onProgress
    )
    if (result) {
      result.seed = seed
      images.push(result)
    }
  }

  onProgress({ jobId: req.jobId, phase: 'done', percent: 100 })
  return {
    jobId: req.jobId,
    images,
    durationMs: Date.now() - startedAt
  }
}

export async function runInpaint(
  req: InpaintRequest,
  onProgress: AiProgressListener
): Promise<GenerationResult> {
  const startedAt = Date.now()
  const dir = await ensureOutputDir()
  const seed = req.seed > 0 ? req.seed : Math.floor(Math.random() * 1e9)
  const outputPath = path.join(dir, `${req.jobId}-inpaint.png`)
  const maskPath = path.join(dir, `${req.jobId}-mask.png`)

  await writeDataUrlToFile(req.maskDataUrl, maskPath)

  const baseArgs = [
    '--mode',
    'img2img',
    '-i',
    req.basePath,
    '--mask',
    maskPath,
    '--strength',
    '1.0',
    '--steps',
    String(req.steps),
    '--cfg-scale',
    String(req.cfgScale),
    '--seed',
    String(seed)
  ]

  const result = await runOneVariation(
    req.jobId,
    0,
    req.prompt,
    req.negativePrompt ?? '',
    baseArgs,
    outputPath,
    1,
    onProgress
  )

  onProgress({ jobId: req.jobId, phase: 'done', percent: 100 })
  return {
    jobId: req.jobId,
    images: result ? [{ ...result, seed }] : [],
    durationMs: Date.now() - startedAt
  }
}

export async function runOutpaint(
  req: OutpaintRequest,
  onProgress: AiProgressListener
): Promise<GenerationResult> {
  const startedAt = Date.now()
  const dir = await ensureOutputDir()
  const seed = req.seed > 0 ? req.seed : Math.floor(Math.random() * 1e9)
  const outputPath = path.join(dir, `${req.jobId}-outpaint.png`)
  const paddedPath = path.join(dir, `${req.jobId}-padded.png`)
  const maskPath = path.join(dir, `${req.jobId}-padmask.png`)

  await padImageForOutpaint(req.basePath, paddedPath, maskPath, req.direction, req.pixels)

  const baseArgs = [
    '--mode',
    'img2img',
    '-i',
    paddedPath,
    '--mask',
    maskPath,
    '--strength',
    '1.0',
    '--steps',
    String(req.steps),
    '--cfg-scale',
    String(req.cfgScale),
    '--seed',
    String(seed)
  ]

  const result = await runOneVariation(
    req.jobId,
    0,
    req.prompt,
    req.negativePrompt ?? '',
    baseArgs,
    outputPath,
    1,
    onProgress
  )

  onProgress({ jobId: req.jobId, phase: 'done', percent: 100 })
  return {
    jobId: req.jobId,
    images: result ? [{ ...result, seed }] : [],
    durationMs: Date.now() - startedAt
  }
}

async function writeDataUrlToFile(dataUrl: string, outPath: string): Promise<void> {
  const fs = await import('node:fs/promises')
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error('Invalid data URL')
  await fs.writeFile(outPath, Buffer.from(match[2], 'base64'))
}

async function padImageForOutpaint(
  inputPath: string,
  paddedPath: string,
  maskPath: string,
  direction: 'up' | 'down' | 'left' | 'right',
  pixels: number
): Promise<void> {
  const sharpModule = (await import('sharp')).default
  const meta = await sharpModule(inputPath).metadata()
  const w = meta.width ?? 512
  const h = meta.height ?? 512

  const ext = {
    top: direction === 'up' ? pixels : 0,
    bottom: direction === 'down' ? pixels : 0,
    left: direction === 'left' ? pixels : 0,
    right: direction === 'right' ? pixels : 0
  }
  const newW = w + ext.left + ext.right
  const newH = h + ext.top + ext.bottom

  await sharpModule(inputPath)
    .extend({
      top: ext.top,
      bottom: ext.bottom,
      left: ext.left,
      right: ext.right,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
      extendWith: 'mirror'
    })
    .png()
    .toFile(paddedPath)

  const maskBuffer = Buffer.alloc(newW * newH * 1, 0)
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const inOriginal =
        x >= ext.left && x < ext.left + w && y >= ext.top && y < ext.top + h
      maskBuffer[y * newW + x] = inOriginal ? 0 : 255
    }
  }

  await sharpModule(maskBuffer, {
    raw: { width: newW, height: newH, channels: 1 }
  })
    .png()
    .toFile(maskPath)
}
