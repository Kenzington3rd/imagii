import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useVideoStore } from './store/videoStore'

interface Highlight {
  startSec: number
  endSec: number
  peakDb: number
  reason: string
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function HighlightPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const addClipFromRange = useVideoStore((s) => s.addClipFromRange)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [highlights, setHighlights] = useState<Highlight[] | null>(null)

  useEffect(() => {
    const off = window.api.video.onHighlightProgress((p) => {
      setProgress(p.percent)
    })
    return off
  }, [])

  if (!source) return null

  async function scan(): Promise<void> {
    if (!source) return
    setScanning(true)
    setProgress(0)
    try {
      const candidates = await window.api.video.findHighlights(source.filePath)
      setHighlights(candidates)
      if (candidates.length === 0) toast('No standout moments detected.', { icon: '🔍' })
      else toast.success(`Found ${candidates.length} candidates`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  function addAsClip(h: Highlight, index: number): void {
    addClipFromRange(`Highlight ${index + 1}`, h.startSec, h.endSec)
    toast.success('Clip added — see the Clips list')
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm" data-tutorial="video-highlights">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          ⚡ Auto-highlight finder
        </h3>
        <button
          className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
          onClick={scan}
          disabled={scanning}
        >
          {scanning ? 'Scanning…' : highlights ? 'Re-scan' : 'Scan VOD'}
        </button>
      </div>
      <p className="text-xs text-ink-dim">
        Analyzes audio loudness to surface moments where you (probably) reacted big — yells,
        laughter, hype.
      </p>
      {scanning ? (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${Math.round(progress)}%` }} />
          </div>
          <span className="font-mono w-10 text-right">{Math.round(progress)}%</span>
        </div>
      ) : null}
      {highlights && highlights.length > 0 ? (
        <ul className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {highlights.map((h, i) => (
            <li
              key={i}
              className="flex items-center gap-2 px-2 py-1.5 bg-bg-hover rounded text-xs"
            >
              <span className="font-mono">
                {formatTime(h.startSec)} → {formatTime(h.endSec)}
              </span>
              <span className="text-ink-dim">{h.peakDb.toFixed(1)} LUFS</span>
              <span className="text-ink-dim">· {h.reason}</span>
              <button
                className="ml-auto text-accent hover:underline"
                onClick={() => addAsClip(h, i)}
              >
                + Add as clip
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
