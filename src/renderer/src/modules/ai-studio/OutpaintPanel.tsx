import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import type { ExpandDirection, GeneratedImage } from '@shared/ai'
import { useAiStore } from './state/aiStore'

const DIRECTIONS: Array<{ id: ExpandDirection; icon: string; label: string }> = [
  { id: 'up', icon: '↑', label: 'Up' },
  { id: 'down', icon: '↓', label: 'Down' },
  { id: 'left', icon: '←', label: 'Left' },
  { id: 'right', icon: '→', label: 'Right' }
]

export function OutpaintPanel(): JSX.Element {
  const status = useAiStore((s) => s.status)
  const job = useAiStore((s) => s.job)
  const setJob = useAiStore((s) => s.setJob)
  const setProgress = useAiStore((s) => s.setProgress)

  const [basePath, setBasePath] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  const [direction, setDirection] = useState<ExpandDirection>('right')
  const [pixels, setPixels] = useState(256)
  const [prompt, setPrompt] = useState('')
  const [steps, setSteps] = useState(20)
  const [cfgScale, setCfgScale] = useState(7)
  const [seed, setSeed] = useState(-1)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<GeneratedImage | null>(null)

  useEffect(() => {
    const off = window.api.ai.onProgress((p) => setProgress(p))
    return off
  }, [setProgress])

  async function pickBase(): Promise<void> {
    const filePath = await window.api.video.pickFile()
    if (!filePath) return
    setBasePath(filePath)
    setBaseUrl(window.api.video.fileUrl(filePath))
    setResult(null)
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
    const safety = await window.api.ai.checkPrompt(prompt)
    if (!safety.allowed) {
      toast.error(safety.friendlyMessage)
      return
    }
    const jobId = nanoid(10)
    setJob({ jobId, phase: 'queued', percent: 0 })
    setRunning(true)
    try {
      const generation = await window.api.ai.outpaint({
        jobId,
        basePath,
        direction,
        pixels,
        prompt,
        steps,
        cfgScale,
        seed
      })
      const image = generation.images[0]
      setResult(image ?? null)
      if (image?.filteredOut) {
        toast(`Filtered: ${image.filterReason}`, { icon: '🛡' })
      } else if (image) {
        toast.success('Expanded')
      } else {
        toast.error('No image produced')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Outpaint failed')
    } finally {
      setRunning(false)
      setJob(null)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="flex flex-col gap-3">
        <div className="card p-4 flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Base image
          </h3>
          {baseUrl ? (
            <div className="relative bg-bg-base rounded overflow-hidden flex justify-center">
              <img
                src={baseUrl}
                alt="base"
                className="max-h-80 object-contain"
              />
            </div>
          ) : (
            <div className="bg-bg-hover rounded flex items-center justify-center h-40 text-sm text-ink-dim">
              Pick an image to expand
            </div>
          )}
          <button className="btn-ghost px-3 py-1.5 text-sm self-start" onClick={pickBase}>
            {basePath ? 'Change image…' : 'Pick image…'}
          </button>
        </div>

        {result ? (
          <div className="card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
              Expanded result
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
            Expand
          </h3>
          <div>
            <div className="text-xs text-ink-muted mb-1.5">Direction</div>
            <div className="grid grid-cols-4 gap-1.5">
              {DIRECTIONS.map((d) => (
                <button
                  key={d.id}
                  className={`px-3 py-2 rounded border text-sm ${
                    direction === d.id
                      ? 'bg-accent text-bg-base border-accent'
                      : 'bg-bg-hover border-ink-dim/30 hover:border-accent'
                  }`}
                  onClick={() => setDirection(d.id)}
                  title={d.label}
                >
                  {d.icon}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">Pixels to add</span>
            <input
              type="number"
              min={64}
              max={1024}
              step={64}
              value={pixels}
              onChange={(e) => setPixels(Number(e.target.value) || 256)}
              className="bg-bg-base rounded px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">Prompt for new region</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="bg-bg-base rounded p-2 text-sm min-h-[80px] resize-y"
              placeholder="describe what should appear in the expanded area"
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
              <span className="text-xs text-ink-muted">Seed (−1 = random)</span>
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
            disabled={running || !status?.ready || !basePath || !prompt.trim()}
          >
            {running ? 'Expanding…' : 'Expand'}
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
