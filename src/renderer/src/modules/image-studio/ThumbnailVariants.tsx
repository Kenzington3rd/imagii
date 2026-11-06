import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import type { CanvasDocument } from '@shared/canvas'
import { useCanvasStore } from './state/canvasStore'
import { assertDefined } from '@shared/assert'
import { Modal } from '../../components/Modal'
import { basename } from '../../components/OutputDirLabel'
import { reportFailure } from '../../lib/reportFailure'
import { countOf } from '@shared/plural'
import { captureDocument, jpgTransparencyNote, outputPixels, thumbnailSizeNote, type ExportStage } from './ExportDialog'

interface VariantSpec {
  id: string
  label: string
  apply: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
}

function applyAdjust(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  brightness: number,
  contrast: number,
  saturation: number
): void {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const cMul = contrast
  const cOff = 128 * (1 - cMul)
  // d is a Uint8ClampedArray — indices in [0, length) are guaranteed
  // valid; the ?? 0 keeps the strict-mode `noUncheckedIndexedAccess`
  // narrowing happy without changing behavior.
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] ?? 0
    let g = d[i + 1] ?? 0
    let b = d[i + 2] ?? 0
    r = r * cMul + cOff + brightness
    g = g * cMul + cOff + brightness
    b = b * cMul + cOff + brightness
    if (saturation !== 1) {
      const gray = r * 0.299 + g * 0.587 + b * 0.114
      r = gray + (r - gray) * saturation
      g = gray + (g - gray) * saturation
      b = gray + (b - gray) * saturation
    }
    d[i] = Math.max(0, Math.min(255, r))
    d[i + 1] = Math.max(0, Math.min(255, g))
    d[i + 2] = Math.max(0, Math.min(255, b))
  }
  ctx.putImageData(img, 0, 0)
}

const ORIGINAL: VariantSpec = { id: 'original', label: 'Original (unchanged)', apply: () => {} }

const VARIANTS: VariantSpec[] = [
  {
    id: 'punchy',
    label: 'Punchy (more contrast + saturation)',
    apply: (ctx, w, h) => applyAdjust(ctx, w, h, 8, 1.18, 1.25)
  },
  {
    id: 'warm',
    label: 'Warm (golden hour vibe)',
    apply: (ctx, w, h) => {
      applyAdjust(ctx, w, h, 6, 1.05, 1.15)
      const img = ctx.getImageData(0, 0, w, h)
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.min(255, (d[i] ?? 0) * 1.05 + 6)
        d[i + 2] = Math.max(0, (d[i + 2] ?? 0) * 0.92)
      }
      ctx.putImageData(img, 0, 0)
    }
  },
  {
    id: 'cool',
    label: 'Cool (blue-shifted)',
    apply: (ctx, w, h) => {
      applyAdjust(ctx, w, h, -4, 1.1, 1.05)
      const img = ctx.getImageData(0, 0, w, h)
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.max(0, (d[i] ?? 0) * 0.92)
        d[i + 2] = Math.min(255, (d[i + 2] ?? 0) * 1.08 + 4)
      }
      ctx.putImageData(img, 0, 0)
    }
  }
]

interface ThumbnailVariantsProps {
  open: boolean
  onClose: () => void
  /** T-160 (4): the Export card's own format, JPG quality and scale - the variants are files of the same kind the Export button writes. */
  format: 'png' | 'jpg'
  quality: number
  scale: number
  /** T-161 (7): the document is the emote template (112x112 PNG), whose Export button writes the 28/56/112 pack - the variants are not "as the Export card" there. */
  emotePack: boolean
}

interface VariantPreview {
  id: string
  label: string
  dataUrl: string
}

/** One empty list, so "no previews" is the same array every render (the focus effect below keys on identity). */
const NO_PREVIEWS: VariantPreview[] = []

