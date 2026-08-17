import { useState } from 'react'
import toast from 'react-hot-toast'
import type { CanvasDocument } from '@shared/canvas'
import { useCanvasStore } from './state/canvasStore'
import { assertDefined } from '@shared/assert'
import { Modal } from '../../components/Modal'
import { captureDocument, type ExportStage } from './ExportDialog'

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
}

interface VariantPreview {
  id: string
  label: string
  dataUrl: string
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function ThumbnailVariants({ open, onClose }: ThumbnailVariantsProps): JSX.Element | null {
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
  const [previews, setPreviews] = useState<{ doc: CanvasDocument; items: VariantPreview[] } | null>(
    null
  )
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const items = previews !== null && previews.doc === doc ? previews.items : []

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
      // happened to be (956x537). `quality` is ignored for PNG.
      const baseUrl = captureDocument(stage, doc.width, doc.height, {
        mimeType: 'image/png',
        quality: 1,
        pixelRatio: 1
      })
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to render base canvas'))
        img.src = baseUrl
      })
      const out: VariantPreview[] = [
        { id: 'original', label: 'Original (unchanged)', dataUrl: baseUrl }
      ]
      for (const variant of VARIANTS) {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        // M13 fix (round 15): getContext('2d') returns null on an exotic
        // browser path (canvas disabled in test runner, OOM). assertDefined
        // surfaces a clean error instead of crashing on `null.drawImage`.
        const ctx = assertDefined(c.getContext('2d'), '2d canvas context')
        ctx.drawImage(img, 0, 0)
        variant.apply(ctx, c.width, c.height)
        out.push({ id: variant.id, label: variant.label, dataUrl: c.toDataURL('image/png') })
      }
      setPreviews({ doc, items: out })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate variants')
    } finally {
      setBusy(false)
    }
  }

  function downloadAll(): void {
    if (items.length === 0) return
    const stamp = Date.now()
    items.forEach((p, i) => {
      setTimeout(() => {
        downloadDataUrl(p.dataUrl, `imagii-variant-${p.id}-${stamp}.png`)
      }, i * 100)
    })
    toast.success(`Saving ${items.length} variants…`)
  }

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
                      <span className="font-medium truncate">{p.label}</span>
                      <button
                        className="text-accent hover:underline"
                        onClick={() =>
                          downloadDataUrl(
                            p.dataUrl,
                            `imagii-variant-${p.id}-${Date.now()}.png`
                          )
                        }
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <button
                  className="btn-ghost px-3 py-1.5 disabled:opacity-50"
                  onClick={generate}
                  disabled={busy}
                >
                  {busy ? 'Generating…' : 'Regenerate'}
                </button>
                <button className="btn-primary px-4 py-1.5 ml-auto" onClick={downloadAll}>
                  Save all {items.length}
                </button>
              </div>
            </>
          )}
      </div>
    </Modal>
  )
}
