import { useEffect, useState, type DragEvent } from 'react'
import toast from 'react-hot-toast'
import { nanoid } from 'nanoid'
import { makeImageLayer, makeTextLayer, useCanvasStore } from './state/canvasStore'
import { TemplatesDialog } from './TemplatesDialog'
import {
  getTemplatesByCategory,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_CATEGORY_ICONS,
  type CanvasTemplate,
  type TemplateCategory
} from './templates'
import { Icon } from '../../components/Icon'
import { PanelHeader } from '../../components/PanelHeader'

function cloneDoc<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T
}

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
  const setDocument = useCanvasStore((s) => s.setDocument)
  const layers = useCanvasStore((s) => s.doc.layers)
  const [dragOver, setDragOver] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  // Stream Graphics pivot: when the canvas is empty, surface the
  // templates catalog as the primary call-to-action. The drop-zone
  // becomes secondary. Users still get the modal version of templates
  // via the toolbar button once they have layers loaded.
  function applyTemplate(template: CanvasTemplate): void {
    const doc = cloneDoc(template.doc)
    doc.layers = doc.layers.map((l) => ({ ...l, id: nanoid(8) }))
    setDocument(doc)
  }

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
            className="btn-ghost px-3 py-1 inline-flex items-center gap-1.5"
            onClick={() => setShowTemplates(true)}
            data-tutorial="image-templates"
          >
            <Icon name="sparkle" size={14} /> Templates
          </button>
          <span className="text-xs text-ink-dim ml-auto">
            Drop, paste (Ctrl+V), or pick a file.
          </span>
        </div>
        <TemplatesDialog open={showTemplates} onClose={() => setShowTemplates(false)} />
      </>
    )
  }

  // Stream Graphics empty state: templates-first. Show grouped grid up
  // top, secondary blank-canvas / import-file CTAs below. Once the user
  // picks a template (or imports an image), the studio switches to its
  // normal toolbar+canvas+layers layout.
  const grouped = getTemplatesByCategory()
  return (
    <div className="flex flex-col gap-5 overflow-y-auto" data-tutorial="image-import">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Pick a template to start</h2>
        <p className="text-ink-muted text-sm">
          Streamer-ready presets sized for the platforms you post to. Pick one to drop
          into the editor, or start blank below.
        </p>
      </div>

      {(Object.keys(grouped) as TemplateCategory[]).map((category) => {
        const items = grouped[category]
        if (items.length === 0) return null
        return (
          <section key={category} className="flex flex-col gap-2">
            <PanelHeader icon={TEMPLATE_CATEGORY_ICONS[category]}>
              {TEMPLATE_CATEGORY_LABELS[category]}
            </PanelHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {items.map((t) => (
                <button
                  key={t.id}
                  onClick={() => applyTemplate(t)}
                  className="card p-3 text-left hover:border-accent transition-colors"
                >
                  <div
                    className="w-full rounded mb-2 overflow-hidden border border-ink-dim/30"
                    style={{
                      aspectRatio: `${t.doc.width} / ${t.doc.height}`,
                      background:
                        t.doc.background === 'transparent'
                          ? 'repeating-conic-gradient(#1a1825 0% 25%, #16161e 0% 50%) 0 0 / 16px 16px'
                          : t.doc.background
                    }}
                  />
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-ink-muted mt-1">{t.description}</div>
                  <div className="text-xs text-ink-dim mt-1 font-mono">
                    {t.doc.width} × {t.doc.height}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )
      })}

      <div className="border-t border-ink-dim/20 pt-4 flex flex-col gap-2">
        <PanelHeader icon="image">Or start blank</PanelHeader>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`card flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-4 transition-colors ${
            dragOver ? 'border-accent bg-bg-hover' : ''
          }`}
        >
          <div className="text-sm text-ink-muted">
            Drop, paste (Ctrl+V), or import a file to edit your own image instead.
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button className="btn-primary" onClick={pickFile}>
              Import image
            </button>
            <button className="btn-ghost" onClick={addText}>
              Start with text
            </button>
          </div>
        </div>
      </div>
      <TemplatesDialog open={showTemplates} onClose={() => setShowTemplates(false)} />
    </div>
  )
}
