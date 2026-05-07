import { useState } from 'react'
import toast from 'react-hot-toast'
import { useCanvasStore } from './state/canvasStore'

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
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i]
    let g = d[i + 1]
    let b = d[i + 2]
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
        d[i] = Math.min(255, d[i] * 1.05 + 6)
        d[i + 2] = Math.max(0, d[i + 2] * 0.92)
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
        d[i] = Math.max(0, d[i] * 0.92)
        d[i + 2] = Math.min(255, d[i + 2] * 1.08 + 4)
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
  const [previews, setPreviews] = useState<VariantPreview[]>([])
  const [busy, setBusy] = useState(false)

  if (!open) return null

  function getStageDataUrl(): string | null {
    const stage = (
      window as unknown as {
        __imagiiStage?: { toDataURL: (opts: { mimeType?: string; pixelRatio?: number }) => string }
      }
    ).__imagiiStage
    if (!stage) return null
    return stage.toDataURL({ mimeType: 'image/png', pixelRatio: 1 })
  }

  async function generate(): Promise<void> {
    setBusy(true)
    try {
      const baseUrl = getStageDataUrl()
      if (!baseUrl) {
        toast.error('Canvas not ready — try again in a second.')
        return
      }
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
        const ctx = c.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        variant.apply(ctx, c.width, c.height)
        out.push({ id: variant.id, label: variant.label, dataUrl: c.toDataURL('image/png') })
      }
      setPreviews(out)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate variants')
    } finally {
      setBusy(false)
    }
  }

  function downloadAll(): void {
    if (previews.length === 0) return
    const stamp = Date.now()
    previews.forEach((p, i) => {
      setTimeout(() => {
        downloadDataUrl(p.dataUrl, `imagii-variant-${p.id}-${stamp}.png`)
      }, i * 100)
    })
    toast.success(`Saving ${previews.length} variants…`)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-bg-elevated border border-ink-dim/30 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-ink-dim/30">
          <h2 className="text-lg font-semibold">Thumbnail variants</h2>
          <button className="text-ink-dim hover:text-ink-base" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-4 flex flex-col gap-4 overflow-y-auto">
          {previews.length === 0 ? (
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
                {previews.map((p) => (
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
                        save
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <button className="btn-ghost px-3 py-1.5" onClick={generate} disabled={busy}>
                  {busy ? 'Generating…' : 'Regenerate'}
                </button>
                <button className="btn-primary px-4 py-1.5 ml-auto" onClick={downloadAll}>
                  Save all {previews.length}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
