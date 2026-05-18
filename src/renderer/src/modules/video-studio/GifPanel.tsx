import { useState } from 'react'
import toast from 'react-hot-toast'
import { useVideoStore } from './store/videoStore'
import { OutputDirLabel } from '../../components/OutputDirLabel'
import { PanelHeader } from '../../components/PanelHeader'

export function GifPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const [width, setWidth] = useState(480)
  const [fps, setFps] = useState(15)
  const [speed, setSpeed] = useState(1)
  const [busy, setBusy] = useState(false)
  const [outDir, setOutDir] = useState<string | null>(null)

  if (!source) return null
  const clip = clips.find((c) => c.id === selectedClipId)
  if (!clip) return null

  const duration = clip.endSec - clip.startSec
  const tooLong = duration > 10

  async function pickDir(): Promise<void> {
    const picked = await window.api.video.pickOutputDir()
    if (picked) setOutDir(picked)
  }

  async function exportGif(): Promise<void> {
    if (!source || !clip) return
    let dir = outDir
    if (!dir) {
      dir = await window.api.video.pickOutputDir()
      if (!dir) return
      setOutDir(dir)
    }
    setBusy(true)
    try {
      const result = await window.api.video.exportGif({
        sourcePath: source.filePath,
        outDir: dir,
        startSec: clip.startSec,
        endSec: clip.endSec,
        width,
        fps,
        speed
      })
      toast.success(
        <span>
          GIF saved.{' '}
          <button
            className="underline"
            onClick={() => window.api.video.revealInFolder(result.outputPath)}
          >
            Show
          </button>
        </span>
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'GIF export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm">
      <PanelHeader icon="image">Export as GIF</PanelHeader>
      {tooLong ? (
        <p className="text-xs text-amber-300">
          GIF exports over ~10s get huge. Trim the clip first.
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink-muted">Width</span>
          <select
            className="bg-bg-base rounded px-1 py-0.5"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          >
            <option value="240">240</option>
            <option value="320">320</option>
            <option value="480">480</option>
            <option value="640">640</option>
            <option value="800">800</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink-muted">FPS</span>
          <select
            className="bg-bg-base rounded px-1 py-0.5"
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
          >
            <option value="10">10</option>
            <option value="12">12</option>
            <option value="15">15</option>
            <option value="20">20</option>
            <option value="24">24</option>
            <option value="30">30</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink-muted">Speed</span>
          <select
            className="bg-bg-base rounded px-1 py-0.5"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
            <option value="3">3×</option>
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={pickDir}>
          <OutputDirLabel outDir={outDir} />
        </button>
        <button
          className="btn-primary px-4 py-1.5 ml-auto disabled:opacity-50"
          disabled={busy}
          onClick={exportGif}
        >
          {busy ? 'Exporting…' : 'Export GIF'}
        </button>
      </div>
    </div>
  )
}