export function ThumbnailVariants({ open, onClose, format, quality, scale, emotePack }: ThumbnailVariantsProps): JSX.Element | null {
  const doc = useCanvasStore((s) => s.doc)
  // T-46: previews belong to the DOCUMENT they were rendered from. This
  // component only early-returns on `!open`, so its state survives a close —
  // and used to survive an edit, which meant reopening after any canvas
  // change offered four renders of a canvas that no longer existed, with the
  // Generate button hidden because `previews` was non-empty. The store
  // replaces `doc` on every edit (and hands the same object back on undo), so
  // an identity check is exactly "is this still what the user is looking at".
  // Keeping the work when nothing changed is the other half of expected: a
  // close and reopen should not throw away a render nobody invalidated.
  // T-160 (4): and to the card's settings they were rendered with - a preview of a PNG is not what "Save all" writes once the card says JPG.
  const [previews, setPreviews] = useState<{
    doc: CanvasDocument
    format: string
    quality: number
    scale: number
    items: VariantPreview[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const fresh =
    previews !== null &&
    previews.doc === doc &&
    previews.format === format &&
    // T-161 (7): a PNG ignores the quality, so a quality changed (and changed back) on the way past JPG leaves a PNG preview as it was.
    (format !== 'jpg' || previews.quality === quality) &&
    previews.scale === scale
  const items = fresh ? previews.items : NO_PREVIEWS
  const out = outputPixels(doc.width, doc.height, scale)
  const jpgNote = jpgTransparencyNote(format, doc.background === 'transparent')
  // T-161 (7): the card's second note too ("Bigger than YouTube's thumbnail size"): a HiDPI 2x default writes 2560x1440 variants.
  const sizeNote = thumbnailSizeNote(out.width, out.height, doc)

  // T-119: the Generate button is swapped for the previews when the render finishes, and the focused button
  // goes with it - keyboard focus fell to the page behind the dialog. It lands on "Save all", the next thing
  // a person does with four renders (the Tutorial coachmark's pattern: focus the primary action of the new
  // state). Keyed on the swap, not on the dialog opening, so a reopen over kept previews is left as it was.
  // T-120: keyed on the previews' IDENTITY, not on whether there are any. Regenerate disables itself while it
  // renders, and Chromium blurs a focused button that becomes disabled; the new previews replace the old ones
  // with the list still non-empty, so a boolean never changed and keyboard focus stayed on the page behind.
  const saveAllRef = useRef<HTMLButtonElement | null>(null)
  // T-127 (11): one save at a time, claimed the instant a save handler runs (ExportPanel.startingRef's shape). Both saves go straight to a
  // native dialog, and a dialog is not on screen yet when the second click of a double-click arrives: it opened TWO choosers and, answered
  // twice, wrote the whole set twice (executed: dblclick "Save all" = two choosers, 8 files). The one ref covers both buttons: a chooser is
  // modal, so a "Save" pressed while another is opening has nothing to add.
  const startingRef = useRef(false)
  useEffect(() => {
    if (items.length > 0) saveAllRef.current?.focus()
  }, [items])

  if (!open) return null

  async function generate(): Promise<void> {
    setBusy(true)
    try {
      const stage = (window as unknown as { __imagiiStage?: ExportStage }).__imagiiStage
      if (!stage) {
        toast.error('Canvas not ready — try again in a second.')
        return
      }
      // T-46: the same capture the Export button takes — the DOCUMENT box at
      // 1:1 with the editor's chrome switched off — in place of the raw stage
      // capture this used to do, which rendered the fit-to-container stage and
      // so saved a 1280x720 thumbnail's variants at whatever size the window
      // happened to be (956x537). T-160 (4): at the card's scale; the capture stays a lossless PNG and each file is encoded once, below, in
      // the card's format (a JPG capture graded and re-encoded would compress twice).
      const baseUrl = captureDocument(stage, doc.width, doc.height, {
        mimeType: 'image/png',
        quality: 1,
        pixelRatio: scale
      })
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to render base canvas'))
        img.src = baseUrl
      })
      const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'
      const made: VariantPreview[] = []
      for (const variant of [ORIGINAL, ...VARIANTS]) {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        // M13 fix (round 15): getContext('2d') returns null on an exotic
        // browser path (canvas disabled in test runner, OOM). assertDefined
        // surfaces a clean error instead of crashing on `null.drawImage`.
        const ctx = assertDefined(c.getContext('2d'), '2d canvas context')
        ctx.drawImage(img, 0, 0)
        variant.apply(ctx, c.width, c.height)
        // The PNG original is the capture itself, byte for byte (a canvas round trip rounds the colour of low-alpha pixels).
        const dataUrl = variant === ORIGINAL && format === 'png' ? baseUrl : c.toDataURL(mime, quality)
        made.push({ id: variant.id, label: variant.label, dataUrl })
      }
      setPreviews({ doc, format, quality, scale, items: made })
    } catch (err) {
      reportFailure(err, { failed: "Couldn't generate variants." })
    } finally {
      setBusy(false)
    }
  }

  // T-91: both saves go through main's native dialogs and are announced only
  // once the files are on disk. A canceled dialog (null) says nothing — the old
  // hidden `<a download>` toasted "Saving 4 variants…" before any dialog had
  // answered, and again for a cancel.
  async function saveOne(p: VariantPreview): Promise<void> {
    if (startingRef.current) return
    startingRef.current = true
    try {
      const saved = await window.api.image.save({
        dataUrl: p.dataUrl,
        defaultName: `imagii-variant-${p.id}-${Date.now()}.${format}`,
        format
      })
      // T-123 (9): the answer was discarded, so a single Save was the one save with no word of success (saveAll and the
      // Export button both toast). `null` is the dialog canceled: not a success, not an error, nothing said. The name is
      // the one the person chose. The shape is the one the other two saves have (T-91 pins it): the null check, then the toast.
      if (saved === null) return
      toast.success(`Saved ${basename(saved)}`)
    } catch (err) {
      reportFailure(err, { failed: "Couldn't save that thumbnail." })
    } finally {
      startingRef.current = false
    }
  }

  // ONE folder picker for the whole set — four Save dialogs in a row is not a
  // button called "Save all".
  async function saveAll(): Promise<void> {
    if (startingRef.current) return
    startingRef.current = true
    try {
      if (items.length === 0) return
      const stamp = Date.now()
      const saved = await window.api.image.saveMany({
        title: 'Choose a folder for the thumbnail variants',
        files: items.map((p) => ({
          name: `imagii-variant-${p.id}-${stamp}.${format}`,
          dataUrl: p.dataUrl
        }))
      })
      if (saved === null) return
      toast.success(`Saved ${countOf(saved.count, 'thumbnail')}`)
    } catch (err) {
      reportFailure(err, { failed: "Couldn't save the thumbnails." })
    } finally {
      startingRef.current = false
    }
  }

  // T-160 (4): what the files will be, in the Export card's own words and arithmetic ("Output: W×H"), with the card's JPG note.
  const outputLine = (
    <div className="mb-3 text-xs text-ink-muted" data-testid="variants-output">
      <p className="font-mono">{`Output: ${out.width}×${out.height} ${format.toUpperCase()}${emotePack ? '' : ', as the Export card'}`}</p>
      {sizeNote ? <p>{sizeNote}</p> : null}
      {jpgNote ? <p>{jpgNote}</p> : null}
    </div>
  )

  // INIT-G (round 16): migrated to <Modal> for Escape + focus trap + focus
  // restore. Header chrome stays inside the modal body.
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thumbnail variants"
      className="w-full max-w-3xl max-h-[85vh] flex flex-col"
    >
      <div className="flex items-center justify-between p-4 border-b border-ink-dim/30">
        <h2 className="text-lg font-semibold">Thumbnail variants</h2>
        <button
          className="text-ink-dim hover:text-ink-base"
          onClick={onClose}
          title="Close"
          aria-label="Close"
        >
          Close
        </button>
      </div>
      <div className="p-4 flex flex-col gap-4 overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-sm text-ink-muted">
              <p className="mb-3">
                Generate three color-graded variants of the current canvas: punchy, warm, and
                cool. Pick the one that performs best, or A/B test them.
              </p>
              {outputLine}
              <button
                className="btn-primary px-4 py-2 disabled:opacity-50"
                onClick={generate}
                disabled={busy}
              >
                {busy ? 'Generating…' : 'Generate 3 variants'}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {items.map((p) => (
                  <div
                    key={p.id}
                    className="card p-2 flex flex-col gap-2"
                    style={{
                      aspectRatio: `${doc.width} / ${doc.height}`,
                      maxHeight: 280
                    }}
                  >
                    <img src={p.dataUrl} alt={p.label} className="w-full rounded flex-1 object-contain" />
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium truncate" title={p.label}>{p.label}</span>
                      <button className="text-accent hover:underline" onClick={() => saveOne(p)}>
                        Save
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {outputLine}
              <div className="flex items-center gap-2 text-sm">
                <button
                  className="btn-ghost px-3 py-1.5 disabled:opacity-50"
                  onClick={generate}
                  disabled={busy}
                >
                  {busy ? 'Generating…' : 'Regenerate'}
                </button>
                <button ref={saveAllRef} className="btn-primary px-4 py-1.5 ml-auto" onClick={saveAll}>
                  Save all ({items.length - 1} + original)
                </button>
              </div>
            </>
          )}
      </div>
    </Modal>
  )
}
