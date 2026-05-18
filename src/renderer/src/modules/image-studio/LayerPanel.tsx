import { useCanvasStore } from './state/canvasStore'
import { Icon } from '../../components/Icon'
import { PanelHeader } from '../../components/PanelHeader'

export function LayerPanel(): JSX.Element {
  const layers = useCanvasStore((s) => s.doc.layers)
  const selectedLayerId = useCanvasStore((s) => s.selectedLayerId)
  const selectLayer = useCanvasStore((s) => s.selectLayer)
  const removeLayer = useCanvasStore((s) => s.removeLayer)
  const toggleVisible = useCanvasStore((s) => s.toggleVisible)
  const toggleLocked = useCanvasStore((s) => s.toggleLocked)
  const reorderLayers = useCanvasStore((s) => s.reorderLayers)
  const duplicateLayer = useCanvasStore((s) => s.duplicateLayer)

  function moveUp(id: string): void {
    const ids = layers.map((l) => l.id)
    const idx = ids.indexOf(id)
    if (idx < ids.length - 1) {
      const next = [...ids]
      ;[next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!]
      reorderLayers(next)
    }
  }

  function moveDown(id: string): void {
    const ids = layers.map((l) => l.id)
    const idx = ids.indexOf(id)
    if (idx > 0) {
      const next = [...ids]
      ;[next[idx], next[idx - 1]] = [next[idx - 1]!, next[idx]!]
      reorderLayers(next)
    }
  }

  return (
    <div className="card p-3 flex flex-col gap-2" data-tutorial="image-layers">
      <PanelHeader icon="layers">Layers ({layers.length})</PanelHeader>
      {layers.length === 0 ? (
        <p className="text-xs text-ink-dim">
          Drop or paste an image, or draw with the toolbar above.
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {[...layers].reverse().map((layer) => {
          const isSelected = layer.id === selectedLayerId
          return (
            <li
              key={layer.id}
              onClick={() => selectLayer(layer.id)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-sm ${
                isSelected ? 'bg-accent/15 border border-accent' : 'hover:bg-bg-hover border border-transparent'
              }`}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleVisible(layer.id)
                }}
                className={`w-5 flex justify-center ${
                  layer.visible ? 'text-ink-base' : 'text-ink-dim'
                } hover:text-accent`}
                title="Show/hide"
              >
                <Icon name={layer.visible ? 'eye' : 'eye-off'} size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleLocked(layer.id)
                }}
                className={`w-5 flex justify-center ${
                  layer.locked ? 'text-accent' : 'text-ink-dim'
                } hover:text-accent`}
                title={layer.locked ? 'Unlock' : 'Lock'}
                aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}
              >
                <Icon name={layer.locked ? 'lock' : 'unlock'} size={14} />
              </button>
              <span className="flex-1 truncate">{layer.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  moveUp(layer.id)
                }}
                className="text-ink-dim hover:text-ink-base px-1 flex"
                title="Move up"
                aria-label="Move layer up"
              >
                <Icon name="chevron-up" size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  moveDown(layer.id)
                }}
                className="text-ink-dim hover:text-ink-base px-1 flex"
                title="Move down"
                aria-label="Move layer down"
              >
                <Icon name="chevron-down" size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  duplicateLayer(layer.id)
                }}
                className="text-ink-dim hover:text-ink-base px-1 flex"
                title="Duplicate"
                aria-label="Duplicate layer"
              >
                <Icon name="copy" size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeLayer(layer.id)
                }}
                className="text-ink-dim hover:text-rose-300 px-1 flex"
                title="Delete"
                aria-label="Delete layer"
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
