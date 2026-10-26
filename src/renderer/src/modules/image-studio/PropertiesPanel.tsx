import {
  LAYER_ROTATION_RANGE,
  layerOffsetRange,
  type CanvasLayer,
  type EllipseLayer,
  type RectLayer,
  type TextLayer
} from '@shared/canvas'
import { useCanvasStore } from './state/canvasStore'
import { PanelHeader } from '../../components/PanelHeader'
import { DraftField } from '../../components/DraftField'
import { clampTyped, isTypedInRange } from '@shared/draftNumber'

const ROTATION_PRESETS = [0, 15, 30, 45, 90, 180, 270]

export function PropertiesPanel(): JSX.Element | null {
  const layers = useCanvasStore((s) => s.doc.layers)
  const docWidth = useCanvasStore((s) => s.doc.width)
  const docHeight = useCanvasStore((s) => s.doc.height)
  const selectedLayerId = useCanvasStore((s) => s.selectedLayerId)
  const updateLayer = useCanvasStore((s) => s.updateLayer)
  const setRotation = useCanvasStore((s) => s.setRotation)

  const layer = layers.find((l) => l.id === selectedLayerId)
  if (!layer) return null

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm">
      <PanelHeader icon="gear">Properties</PanelHeader>

      <label className="flex items-center gap-2">
        <span className="text-xs text-ink-muted w-16">Name</span>
        <input
          type="text"
          value={layer.name}
          onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
          className="flex-1 min-w-0 bg-bg-base rounded px-2 py-1"
        />
      </label>

      {/* T-124 (15): kept until typing ends (`DraftField`). The boxes were controlled by `Number(e.target.value)` on every keystroke,
          and a number input reports "" for a lone "-", so the sign was eaten: "-50" was 50. A number inside the range goes straight
          to the layer as it is typed; a number outside it becomes the nearest edge when typing ends (one page beyond each edge). */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-ink-muted">x</span>
          <PositionBox value={layer.x} range={layerOffsetRange(docWidth)} onCommit={(x) => updateLayer(layer.id, { x })} />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-ink-muted">y</span>
          <PositionBox value={layer.y} range={layerOffsetRange(docHeight)} onCommit={(y) => updateLayer(layer.id, { y })} />
        </label>
      </div>

      {/* T-17: the seven rotation presets used to live inside this label, so
          every preset click also targeted the rotation field. Same defect
          class the sweep flagged in ClipList / TextOverlayEditor; the label
          now wraps only its own input. T-123 (24): the row WRAPS. Its label (w-16), box (w-20) and seven no-wrap
          presets are 406 px wide and the column is 260 px at its narrowest, so it was clipped behind the column's
          hidden horizontal scrollbar at every window size: only "0" and "15" showed at the default 1632 px window. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <label className="flex items-center gap-2">
          <span className="text-xs text-ink-muted w-16">Rotation</span>
          <DraftField
            type="number"
            step={0.5}
            min={LAYER_ROTATION_RANGE.min}
            max={LAYER_ROTATION_RANGE.max}
            value={String(Number(layer.rotation.toFixed(2)))}
            live={(typed) => isTypedInRange(typed, LAYER_ROTATION_RANGE.min, LAYER_ROTATION_RANGE.max, false)}
            commit={(typed) => {
              const n = clampTyped(typed, LAYER_ROTATION_RANGE.min, LAYER_ROTATION_RANGE.max, false)
              if (n !== null) setRotation(layer.id, n)
              return null
            }}
            className="w-20 bg-bg-base rounded px-1 py-0.5 font-mono"
          />
        </label>
        <span className="text-ink-dim">°</span>
        <div className="flex flex-wrap gap-1 ml-1">
          {ROTATION_PRESETS.map((r) => (
            <button
              key={r}
              className="px-1.5 py-0.5 text-xs bg-bg-hover rounded hover:bg-accent hover:text-bg-base"
              onClick={() => setRotation(layer.id, r)}
              // T-124 (30): "45, button" says nothing about what it does. The visible number stays the label's start (WCAG 2.5.3).
              aria-label={`Rotate ${r} degrees`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2">
        <span className="text-xs text-ink-muted w-16">Opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={layer.opacity}
          onChange={(e) => updateLayer(layer.id, { opacity: Number(e.target.value) })}
          className="flex-1 min-w-0"
          // M11 fix (round 15)
          aria-label="Layer opacity"
          aria-valuetext={`${Math.round(layer.opacity * 100)} percent`}
        />
        <span className="text-xs font-mono text-ink-muted w-10 shrink-0 whitespace-nowrap">
          {Math.round(layer.opacity * 100)}%
        </span>
      </label>

      {layer.type === 'rect' || layer.type === 'ellipse' ? (
        <FillStrokeFields layer={layer as RectLayer | EllipseLayer} />
      ) : null}

      {layer.type === 'text' ? <TextFields layer={layer as TextLayer} /> : null}
    </div>
  )
}

/** A layer's x or y: a whole number, kept until typing ends, held to one page beyond each edge (T-124 (15)). */
function PositionBox({
  value,
  range,
  onCommit
}: {
  value: number
  range: { min: number; max: number }
  onCommit: (n: number) => void
}): JSX.Element {
  return (
    <DraftField
      type="number"
      min={range.min}
      max={range.max}
      value={String(Math.round(value))}
      live={(typed) => isTypedInRange(typed, range.min, range.max)}
      commit={(typed) => {
        const n = clampTyped(typed, range.min, range.max)
        if (n !== null) onCommit(n)
        return null
      }}
      className="flex-1 min-w-0 bg-bg-base rounded px-1 py-0.5 font-mono"
    />
  )
}

function FillStrokeFields({
  layer
}: {
  layer: RectLayer | EllipseLayer
}): JSX.Element {
  const updateLayer = useCanvasStore((s) => s.updateLayer)
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="text-xs text-ink-muted w-16">Fill</span>
        <input
          type="text"
          value={layer.fill}
          onChange={(e) => updateLayer(layer.id, { fill: e.target.value } as Partial<CanvasLayer>)}
          className="flex-1 min-w-0 bg-bg-base rounded px-2 py-1 font-mono text-xs"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-xs text-ink-muted w-16">Stroke</span>
        <input
          type="text"
          value={layer.stroke}
          onChange={(e) =>
            updateLayer(layer.id, { stroke: e.target.value } as Partial<CanvasLayer>)
          }
          className="flex-1 min-w-0 bg-bg-base rounded px-2 py-1 font-mono text-xs"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-xs text-ink-muted w-16">Stroke px</span>
        <input
          type="number"
          min={0}
          value={layer.strokeWidth}
          onChange={(e) =>
            updateLayer(layer.id, {
              strokeWidth: Number(e.target.value) || 0
            } as Partial<CanvasLayer>)
          }
          className="w-20 bg-bg-base rounded px-1 py-0.5 font-mono"
        />
      </label>
    </>
  )
}

/** The smallest a text layer's size can be (px): the 4 its attribute says, enforced when typing ends. */
const FONT_SIZE_MIN = 4

function TextFields({ layer }: { layer: TextLayer }): JSX.Element {
  const updateLayer = useCanvasStore((s) => s.updateLayer)
  return (
    <>
      <label className="flex items-start gap-2">
        <span className="text-xs text-ink-muted w-16 mt-1">Text</span>
        <textarea
          value={layer.text}
          onChange={(e) =>
            updateLayer(layer.id, { text: e.target.value } as Partial<CanvasLayer>)
          }
          className="flex-1 min-w-0 bg-bg-base rounded px-2 py-1 min-h-[60px] resize-none"
        />
      </label>
      <label className="flex items-center gap-2">
        {/* T-125 (16): "(px)" like the Picture-in-picture and preset boxes - a bare number does not say what it counts. */}
        <span className="text-xs text-ink-muted w-16">Size (px)</span>
        {/* T-123 (4): kept until typing ends; `Number(typed) || 4` appended "72" to an emptied box as 472. */}
        <DraftField
          type="number"
          min={FONT_SIZE_MIN}
          value={String(layer.fontSize)}
          live={(typed) => isTypedInRange(typed, FONT_SIZE_MIN)}
          commit={(typed) => {
            const n = clampTyped(typed, FONT_SIZE_MIN)
            if (n !== null) updateLayer(layer.id, { fontSize: n } as Partial<CanvasLayer>)
            return null
          }}
          className="w-20 bg-bg-base rounded px-1 py-0.5 font-mono"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-xs text-ink-muted w-16">Color</span>
        <input
          type="text"
          value={layer.fill}
          onChange={(e) =>
            updateLayer(layer.id, { fill: e.target.value } as Partial<CanvasLayer>)
          }
          className="flex-1 min-w-0 bg-bg-base rounded px-2 py-1 font-mono text-xs"
        />
      </label>
    </>
  )
}
