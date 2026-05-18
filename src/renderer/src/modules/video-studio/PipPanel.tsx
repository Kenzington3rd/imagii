import { useState } from 'react'
import toast from 'react-hot-toast'
import { OutputDirLabel } from '../../components/OutputDirLabel'
import { PanelHeader } from '../../components/PanelHeader'

type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export function PipPanel(): JSX.Element {
  const [basePath, setBasePath] = useState<string | null>(null)
  const [overlayPath, setOverlayPath] = useState<string | null>(null)
  const [overlayWidth, setOverlayWidth] = useState(360)
  const [position, setPosition] = useState<Position>('bottom-right')
  const [margin, setMargin] = useState(32)
  const [outDir, setOutDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function pick(setter: (path: string | null) => void): Promise<void> {
    const f = await window.api.video.pickFile()
    if (f) setter(f)
  }

  async function pickDir(): Promise<void> {
    const d = await window.api.video.pickOutputDir()
    if (d) setOutDir(d)
  }

  async function run(): Promise<void> {
    if (!basePath || !overlayPath) {
      toast.error('Pick both files')
      return
    }
    let dir = outDir
    if (!dir) {
      dir = await window.api.video.pickOutputDir()
      if (!dir) return
      setOutDir(dir)
    }
    setBusy(true)
    try {
      const result = await window.api.video.pipComposite({
        basePath,
        overlayPath,
        outDir: dir,
        overlayWidth,
        position,
        margin
      })
      toast.success(
        <span>
          PiP done.{' '}
          <button
            className="underline"
            onClick={() => window.api.video.revealInFolder(result.outputPath)}
          >
            Show
          </button>
        </span>
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PiP failed')
    } finally {
      setBusy(false)
    }
  }

  function nameOf(path: string | null): string {
    if (!path) return 'none'
    const c = path.replace(/\\/g, '/')
    return c.substring(c.lastIndexOf('/') + 1)
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm">
      <PanelHeader icon="image">Picture-in-picture composite</PanelHeader>
      <p className="text-xs text-ink-dim">
        Overlay one video on top of another (e.g. webcam on screen). Audio comes from the base
        video.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          className="btn-ghost px-3 py-1.5 text-xs text-left truncate"
          onClick={() => pick(setBasePath)}
          title={basePath ?? ''}
        >
          Base: {nameOf(basePath)}
        </button>
        <button
          className="btn-ghost px-3 py-1.5 text-xs text-left truncate"
          onClick={() => pick(setOverlayPath)}
          title={overlayPath ?? ''}
        >
          Overlay: {nameOf(overlayPath)}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Overlay width</span>
          <input
            type="number"
            min={120}
            max={960}
            step={20}
            value={overlayWidth}
            onChange={(e) => setOverlayWidth(Number(e.target.value) || 360)}
            className="bg-bg-base rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Margin</span>
          <input
            type="number"
            min={0}
            max={200}
            step={4}
            value={margin}
            onChange={(e) => setMargin(Number(e.target.value) || 0)}
            className="bg-bg-base rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Position</span>
          <select
            className="bg-bg-base rounded px-1 py-1"
            value={position}
            onChange={(e) => setPosition(e.target.value as Position)}
          >
            <option value="top-left">Top L</option>
            <option value="top-right">Top R</option>
            <option value="bottom-left">Bot L</option>
            <option value="bottom-right">Bot R</option>
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={pickDir}>
          <OutputDirLabel outDir={outDir} />
        </button>
        <button
          className="btn-primary px-3 py-1.5 text-xs ml-auto disabled:opacity-50"
          disabled={busy}
          onClick={run}
        >
          {busy ? 'Compositing…' : 'Composite'}
        </button>
      </div>
    </div>
  )
}
