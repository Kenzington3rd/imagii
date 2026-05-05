import { useState } from 'react'
import toast from 'react-hot-toast'
import { useCanvasStore } from './state/canvasStore'

type FormatOption = 'png' | 'jpg' | 'svg'

function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function ExportDialog(): JSX.Element {
  const doc = useCanvasStore((s) => s.doc)
  const [format, setFormat] = useState<FormatOption>('png')
  const [quality, setQuality] = useState(0.92)
  const [scale, setScale] = useState(1)
  const [busy, setBusy] = useState(false)

  async function exportImage(): Promise<void> {
    setBusy(true)
    try {
      const stage = (window as unknown as { __imagiiStage?: { toDataURL: (opts: { mimeType?: string; quality?: number; pixelRatio?: number; width?: number; height?: number }) => string; toCanvas?: () => HTMLCanvasElement } }).__imagiiStage
      if (!stage) {
        toast.error('Canvas not ready')
        return
      }
      if (format === 'svg') {
        const svg = buildSvg(doc)
        downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `imagii-${Date.now()}.svg`)
        toast.success('SVG saved')
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
    <div className="card p-3 flex items-center gap-2 text-sm flex-wrap">
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
        <option value="svg">SVG (basic)</option>
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
      {format !== 'svg' ? (
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
      ) : null}
      <button className="btn-primary px-4 py-1 ml-auto disabled:opacity-50" disabled={busy} onClick={exportImage}>
        {busy ? 'Exporting…' : 'Export'}
      </button>
    </div>
  )
}

function buildSvg(doc: ReturnType<typeof useCanvasStore.getState>['doc']): string {
  const elements = doc.layers
    .filter((l) => l.visible)
    .map((l) => {
      const transform = `translate(${l.x},${l.y}) rotate(${l.rotation}) scale(${l.scaleX},${l.scaleY})`
      switch (l.type) {
        case 'rect':
          return `<rect x="0" y="0" width="${l.width}" height="${l.height}" rx="${l.cornerRadius}" fill="${l.fill}" stroke="${l.stroke}" stroke-width="${l.strokeWidth}" transform="${transform}" opacity="${l.opacity}"/>`
        case 'ellipse':
          return `<ellipse cx="0" cy="0" rx="${l.radiusX}" ry="${l.radiusY}" fill="${l.fill}" stroke="${l.stroke}" stroke-width="${l.strokeWidth}" transform="${transform}" opacity="${l.opacity}"/>`
        case 'line': {
          const pts = l.points
            .reduce<string[]>((acc, n, i) => {
              if (i % 2 === 0) acc.push(`${n}`)
              else acc[acc.length - 1] = `${acc[acc.length - 1]} ${n}`
              return acc
            }, [])
            .join(' ')
          if (l.closed)
            return `<polygon points="${pts}" fill="none" stroke="${l.stroke}" stroke-width="${l.strokeWidth}" transform="${transform}" opacity="${l.opacity}"/>`
          return `<polyline points="${pts}" fill="none" stroke="${l.stroke}" stroke-width="${l.strokeWidth}" transform="${transform}" opacity="${l.opacity}"/>`
        }
        case 'text':
          return `<text x="0" y="${l.fontSize}" font-size="${l.fontSize}" font-family="${l.fontFamily}" fill="${l.fill}" transform="${transform}" opacity="${l.opacity}">${escapeXml(l.text)}</text>`
        case 'image':
          return `<image x="0" y="0" width="${l.width}" height="${l.height}" href="${l.src}" transform="${transform}" opacity="${l.opacity}"/>`
        default:
          return ''
      }
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">
  <rect width="100%" height="100%" fill="${doc.background}"/>
  ${elements}
</svg>`
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '&':
        return '&amp;'
      case "'":
        return '&apos;'
      case '"':
        return '&quot;'
      default:
        return c
    }
  })
}
