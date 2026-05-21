import { useEffect } from 'react'
import { AppToaster } from '../../components/AppToaster'

// INIT-F (round 15): human-readable tool labels for the header badge.
const TOOL_LABELS: Record<string, string> = {
  select: 'Select',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  pencil: 'Pencil'
}
import { HomeLink } from '../../components/HomeLink'
import { Icon } from '../../components/Icon'
import { Canvas } from './Canvas'
import { Toolbar } from './Toolbar'
import { LayerPanel } from './LayerPanel'
import { PropertiesPanel } from './PropertiesPanel'
import { ImportPanel } from './ImportPanel'
import { ExportDialog } from './ExportDialog'
import { useCanvasStore } from './state/canvasStore'
import { Tutorial } from '../../components/Tutorial'
import { TutorialButton } from '../../components/TutorialButton'
import { useTutorial } from '../../hooks/useTutorial'
import { imageTutorial } from '../../tutorials/imageTutorial'

export function ImageStudio(): JSX.Element {
  const undo = useCanvasStore((s) => s.undo)
  const redo = useCanvasStore((s) => s.redo)
  const canUndo = useCanvasStore((s) => s.canUndo())
  const canRedo = useCanvasStore((s) => s.canRedo())
  const tool = useCanvasStore((s) => s.tool)
  const setTool = useCanvasStore((s) => s.setTool)
  const removeLayer = useCanvasStore((s) => s.removeLayer)
  const selectedLayerId = useCanvasStore((s) => s.selectedLayerId)
  const layers = useCanvasStore((s) => s.doc.layers)
  const tutorial = useTutorial(imageTutorial)

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLayerId) {
          e.preventDefault()
          removeLayer(selectedLayerId)
        }
      } else if (e.key === 'v' || e.key === 'V') {
        if (!ctrl) setTool('select')
      } else if (e.key === 'r' || e.key === 'R') {
        setTool('rect')
      } else if (e.key === 'o' || e.key === 'O') {
        setTool('ellipse')
      } else if (e.key === 'l' || e.key === 'L') {
        setTool('line')
      } else if (e.key === 'p' || e.key === 'P') {
        setTool('pencil')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, selectedLayerId, removeLayer, setTool])

  return (
    <div className="h-full overflow-hidden px-6 py-5 flex flex-col gap-4">
      <header className="flex items-center justify-between flex-shrink-0">
        <div>
          <HomeLink />
          <h1 className="text-2xl font-semibold mt-1">Stream Graphics</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            className="btn-ghost px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5"
            disabled={!canUndo}
            onClick={undo}
          >
            <Icon name="undo" size={15} /> Undo
          </button>
          <button
            className="btn-ghost px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5"
            disabled={!canRedo}
            onClick={redo}
          >
            <Icon name="redo" size={15} /> Redo
          </button>
          {/* INIT-F (round 15): map the internal tool ids to readable labels.
              The Toolbar already shows the active tool visually so this is a
              redundancy aimed at AT / quick visual confirmation. */}
          <span className="ml-2 text-xs text-ink-muted">Tool: {TOOL_LABELS[tool] ?? tool}</span>
          <TutorialButton onClick={tutorial.start} />
        </div>
      </header>

      {layers.length === 0 ? (
        <ImportPanel />
      ) : (
        <>
          <ImportPanel />
          <Toolbar />
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_clamp(260px,16%,380px)] gap-4 min-h-0">
            <div className="flex flex-col gap-3 min-h-0">
              <Canvas />
              <ExportDialog />
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto">
              <LayerPanel />
              <PropertiesPanel />
            </div>
          </div>
        </>
      )}

      <AppToaster />
      {tutorial.active ? (
        <Tutorial def={imageTutorial} onClose={tutorial.stop} />
      ) : null}
    </div>
  )
}
