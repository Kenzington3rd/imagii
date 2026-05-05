import { useEffect, useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { makeImageLayer, makeTextLayer, useCanvasStore } from './state/canvasStore'
import { TemplatesDialog } from './TemplatesDialog'

const ACCEPTED_EXT = ['.png', '.jpg', '.jpeg', '.bmp', '.svg', '.webp', '.gif']

function isImage(name: string): boolean {
  const lower = name.toLowerCase()
  return ACCEPTED_EXT.some((ext) => lower.endsWith(ext))
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Read failed'))
    reader.readAsDataURL(file)
  })
}

function loadImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Decode failed'))
    img.src = dataUrl
  })
}

export function ImportPanel(): JSX.Element {
  const addLayer = useCanvasStore((s) => s.addLayer)
  const layers = useCanvasStore((s) => s.doc.layers)
  const [dragOver, setDragOver] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  async function ingestFile(file: File): Promise<void> {
    if (!isImage(file.name)) {
      toast.error('Unsupported file type')
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const dims = await loadImageDimensions(dataUrl)
      const maxDim = 800
      const scale = Math.min(1, maxDim / Math.max(dims.width, dims.height))
      const w = dims.width * scale
      const h = dims.height * scale
      addLayer({ ...makeImageLayer(dataUrl, w, h), name: file.name })
      toast.success(`Added ${file.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    }
  }

  useEffect(() => {
    function onPaste(e: ClipboardEvent): void {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            void ingestFile(file)
            e.preventDefault()
            return
          }
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    files.forEach((f) => void ingestFile(f))
  }

  async function pickFile(): Promise<void> {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) void ingestFile(file)
    }
    input.click()
  }

  function addText(): void {
    addLayer(makeTextLayer(120, 120))
  }

  if (layers.length > 0) {
    return (
      <>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          data-tutorial="image-import"
          className={`card p-2 flex items-center gap-2 text-sm ${
            dragOver ? 'border-accent bg-bg-hover' : ''
          }`}
        >
          <button className="btn-ghost px-3 py-1" onClick={pickFile}>
            + Import image
          </button>
          <button className="btn-ghost px-3 py-1" onClick={addText}>
            + Add text
          </button>
          <button
            className="btn-ghost px-3 py-1"
            onClick={() => setShowTemplates(true)}
            data-tutorial="image-templates"
          >
            ✨ Templates
          </button>
          <span className="text-xs text-ink-dim ml-auto">
            Drop, paste (Ctrl+V), or pick a file.
          </span>
        </div>
        <TemplatesDialog open={showTemplates} onClose={() => setShowTemplates(false)} />
      </>
    )
  }

  return (
    <>
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      data-tutorial="image-import"
      className={`card flex flex-col items-center justify-center text-center px-10 py-16 transition-colors ${
        dragOver ? 'border-accent bg-bg-hover' : ''
      }`}
    >
      <div className="text-5xl mb-4">🖼</div>
      <h2 className="text-2xl font-semibold mb-2">Drop or paste an image</h2>
      <p className="text-ink-muted text-sm mb-6">
        PNG, JPG, BMP, WEBP, SVG, GIF — or paste from clipboard with Ctrl+V.
      </p>
      <div className="flex gap-2 mb-3">
        <button className="btn-primary" onClick={pickFile}>
          Choose file…
        </button>
        <button className="btn-ghost" onClick={addText}>
          Start with text
        </button>
        <button className="btn-ghost" onClick={() => setShowTemplates(true)}>
          ✨ Templates
        </button>
      </div>
    </div>
    <TemplatesDialog open={showTemplates} onClose={() => setShowTemplates(false)} />
    </>
  )
}
