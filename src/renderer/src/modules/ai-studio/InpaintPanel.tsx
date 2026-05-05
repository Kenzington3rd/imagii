import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import type { GeneratedImage } from '@shared/ai'
import { useAiStore } from './state/aiStore'

interface BrushStroke {
  points: Array<{ x: number; y: number }>
  size: number
}

export function InpaintPanel(): JSX.Element {
  const status = useAiStore((s) => s.status)
  const job = useAiStore((s) => s.job)
  const setJob = useAiStore((s) => s.setJob)
  const setProgress = useAiStore((s) => s.setProgress)

  const [basePath, setBasePath] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null)
  const [strokes, setStrokes] = useState<BrushStroke[]>([])
  const [brushSize, setBrushSize] = useState(40)
  const [drawing, setDrawing] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [steps, setSteps] = useState(20)
  const [cfgScale, setCfgScale] = useState(7)
  const [seed, setSeed] = useState(-1)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<GeneratedImage | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = window.api.ai.onProgress((p) => setProgress(p))
    return off
  }, [setProgress])

  useEffect(() => {
    if (!baseUrl) {
      setImageDims(null)
      return
    }
    const img = new Image()
    img.onload = () => setImageDims({ width: img.naturalWidth, height: img.naturalHeight })
    img.src = baseUrl
  }, [baseUrl])

  useEffect(() => {
    drawMask()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, imageDims])

  function drawMask(): void {
    const canvas = canvasRef.current
    if (!canvas || !imageDims) return
    canvas.width = imageDims.width
    canvas.height = imageDims.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(244, 114, 182, 0.6)'
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.6)'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of strokes) {
      ctx.lineWidth = stroke.size
      ctx.beginPath()
      stroke.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.stroke()
    }
  }

  function pointFromEvent(e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } | null {
    const container = containerRef.current
    if (!container || !imageDims) return null
    const rect = container.getBoundingClientRect()
    const scaleX = imageDims.width / rect.width
    const scaleY = imageDims.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    }
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>): void {
    if (!imageDims) return
    const p = pointFromEvent(e)
    if (!p) return
    setStrokes((prev) => [...prev, { points: [p], size: brushSize }])
    setDrawing(true)
  }

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>): void {
    if (!drawing) return
    const p = pointFromEvent(e)
    if (!p) return
    setStrokes((prev) => {
      const next = [...prev]
      next[next.length - 1] = {
        ...next[next.length - 1],
        points: [...next[next.length - 1].points, p]
      }
      return next
    })
  }

  function onMouseUp(): void {
    setDrawing(false)
  }

  function clearMask(): void {
    setStrokes([])
  }

  async function pickBase(): Promise<void> {
    const filePath = await window.api.video.pickFile()
    if (!filePath) return
    setBasePath(filePath)
    setBaseUrl(window.api.video.fileUrl(filePath))
    setStrokes([])
    setResult(null)
  }

  function buildBinaryMaskDataUrl(): string | null {
    const canvas = canvasRef.current
    if (!canvas || !imageDims) return null
    const out = document.createElement('canvas')
    out.width = imageDims.width
    out.height = imageDims.height
    const ctx = out.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#fff'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of strokes) {
      ctx.lineWidth = stroke.size
      ctx.beginPath()
      stroke.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.stroke()
    }
    return out.toDataURL('image/png')
  }

  async function run(): Promise<void> {
    if (!status?.ready) {
      toast.error('Stable Diffusion not installed — see the Setup card on the Generate tab.')
      return
    }
    if (!basePath) {
      toast.error('Pick a base image first')
      return
    }
    if (strokes.length === 0) {
      toast.error('Paint over the area you want to replace')
      return
    }
    const safety = await window.api.ai.checkPrompt(prompt)
    if (!safety.allowed) {
      toast.error(safety.friendlyMessage)
      return
    }
    const maskDataUrl = buildBinaryMaskDataUrl()
    if (!maskDataUrl) {
      toast.error('Failed to build mask')
      return
    }
    const jobId = nanoid(10)
    setJob({ jobId, phase: 'queued', percent: 0 })
    setRunning(true)
    try {
      const generation = await window.api.ai.inpaint({
        jobId,
        basePath,
        maskDataUrl,
        prompt,
        steps,
        cfgScale,
        seed
      })
      const image = generation.images[0]
      setResult(image ?? null)
      if (image?.filteredOut) toast(`Filtered: ${image.filterReason}`, { icon: '🛡' })
      else if (image) toast.success('Inpainted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Inpaint failed')
    } finally {
      setRunning(false)
      setJob(null)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="flex flex-col gap-3">
        <div className="card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Base image · paint over the area to replace
            </h3>
            <div className="flex items-center gap-2 text-xs">
              <button className="btn-ghost px-2 py-1" onClick={pickBase}>
                {basePath ? 'Change…' : 'Pick image…'}
              </button>
              {strokes.length > 0 ? (
                <button className="btn-ghost px-2 py-1" onClick={clearMask}>
                  Clear mask
                </button>
              ) : null}
            </div>
          </div>
          {baseUrl && imageDims ? (
            <div
              ref={containerRef}
              className="relative bg-bg-base rounded overflow-hidden cursor-crosshair select-none"
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              style={{
                aspectRatio: `${imageDims.width} / ${imageDims.height}`,
                maxHeight: '60vh',
                margin: '0 auto',
                width: '100%'
              }}
            >
              <img
                src={baseUrl}
                alt="base"
                className="w-full h-full object-contain pointer-events-none select-none"
                draggable={false}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none mix-blend-screen"
              />
            </div>
          ) : (
            <div className="bg-bg-hover rounded flex items-center justify-center h-40 text-sm text-ink-dim">
              Pick an image to inpaint
            </div>
          )}
        </div>

        {result ? (
          <div className="card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
              Result
            </h3>
            {result.filteredOut ? (
              <div className="bg-bg-hover rounded-md flex flex-col items-center justify-center p-6 text-center text-amber-300">
                <div className="text-3xl mb-2">🛡</div>
                <div className="font-semibold">Filtered</div>
                <div className="text-xs text-ink-muted mt-1">{result.filterReason}</div>
              </div>
            ) : (
              <img src={result.url} alt="result" className="w-full rounded" />
            )}
            <div className="text-xs text-ink-dim mt-2 font-mono">seed: {result.seed}</div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <div className="card p-4 flex flex-col gap-3 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Inpaint
          </h3>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">Brush size</span>
            <input
              type="range"
              min={5}
              max={120}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
            />
            <span className="text-xs font-mono text-ink-muted">{brushSize} px</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">Prompt for replacement</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="bg-bg-base rounded p-2 min-h-[80px] resize-y"
              placeholder="describe what should be in the masked area"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-muted">Steps</span>
              <input
                type="number"
                min={1}
                max={150}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value) || 20)}
                className="bg-bg-base rounded px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-muted">CFG</span>
              <input
                type="number"
                min={1}
                max={20}
                step={0.5}
                value={cfgScale}
                onChange={(e) => setCfgScale(Number(e.target.value) || 7)}
                className="bg-bg-base rounded px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs text-ink-muted">Seed</span>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value) || -1)}
                className="bg-bg-base rounded px-2 py-1 font-mono"
              />
            </label>
          </div>
          <button
            className="btn-primary px-4 py-2 disabled:opacity-50"
            onClick={run}
            disabled={running || !status?.ready || strokes.length === 0 || !prompt.trim()}
          >
            {running ? 'Inpainting…' : 'Inpaint'}
          </button>
          {job ? (
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <span className="uppercase tracking-wide">{job.phase}</span>
              {typeof job.percent === 'number' ? (
                <>
                  <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${Math.round(job.percent)}%` }}
                    />
                  </div>
                  <span className="font-mono w-10 text-right">
                    {Math.round(job.percent)}%
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
