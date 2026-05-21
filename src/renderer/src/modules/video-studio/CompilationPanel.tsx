import { useState } from 'react'
import toast from 'react-hot-toast'
import { useVideoStore } from './store/videoStore'
import { OutputDirLabel } from '../../components/OutputDirLabel'
import { PanelHeader } from '../../components/PanelHeader'

export function CompilationPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const [fadeMs, setFadeMs] = useState(300)
  const [outDir, setOutDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!source || clips.length < 2) return null

  async function pickDir(): Promise<void> {
    const picked = await window.api.video.pickOutputDir()
    if (picked) setOutDir(picked)
  }

  async function exportCompilation(): Promise<void> {
    if (!source) return
    let dir = outDir
    if (!dir) {
      dir = await window.api.video.pickOutputDir()
      if (!dir) return
      setOutDir(dir)
    }
    setBusy(true)
    try {
      const targetW = 1920
      const targetH = 1080
      const result = await window.api.video.concat({
        sourcePath: source.filePath,
        outDir: dir,
        segments: clips.map((c) => ({
          startSec: c.startSec,
          endSec: c.endSec,
          name: c.name
        })),
        fadeMs,
        width: targetW,
        height: targetH
      })
      toast.success(
        <span>
          Compilation saved.{' '}
          <button
            className="underline"
            onClick={() => window.api.video.revealInFolder(result.outputPath)}
          >
            Show
          </button>
        </span>
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Compilation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm">
      <PanelHeader icon="film">Compile clips ({clips.length})</PanelHeader>
      <p className="text-xs text-ink-dim">
        Stitch all clips into one 1920×1080 montage MP4 with optional crossfades. Order = clip
        list order.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <span className="text-ink-muted w-16">Fade</span>
        <input
          type="range"
          min={0}
          max={1500}
          step={50}
          value={fadeMs}
          onChange={(e) => setFadeMs(Number(e.target.value))}
          className="flex-1"
          // M11 fix (round 15): name + formatted value for AT.
          aria-label="Crossfade duration in milliseconds"
          aria-valuetext={`${fadeMs} milliseconds`}
        />
        <span className="font-mono w-14 text-right">{fadeMs} ms</span>
      </label>
      <div className="flex items-center gap-2">
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={pickDir}>
          <OutputDirLabel outDir={outDir} />
        </button>
        <button
          className="btn-primary px-3 py-1.5 text-xs ml-auto disabled:opacity-50"
          disabled={busy}
          onClick={exportCompilation}
        >
          {busy ? 'Stitching…' : 'Compile'}
        </button>
      </div>
    </div>
  )
}
