import { useCanvasStore } from './state/canvasStore'
import { Icon } from '../../components/Icon'
import { PanelHeader } from '../../components/PanelHeader'
import { assertDefined } from '@shared/assert'
import { hintTag } from '@shared/canvas'

export function LayerPanel(): JSX.Element {
  const layers = useCanvasStore((s) => s.doc.layers)
  const selectedLayerId = useCanvasStore((s) => s.selectedLayerId)
  const selectLayer = useCanvasStore((s) => s.selectLayer)
  const removeLayer = useCanvasStore((s) => s.removeLayer)
  const toggleVisible = useCanvasStore((s) => s.toggleVisible)
  const toggleLocked = useCanvasStore((s) => s.toggleLocked)
  const reorderLayers = useCanvasStore((s) => s.reorderLayers)
  const duplicateLayer = useCanvasStore((s) => s.duplicateLayer)

  // M13 fix (round 15): `!` on every array index swap. The index guards
  // above (idx < ids.length - 1, idx > 0) make these logically safe, but
  // the assertDefined gives a clean error if the guard ever drifts.
  function moveUp(id: string): void {
    const ids = layers.map((l) => l.id)
    const idx = ids.indexOf(id)
    if (idx < ids.length - 1) {
      const next = [...ids]
      const a = assertDefined(next[idx], `layer id at ${idx}`)
      const b = assertDefined(next[idx + 1], `layer id at ${idx + 1}`)
      next[idx] = b
      next[idx + 1] = a
      reorderLayers(next)
    }
  }

  function moveDown(id: string): void {
    const ids = layers.map((l) => l.id)
    const idx = ids.indexOf(id)
    if (idx > 0) {
      const next = [...ids]
      const a = assertDefined(next[idx], `layer id at ${idx}`)
      const b = assertDefined(next[idx - 1], `layer id at ${idx - 1}`)
      next[idx] = b
      next[idx - 1] = a
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
            // T-114: the row was only a clickable <li> - no tab stop, no Enter or Space, and only a
            // border to say which one is selected. The name is a real button now (the keyboard route),
            // and the state is `aria-current` on the row and on the button (that is where focus lands).
            // The row stays a mouse target too: in this narrow panel the name button is ~50 px wide,
            // and a click on the row's blank space (the middle of it, as a test or a hand finds it)
            // selected the layer before this and still must. Both call the same idempotent
            // `selectLayer`; the row's other buttons stop the click so they do not also select.
            <li
              key={layer.id}
              onClick={() => selectLayer(layer.id)}
              aria-current={isSelected ? 'true' : undefined}
              // T-124 (12): the row WRAPS. At the narrowest column (260 px) the name was left 52 px between the eye and lock
              // buttons and the four action buttons: "Rectangle" was cut to "Rect...", and the "hint - won't export" tag broke onto
              // three lines. The name asks for 7 rem; when the row cannot give it, the four actions drop to a line of their own,
              // right-aligned, and the name has the row's width to itself. A wide column keeps everything on one line.
              className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 px-2 py-1.5 rounded cursor-pointer text-sm ${
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
                // T-114: it was a constant title, "Show/hide": the icon swap was the only sign of
                // which. A toggle says its state (pressed = visible); the title names the action.
                aria-pressed={layer.visible}
                aria-label="Layer visible"
                title={layer.visible ? 'Hide layer' : 'Show layer'}
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
              <button
                onClick={() => selectLayer(layer.id)}
                aria-current={isSelected ? 'true' : undefined}
                className="flex-1 min-w-[7rem] flex flex-col text-left rounded outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {/* T-124 (12): `w-full`. The name is a `truncate` span inside a column-flex BUTTON (T-114 made the row's name a
                    button for the keyboard), and a button sizes its content to max-content: the span kept the name's full width,
                    painted over the row's buttons and was never cut. At the span's own width the ellipsis works. */}
                <span className="truncate w-full" title={layer.name}>{layer.name}</span>
                {/* T-91: said where the user is looking, not only in docs — a
                    hint or a reference stays on the canvas but is left out of
                    every export. Text, not just color, and AA on the row. */}
                {hintTag(layer) ? (
                  <span className="text-xs text-ink-muted">{hintTag(layer)}</span>
                ) : null}
              </button>
              <div className="flex items-center gap-1 ml-auto">
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
                  className="text-ink-dim hover:text-danger px-1 flex"
                  title="Remove layer"
                  aria-label="Remove layer"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
