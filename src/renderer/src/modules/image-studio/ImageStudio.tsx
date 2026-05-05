import { useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { Link } from 'react-router-dom'
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
          <Link to="/home" className="text-sm text-ink-muted hover:text-ink-base">
            ← Home
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Image Canvas</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            className="btn-ghost px-3 py-1.5 disabled:opacity-50"
            disabled={!canUndo}
            onClick={undo}
          >
            ↶ Undo
          </button>
          <button
            className="btn-ghost px-3 py-1.5 disabled:opacity-50"
            disabled={!canRedo}
            onClick={redo}
          >
            ↷ Redo
          </button>
          <span className="ml-2 text-xs text-ink-muted">Tool: {tool}</span>
          <TutorialButton onClick={tutorial.start} />
        </div>
      </header>

      {layers.length === 0 ? (
        <ImportPanel />
      ) : (
        <>
          <ImportPanel />
          <Toolbar />
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 min-h-0">
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

      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: '#16161e',
            color: '#e5e5ee',
            border: '1px solid rgba(149, 149, 165, 0.25)'
          }
        }}
      />
      {tutorial.active ? (
        <Tutorial def={imageTutorial} onClose={tutorial.stop} />
      ) : null}
    </div>
  )
}
