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
 * Pick a sensible default export scale for the user's display.
 *
 * Since T-45 the export is the DOCUMENT — `1×` is one document pixel per
 * exported pixel whatever the window is doing — so this is no longer about
 * matching the canvas. It is about the deliverable: a HiDPI user (DPR ≥ 2,
 * a 4K monitor at 200% or a Retina panel) reviews their own thumbnail on a
 * screen that packs two device pixels into every CSS pixel, and a 1× file
 * scaled up to fill that preview looks soft. Defaulting them to 2× hands
 * them a file with the pixels their screen can actually show, at the cost
 * of size; a DPR-1 user gains nothing from the extra bytes and stays at 1×.
 * Konva's `toDataURL({ pixelRatio })` takes the multiplier directly. Clamps
 * to the supported select-box options so the picker stays in sync with the
 * resolved default, and the picker still overrides it. Pure function for tests.
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

/**
 * The Konva name Canvas.tsx tags its editor-only stage layers with — the grid
 * overlay and the selection/draw-preview overlay that carries the Transformer.
 * `captureDocument` switches every layer carrying it off for the capture.
 */
const CHROME_LAYER = 'chrome'

/** The slice of a Konva layer the export path drives. */
interface ExportLayer {
  hasName(name: string): boolean
  visible(): boolean
  visible(value: boolean): void
}

/** The slice of the Konva stage the export path drives. */
interface ExportStage {
  scaleX(): number
  scaleY(): number
  scale(value: { x: number; y: number }): void
  getLayers(): ExportLayer[]
  toDataURL: (opts: {
    mimeType?: string
    quality?: number
    pixelRatio?: number
    width?: number
    height?: number
  }) => string
}

/**
 * Render the stage at DOCUMENT resolution: exactly `width * pixelRatio` by
 * `height * pixelRatio` pixels, whatever size the window happens to be.
 *
 * T-45. The on-screen stage is scaled to fit its container (Canvas.tsx:168),
 * so a bare `stage.toDataURL({ pixelRatio })` renders `stage.width()` — which
 * is `doc.width * fitZoom` — and every export came out the size of the
 * viewport instead of the size of the document: a 1280x720 template landed at
 * 956x537 at "1x" and changed with the window, and the 112x112 emote doc,
 * pinned to the 4x zoom cap, wrote 112/224/448 under filenames promising
 * 28/56/112. The labels are the promise; this is what makes them true.
 *
 * Neutralising the stage scale for the capture and passing the document box
 * explicitly takes the zoom out of the arithmetic rather than compensating
 * for it: Konva sizes the output canvas `width * pixelRatio`
 * (Stage._toKonvaCanvas), so 112 x 0.25 is exactly 28 instead of a float
 * quotient that can truncate a pixel away.
 *
 * T-53. The same capture drew the EDITOR over the document.
 * `Stage._toKonvaCanvas` paints every layer whose `isVisible()` is true, and
 * Canvas.tsx keeps the grid overlay and the Transformer (selection border and
 * its eight anchors) in stage layers of their own — so exporting with a shape
 * selected, or with Grid checked, wrote the app's own furniture into the PNG
 * the user posts. Both layers are tagged `chrome`; this switches them off for
 * the capture and puts each one's PRIOR flag back in the `finally`, because a
 * layer may legitimately be off already and "restore" must not mean "show
 * everything". The exclusion is enumerated rather than inferred: a future
 * editor-only layer is chrome the moment it carries the tag, and invisible in
 * exports from that moment.
 *
 * Nothing the user can see is touched. Konva renders into a fresh off-screen
 * canvas; hide, capture and restore are one synchronous block, so the
 * `display:none` that Konva writes onto a hidden layer's canvas element
 * (`Layer._checkVisibility`) is reverted before the browser can paint; and
 * Konva's own redraw is rAF-deferred (`Node._requestDraw` -> `batchDraw`), so
 * the frame it eventually draws sees the restored scale and the restored flags.
 */
export function captureDocument(
  stage: ExportStage,
  width: number,
  height: number,
  opts: { mimeType: string; quality: number; pixelRatio: number }
): string {
  const scaleX = stage.scaleX()
  const scaleY = stage.scaleY()
  const chrome = stage
    .getLayers()
    .filter((layer) => layer.hasName(CHROME_LAYER))
    .map((layer) => ({ layer, visible: layer.visible() }))
  try {
    stage.scale({ x: 1, y: 1 })
    for (const { layer } of chrome) layer.visible(false)
    return stage.toDataURL({ ...opts, width, height })
  } finally {
    for (const { layer, visible } of chrome) layer.visible(visible)
    stage.scale({ x: scaleX, y: scaleY })
  }
}

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
      const stage = (window as unknown as { __imagiiStage?: ExportStage }).__imagiiStage
      if (!stage) {
        toast.error('Canvas not ready')
        return
      }
      const mime = format === 'png' ? 'image/png' : 'image/jpeg'
      // INIT-B (round 15): emote pack auto-export. When the canvas is the
      // Twitch emote template's native 112×112, emit the full 28/56/112 trio
      // so the user gets the upload-ready pack in one click. Against the
      // document box (T-45) the pixelRatio is exact: 28 = 0.25, 56 = 0.5,
      // 112 = 1, so the bytes carry the sizes the filenames promise.
      if (doc.width === 112 && doc.height === 112 && format === 'png') {
        const stamp = Date.now()
        for (const size of EMOTE_PACK_SIZES) {
          const dataUrl = captureDocument(stage, doc.width, doc.height, {
            mimeType: 'image/png',
            quality,
            pixelRatio: size / doc.width
          })
          downloadDataUrl(dataUrl, `imagii-emote-${size}-${stamp}.png`)
        }
        toast.success(`Emote pack saved (3 PNGs: 28, 56, 112)`)
        return
      }
      const dataUrl = captureDocument(stage, doc.width, doc.height, {
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
