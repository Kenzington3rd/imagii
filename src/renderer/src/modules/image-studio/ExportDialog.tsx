import { useState } from 'react'
import toast from 'react-hot-toast'
import { ThumbnailVariants } from './ThumbnailVariants'
import { Icon } from '../../components/Icon'
import { PanelHeader } from '../../components/PanelHeader'
import { useCanvasStore } from './state/canvasStore'

type FormatOption = 'png' | 'jpg'

function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Pick a sensible default export scale for the user's display. On a
 * standard 1080p monitor (DPR 1.0) we want 1× — exporting at the
 * canvas's nominal resolution. On a HiDPI screen (DPR ≥ 2.0, typical
 * for 4K monitors at 200% scaling or Retina) we want the export to
 * match what the user actually SEES on canvas, which is the canvas
 * scaled up by DPR. Konva's `toDataURL({ pixelRatio })` accepts this
 * directly. Clamps to the supported select-box options so the picker
 * stays in sync with the resolved default. Pure function for tests.
 */
export function defaultExportScale(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 1
  if (dpr >= 2.5) return 3
  if (dpr >= 1.75) return 2
  return 1
}

// INIT-B (round 15): Twitch's emote pack expects 28, 56, and 112 px PNGs of
// the same artwork. We detect that the user is working on the emote
// template via the canvas dimensions (112x112) and emit all three on Export.
const EMOTE_PACK_SIZES = [28, 56, 112] as const

export function ExportDialog(): JSX.Element {
  const doc = useCanvasStore((s) => s.doc)
  const [format, setFormat] = useState<FormatOption>('png')
  const [quality, setQuality] = useState(0.92)
  // Pick a default scale based on the user's display DPR — 1× on
  // standard 1080p, 2× on 4K-at-200%, 3× on extreme HiDPI. The user
  // can still override via the picker; this just means the first
  // export on a 4K screen looks correct without manual intervention.
  const [scale, setScale] = useState(() => defaultExportScale(window.devicePixelRatio))
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
      // INIT-B (round 15): emote pack auto-export. When the canvas is the
      // Twitch emote template's native 112×112, emit the full 28/56/112 trio
      // so the user gets the upload-ready pack in one click. The pixelRatio
      // trick on a 112×112 base yields the smaller sizes (28 = 0.25, 56 =
      // 0.5, 112 = 1).
      if (doc.width === 112 && doc.height === 112 && format === 'png') {
        const stamp = Date.now()
        for (const size of EMOTE_PACK_SIZES) {
          const dataUrl = stage.toDataURL({
            mimeType: 'image/png',
            quality,
            pixelRatio: size / 112
          })
          downloadDataUrl(dataUrl, `imagii-emote-${size}-${stamp}.png`)
        }
        toast.success(`Emote pack saved (3 PNGs: 28, 56, 112)`)
        return
      }
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
      <PanelHeader icon="download">Export</PanelHeader>
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
            // M11 fix (round 15)
            aria-label="JPG export quality"
            aria-valuetext={`${Math.round(quality * 100)} percent`}
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
        className="btn-ghost px-3 py-1 text-xs inline-flex items-center gap-1.5"
        onClick={() => setShowVariants(true)}
        title="Generate 3 color-graded thumbnail variants"
      >
        <Icon name="sparkle" size={13} /> Variants
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
