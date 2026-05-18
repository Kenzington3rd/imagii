import { useState } from 'react'
import { nanoid } from 'nanoid'
import {
  CANVAS_TEMPLATES,
  getTemplatesByCategory,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_CATEGORY_ICONS,
  type CanvasTemplate,
  type TemplateCategory
} from './templates'
import { useCanvasStore } from './state/canvasStore'
import { PanelHeader } from '../../components/PanelHeader'

interface TemplatesDialogProps {
  open: boolean
  onClose: () => void
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T
}

export function TemplatesDialog({ open, onClose }: TemplatesDialogProps): JSX.Element | null {
  const setTemplate = useCanvasStore((s) => s.setDocument)
  // setHover is currently used to drive future preview behavior; the value
  // is unread for now. Keep the setter so the onMouseEnter/onMouseLeave
  // wiring stays in place for the planned hover-preview feature.
  const [, setHover] = useState<CanvasTemplate | null>(null)

  if (!open) return null
  const grouped = getTemplatesByCategory()

  function applyTemplate(template: CanvasTemplate): void {
    const doc = clone(template.doc)
    doc.layers = doc.layers.map((l) => ({ ...l, id: nanoid(8) }))
    setTemplate(doc)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div className="bg-bg-elevated border border-ink-dim/30 rounded-xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-ink-dim/30">
          <h2 className="text-lg font-semibold">Streamer templates</h2>
          <button
            className="text-ink-dim hover:text-ink-base text-lg leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 flex flex-col gap-5">
          {Object.entries(grouped).map(([category, templates]) => (
            <section key={category}>
              <PanelHeader
                icon={TEMPLATE_CATEGORY_ICONS[category as TemplateCategory]}
                className="mb-2"
              >
                {TEMPLATE_CATEGORY_LABELS[category as TemplateCategory] ?? category}
              </PanelHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => applyTemplate(t)}
                    onMouseEnter={() => setHover(t)}
                    onMouseLeave={() => setHover(null)}
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
          ))}
        </div>
        <div className="p-4 border-t border-ink-dim/30 flex justify-between text-xs text-ink-muted">
          <span>{CANVAS_TEMPLATES.length} templates · clicking one replaces the current canvas.</span>
          <button className="text-accent hover:underline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
