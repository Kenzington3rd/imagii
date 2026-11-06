import { nanoid } from 'nanoid'
import { countOf } from '@shared/plural'
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
import { Modal } from '../../components/Modal'
import { SpecCard } from '../../components/SpecCard'

interface TemplatesDialogProps {
  open: boolean
  onClose: () => void
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T
}

export function TemplatesDialog({ open, onClose }: TemplatesDialogProps): JSX.Element | null {
  const setTemplate = useCanvasStore((s) => s.setDocument)

  if (!open) return null
  const grouped = getTemplatesByCategory()

  function applyTemplate(template: CanvasTemplate): void {
    const doc = clone(template.doc)
    doc.layers = doc.layers.map((l) => ({ ...l, id: nanoid(8) }))
    setTemplate(doc)
    onClose()
  }

  return (
    // M12 fix (round 15): refactored to use the shared Modal helper. Gains
    // scrim-click-to-close, Escape close, focus trap, and focus restore.
    <Modal
      open={open}
      onClose={onClose}
      title="Streamer templates"
      className="w-full max-w-4xl max-h-[80vh] flex flex-col"
    >
      <div className="flex items-center justify-between p-4 border-b border-ink-dim/30">
        <h2 className="text-lg font-semibold">Streamer templates</h2>
        <button className="text-ink-dim hover:text-ink-base" onClick={onClose}>
          Close
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
                <SpecCard
                  key={t.id}
                  name={t.name}
                  description={t.description}
                  doc={t.doc}
                  onClick={() => applyTemplate(t)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="p-4 border-t border-ink-dim/30 text-xs text-ink-muted">
        {countOf(CANVAS_TEMPLATES.length, 'template')} · clicking one replaces the current canvas.
      </div>
    </Modal>
  )
}
