import { useState } from 'react'
import toast from 'react-hot-toast'
import { useCanvasStore } from './state/canvasStore'
import { ThumbnailVariants } from './ThumbnailVariants'

type FormatOption = 'png' | 'jpg'

function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function ExportDialog(): JSX.Element {
  const [format, setFormat] = useState<FormatOption>('png')
  const [quality, setQuality] = useState(0.92)
  const [scale, setScale] = useState(1)
  const [busy, setBusy] = useState(false)
  const [showVariants, setShowVariants] = useState(false)

  async function exportImage(): Promise<void> {
    setBusy(true)
    try {
      const stage = (
        window as unknown as {
          __imagiiStage?: {
            toDataURL: (opts: {
              mimeType?: string
              quality?: number
              pixelRatio?: number
            }) => string
          }
        }
      ).__imagiiStage
      if (!stage) {
        toast.error('Canvas not ready')
        return
      }
      const mime = format === 'png' ? 'image/png' : 'image/jpeg'
      const dataUrl = stage.toDataURL({
        mimeType: mime,
        quality,
        pixelRatio: scale
      })
      downloadDataUrl(dataUrl, `imagii-${Date.now()}.${format}`)
      toast.success(`${format.toUpperCase()} saved`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-3 flex items-center gap-2 text-sm flex-wrap" data-tutorial="image-export">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Export
      </h3>
      <select
        className="bg-bg-base rounded px-2 py-1"
        value={format}
        onChange={(e) => setFormat(e.target.value as FormatOption)}
      >
        <option value="png">PNG</option>
        <option value="jpg">JPG</option>
      </select>
      {format === 'jpg' ? (
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-ink-muted">Quality</span>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.05}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="w-24"
          />
          <span className="font-mono w-10 text-right">{Math.round(quality * 100)}%</span>
        </label>
      ) : null}
      <label className="flex items-center gap-1.5 text-xs">
        <span className="text-ink-muted">Scale</span>
        <select
          className="bg-bg-base rounded px-1 py-0.5"
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
        >
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="3">3× (HiDPI)</option>
        </select>
      </label>
      <button
        className="btn-ghost px-3 py-1 text-xs"
        onClick={() => setShowVariants(true)}
        title="Generate 3 color-graded thumbnail variants"
      >
        ✨ Variants
      </button>
      <button
        className="btn-primary px-4 py-1 disabled:opacity-50"
        disabled={busy}
        onClick={exportImage}
      >
        {busy ? 'Exporting…' : 'Export'}
      </button>
      <ThumbnailVariants open={showVariants} onClose={() => setShowVariants(false)} />
    </div>
  )
}
