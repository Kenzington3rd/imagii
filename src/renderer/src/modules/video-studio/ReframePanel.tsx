import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useVideoStore } from './store/videoStore'

type ReframePosition = 'left' | 'center' | 'right' | 'smart'

const POSITIONS: Array<{ id: ReframePosition; label: string; hint: string }> = [
  { id: 'center', label: 'Center', hint: 'Middle 9:16 strip' },
  { id: 'left', label: 'Left', hint: 'Left third (action camera)' },
  { id: 'right', label: 'Right', hint: 'Right third' },
  { id: 'smart', label: 'Smart', hint: 'Center with letterbox detection' }
]

export function ReframePanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const [position, setPosition] = useState<ReframePosition>('center')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<string>('')
  const [outDir, setOutDir] = useState<string | null>(null)

  useEffect(() => {
    const off = window.api.video.onReframeProgress((p) => {
      setProgress(p.percent)
      setPhase(p.phase)
    })
    return off
  }, [])

  if (!source) return null
  const clip = clips.find((c) => c.id === selectedClipId)
  if (!clip) return null

  const isHorizontal = source.probe.width > source.probe.height
  if (!isHorizontal) return null

  async function pickDir(): Promise<void> {
    const picked = await window.api.video.pickOutputDir()
    if (picked) setOutDir(picked)
  }

  async function reframe(): Promise<void> {
    if (!source || !clip) return
    if (!outDir) {
      const picked = await window.api.video.pickOutputDir()
      if (!picked) return
      setOutDir(picked)
    }
    setRunning(true)
    setProgress(0)
    setPhase('starting')
    try {
      const result = await window.api.video.reframe({
        sourcePath: source.filePath,
        outDir: outDir!,
        position,
        startSec: clip.startSec,
        endSec: clip.endSec,
        targetWidth: 1080,
        targetHeight: 1920
      })
      toast.success(
        <span>
          Vertical version saved.{' '}
          <button
            className="underline"
            onClick={() => window.api.video.revealInFolder(result.outputPath)}
          >
            Show
          </button>
        </span>
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reframe failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm" data-tutorial="video-reframe">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          📱 Auto-reframe to 9:16
        </h3>
        <span className="text-xs text-ink-dim">
          {source.probe.width}×{source.probe.height} → 1080×1920
        </span>
      </div>
      <p className="text-xs text-ink-dim">
        Crop the trimmed range to a vertical version for TikTok / Reels.
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {POSITIONS.map((p) => (
          <button
            key={p.id}
            title={p.hint}
            onClick={() => setPosition(p.id)}
            className={`px-2 py-1.5 text-xs rounded border ${
              position === p.id
                ? 'bg-accent text-bg-base border-accent'
                : 'bg-bg-hover border-ink-dim/30 hover:border-accent'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={pickDir}>
          {outDir ? `📁 ${outDir.split(/[\\/]/).pop()}` : 'Choose folder…'}
        </button>
        <button
          className="btn-primary px-4 py-1.5 ml-auto disabled:opacity-50"
          disabled={running}
          onClick={reframe}
        >
          {running ? 'Reframing…' : 'Reframe to 9:16'}
        </button>
      </div>
      {running ? (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="uppercase tracking-wide">{phase}</span>
          <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${Math.round(progress)}%` }} />
          </div>
          <span className="font-mono w-10 text-right">{Math.round(progress)}%</span>
        </div>
      ) : null}
    </div>
  )
}
