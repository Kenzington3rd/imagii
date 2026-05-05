import type { Tool } from './state/canvasStore'
import { useCanvasStore } from './state/canvasStore'

const TOOLS: Array<{ id: Tool; label: string; icon: string; shortcut?: string }> = [
  { id: 'select', label: 'Select', icon: '↖', shortcut: 'V' },
  { id: 'rect', label: 'Rect', icon: '▭', shortcut: 'R' },
  { id: 'ellipse', label: 'Ellipse', icon: '◯', shortcut: 'O' },
  { id: 'line', label: 'Line', icon: '╱', shortcut: 'L' },
  { id: 'pencil', label: 'Pencil', icon: '✎', shortcut: 'P' }
]

export function Toolbar(): JSX.Element {
  const tool = useCanvasStore((s) => s.tool)
  const setTool = useCanvasStore((s) => s.setTool)
  const showGrid = useCanvasStore((s) => s.showGrid)
  const setShowGrid = useCanvasStore((s) => s.setShowGrid)
  const snapToGrid = useCanvasStore((s) => s.snapToGrid)
  const setSnapToGrid = useCanvasStore((s) => s.setSnapToGrid)
  const gridSize = useCanvasStore((s) => s.gridSize)
  const setGridSize = useCanvasStore((s) => s.setGridSize)

  return (
    <div className="card p-2 flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`px-3 py-1.5 text-sm rounded ${
              tool === t.id ? 'bg-accent text-bg-base' : 'hover:bg-bg-hover'
            }`}
            onClick={() => setTool(t.id)}
            title={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ''}`}
          >
            <span className="mr-1">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="w-px h-6 bg-ink-dim/30 mx-2" />
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={showGrid}
          onChange={(e) => setShowGrid(e.target.checked)}
        />
        Grid
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={snapToGrid}
          onChange={(e) => setSnapToGrid(e.target.checked)}
        />
        Snap
      </label>
      <input
        type="number"
        min={2}
        max={200}
        value={gridSize}
        onChange={(e) => setGridSize(Number(e.target.value) || 2)}
        className="bg-bg-base rounded px-2 py-1 w-16 text-sm"
        title="Grid size (px)"
      />
    </div>
  )
}
