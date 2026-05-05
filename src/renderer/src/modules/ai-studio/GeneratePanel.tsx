import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import { useAiStore } from './state/aiStore'

export function GeneratePanel(): JSX.Element {
  const status = useAiStore((s) => s.status)
  const job = useAiStore((s) => s.job)
  const setJob = useAiStore((s) => s.setJob)
  const setProgress = useAiStore((s) => s.setProgress)
  const generations = useAiStore((s) => s.generations)
  const setGenerations = useAiStore((s) => s.setGenerations)

  const [prompt, setPrompt] = useState('a serene mountain lake at sunrise, soft light, photorealistic')
  const [negativePrompt, setNegativePrompt] = useState(
    'lowres, blurry, watermark, text, signature'
  )
  const [width, setWidth] = useState(512)
  const [height, setHeight] = useState(512)
  const [steps, setSteps] = useState(20)
  const [cfgScale, setCfgScale] = useState(7)
  const [seed, setSeed] = useState(-1)
  const [variations, setVariations] = useState(2)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const off = window.api.ai.onProgress((p) => setProgress(p))
    return off
  }, [setProgress])

  async function run(): Promise<void> {
    if (!status?.ready) {
      toast.error('Stable Diffusion not installed — see the Setup card above.')
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
      const result = await window.api.ai.txt2img({
        jobId,
        prompt,
        negativePrompt,
        width,
        height,
        steps,
        cfgScale,
        seed,
        variations
      })
      setGenerations(result)
      const blocked = result.images.filter((i) => i.filteredOut).length
      if (blocked > 0) {
        toast(`${blocked} of ${result.images.length} images filtered for safety.`, {
          icon: '🛡',
          duration: 5000
        })
      } else {
        toast.success('Generated')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setRunning(false)
      setJob(null)
    }
  }

  const ready = Boolean(status?.ready)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="flex flex-col gap-3">
        <div className="card p-4 flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Prompt
          </h3>
          <textarea
            className="bg-bg-base rounded p-2 text-sm min-h-[80px] resize-y"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="describe what you want to generate"
          />
          <textarea
            className="bg-bg-base rounded p-2 text-xs min-h-[60px] resize-y text-ink-muted"
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="negative prompt (things to avoid)"
          />
          <div className="flex items-center gap-3 text-sm">
            <button
              className="btn-primary px-4 py-2 disabled:opacity-50"
              onClick={run}
              disabled={running || !ready}
            >
              {running ? 'Generating…' : 'Generate'}
            </button>
            {!ready ? (
              <span className="text-xs text-amber-300">
                Install Stable Diffusion in the Setup card to enable.
              </span>
            ) : null}
            {job ? (
              <div className="flex-1 flex items-center gap-2 text-xs text-ink-muted">
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
                {job.message ? <span className="font-mono">{job.message}</span> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
            Results
          </h3>
          {generations.length === 0 ? (
            <p className="text-sm text-ink-dim">
              Generated images will appear here. {!ready ? 'Install models first.' : ''}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {generations.map((img, i) => (
                <div key={i} className="relative">
                  {img.filteredOut ? (
                    <div className="aspect-square bg-bg-hover rounded-md flex flex-col items-center justify-center text-xs text-amber-300 p-3 text-center">
                      <div className="text-2xl mb-1">🛡</div>
                      <div className="font-semibold">Filtered</div>
                      <div className="text-ink-muted mt-1">{img.filterReason}</div>
                    </div>
                  ) : (
                    <img
                      src={img.url}
                      alt={`generation ${i}`}
                      className="w-full rounded-md"
                    />
                  )}
                  <div className="text-xs text-ink-dim mt-1 font-mono">seed: {img.seed}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="card p-4 flex flex-col gap-3 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Parameters
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-muted">Width</span>
              <input
                type="number"
                min={256}
                max={1024}
                step={64}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value) || 512)}
                className="bg-bg-base rounded px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-muted">Height</span>
              <input
                type="number"
                min={256}
                max={1024}
                step={64}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value) || 512)}
                className="bg-bg-base rounded px-2 py-1"
              />
            </label>
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
              <span className="text-xs text-ink-muted">CFG scale</span>
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
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs text-ink-muted">Variations</span>
              <input
                type="range"
                min={1}
                max={4}
                step={1}
                value={variations}
                onChange={(e) => setVariations(Number(e.target.value))}
              />
              <span className="text-xs font-mono text-ink-muted">{variations} image{variations === 1 ? '' : 's'}</span>
            </label>
          </div>
        </div>

        <div className="card p-3 text-xs text-ink-muted">
          <div className="font-medium text-ink-base mb-1">Tips</div>
          <ul className="list-disc pl-4 flex flex-col gap-1">
            <li>512×512 keeps VRAM use low (~2 GB).</li>
            <li>20 steps is fast; 30 is sharper.</li>
            <li>Reuse a seed to iterate on the same composition.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
