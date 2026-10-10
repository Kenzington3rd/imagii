import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useVideoStore } from './store/videoStore'
import { OutputDirLabel } from '../../components/OutputDirLabel'
import { PanelHeader } from '../../components/PanelHeader'
import { reportFailure } from '../../lib/reportFailure'
import { toastSaved } from '../../lib/savedToast'

type ReframePosition = 'left' | 'center' | 'right'

// This is a FIXED strip, not a tracker (T-85). Round 15 renamed "Smart" to
// "Auto (centered)" because it was only ever a centered crop, but the panel
// still said "Auto-reframe", the tutorial said it would "follow the action",
// and the fourth button duplicated Center. The code decides where the strip
// sits from the side you pick and nothing else, so the copy says that: three
// sides, no 'smart' value left to mislead (main's type and validator dropped
// it too — nothing ever persisted a position, so there is nothing to migrate).
const POSITIONS: Array<{ id: ReframePosition; label: string; hint: string }> = [
  { id: 'left', label: 'Left', hint: 'A 9:16 strip nearer the left edge' },
  { id: 'center', label: 'Center', hint: 'The middle 9:16 strip' },
  { id: 'right', label: 'Right', hint: 'A 9:16 strip nearer the right edge' }
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
  // Round 17 B1: hold the in-flight jobId so the Cancel button can target it.
  const jobIdRef = useRef<string | null>(null)

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
    // M13 fix (round 15): the previous `outDir!` referenced the React state,
    // which on the first run was still `null` AT the point of the IPC call —
    // setOutDir() hadn't been committed yet. Capture the resolved value in a
    // local and pass that down. This is a real correctness fix, not a
    // cosmetic !-removal.
    let resolvedOutDir = outDir
    if (!resolvedOutDir) {
      const picked = await window.api.video.pickOutputDir()
      if (!picked) return
      setOutDir(picked)
      resolvedOutDir = picked
    }
    setRunning(true)
    setProgress(0)
    setPhase('starting')
    const jobId = nanoid(10)
    jobIdRef.current = jobId
    try {
      const result = await window.api.video.reframe({
        jobId,
        sourcePath: source.filePath,
        outDir: resolvedOutDir,
        position,
        startSec: clip.startSec,
        endSec: clip.endSec,
        targetWidth: 1080,
        targetHeight: 1920
      })
      toastSaved('Saved the vertical version', result.outputPath)
    } catch (err) {
      reportFailure(err, { failed: 'Reframe failed.', canceled: 'Reframe canceled.' })
    } finally {
      setRunning(false)
      jobIdRef.current = null
    }
  }

  async function cancel(): Promise<void> {
    const id = jobIdRef.current
    if (!id) return
    await window.api.video.cancelReframe(id)
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm" data-tutorial="video-reframe">
      <PanelHeader
        icon="phone"
        actions={
          <span className="text-xs text-ink-dim">
            {source.probe.width}×{source.probe.height} → 1080×1920
          </span>
        }
      >
        Reframe to 9:16 (center crop)
      </PanelHeader>
      <p className="text-xs text-ink-dim">
        Cuts the trimmed range into a vertical 9:16 version for TikTok, Reels, and Shorts.
        It takes a fixed strip — it does not track faces or action.
      </p>
      <div className="grid grid-cols-3 gap-1.5">
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
          <OutputDirLabel outDir={outDir} />
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
          {/* Round 17 B1 */}
          <button
            className="btn-ghost px-2 py-1.5 text-xs text-danger hover:text-danger-soft"
            onClick={cancel}
            title="Cancel reframe"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  )
}
