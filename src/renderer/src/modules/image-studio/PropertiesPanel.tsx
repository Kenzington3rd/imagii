import {
  LAYER_ROTATION_RANGE,
  layerOffsetRange,
  type CanvasLayer,
  type EllipseLayer,
  type RectLayer,
  type TextLayer
} from '@shared/canvas'
import { FONT_SIZE_MIN, useCanvasStore } from './state/canvasStore'
import { PanelHeader } from '../../components/PanelHeader'
import { useGestureEnd } from '../../lib/gestureEnd'
import { DraftField } from '../../components/DraftField'
import { clampTyped, isTypedInRange } from '@shared/draftNumber'
import { CANVAS_COLOR_REFUSAL, resolveCanvasColor } from './canvasColor'

const ROTATION_PRESETS = [0, 15, 30, 45, 90, 180, 270]

export function PropertiesPanel(): JSX.Element | null {
  const layers = useCanvasStore((s) => s.doc.layers)
  const docWidth = useCanvasStore((s) => s.doc.width)
  const docHeight = useCanvasStore((s) => s.doc.height)
  const selectedLayerId = useCanvasStore((s) => s.selectedLayerId)
  const updateLayer = useCanvasStore((s) => s.updateLayer)
  const setRotation = useCanvasStore((s) => s.setRotation)
  const gesture = useGestureEnd(useCanvasStore((s) => s.endGesture))

  const layer = layers.find((l) => l.id === selectedLayerId)
  if (!layer) return null

  return (
    // T-147 (T-78): one drag of the opacity slider, or one run of typing in the name / colour fields, is ONE undo step (`updateLayer`'s key). Releasing any control,
    // or a field losing focus, ends the window; a release inside the text field being typed in does not, and a blur during a press (the slider moving focus) is not an end (T-148: `useGestureEnd`, the one hook every coalescing card spreads).
    <div className="card p-3 flex flex-col gap-3 text-sm" {...gesture}>
      <PanelHeader icon="gear">Properties</PanelHeader>

      <label className="flex items-center gap-2">
        <span className="text-xs text-ink-muted w-16">Name</span>
        <input
          type="text"
          value={layer.name}
          onChange={(e) => updateLayer(layer.id, { name: e.target.value }, 'name')}
          className="flex-1 min-w-0 bg-bg-base rounded px-2 py-1"
        />
      </label>

      {/* T-124 (15): kept until typing ends (`DraftField`). The boxes were controlled by `Number(e.target.value)` on every keystroke,
          and a number input reports "" for a lone "-", so the sign was eaten: "-50" was 50. A number inside the range goes straight
          to the layer as it is typed; a number outside it becomes the nearest edge when typing ends (one page beyond each edge). */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-ink-muted">X (px)</span>
          <PositionBox value={layer.x} range={layerOffsetRange(docWidth)} onCommit={(x) => updateLayer(layer.id, { x }, 'x')} />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-ink-muted">Y (px)</span>
          <PositionBox value={layer.y} range={layerOffsetRange(docHeight)} onCommit={(y) => updateLayer(layer.id, { y }, 'y')} />
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
              if (n !== null) updateLayer(layer.id, { rotation: n }, 'rotation')
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
          onChange={(e) => updateLayer(layer.id, { opacity: Number(e.target.value) }, 'opacity')}
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

/**
 * A layer's x or y: a whole number, kept until typing ends, held to one page beyond each edge (T-124 (15)).
 * T-153 (1): every number box in this panel (this one, Rotation, Size (px), Stroke (px)) passes its own key to `updateLayer`. A number typed key by key is committed live on each
 * keystroke, and without a key each commit was an undo step ("12" was two); leaving the box closes the window (`gesture` above). The rotation presets are single presses, one step each.
 */
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

// A row that WRAPS, so a refusal takes a full-width row of its own under the box (DraftField's doc, T-126 (3)).
const COLOR_ROW = 'flex flex-wrap items-center gap-x-2 gap-y-0.5'

const supportsColor = (css: string): boolean => CSS.supports('color', css)

/**
 * T-186 (1): the Fill, Stroke and text Color boxes, in the shape of the Video overlay's Color box (T-113, T-114). They were bare `<input>`s that stored every keystroke
 * as typed, and a canvas ignores a `fillStyle` it cannot parse: `ff3131` (a hex pasted without its `#`) or a typo drew the shape black with no word, and an emptied
 * box drew no fill at all (a text layer went invisible), the text riding into the export, the autosave and Save project. Now a colour the canvas can draw
 * (`resolveCanvasColor`) is stored as the colour it resolves to, when typing ends (leaving the box, or Enter: one Undo step under the control's own key); anything else is
 * refused in a sentence and the layer is left exactly as it was. There is NO `live` commit, as in the overlay Color box: "blue" is a colour on its way to "blueviolet", and a
 * half-typed code (`#ffcc0`) would leave the layer on its last valid prefix (`#ffcc`), a colour the person never chose, beside a sentence saying it was not understood. "No fill" is `transparent`. Each site is keyed by the layer: a refused draft is
 * state of the box, and the next layer selected must not inherit it (the number boxes above share that gap, which a number draft rarely meets).
 */
function ColorBox({
  layerId,
  field,
  caption,
  value
}: {
  layerId: string
  field: 'fill' | 'stroke'
  caption: string
  value: string
}): JSX.Element {
  const updateLayer = useCanvasStore((s) => s.updateLayer)
  return (
    <DraftField
      type="text"
      value={value}
      placeholder="white or #ffcc00"
      // The caption alone names the box: the refusal sentence sits inside the row's <label> and would otherwise be read as part of its name.
      aria-label={caption}
      commit={(typed) => {
        const color = resolveCanvasColor(typed, supportsColor)
        if (color === null) return CANVAS_COLOR_REFUSAL
        updateLayer(layerId, { [field]: color } as Partial<CanvasLayer>, field)
        return null
      }}
      className="flex-1 min-w-0 bg-bg-base rounded px-2 py-1 font-mono text-xs"
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
      <label className={COLOR_ROW}>
        <span className="text-xs text-ink-muted w-16">Fill</span>
        <ColorBox key={layer.id} layerId={layer.id} field="fill" caption="Fill" value={layer.fill} />
      </label>
      <label className={COLOR_ROW}>
        <span className="text-xs text-ink-muted w-16">Stroke</span>
        <ColorBox key={layer.id} layerId={layer.id} field="stroke" caption="Stroke" value={layer.stroke} />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-xs text-ink-muted w-16">Stroke (px)</span>
        {/* T-152 (5): kept until typing ends, like Size (px); `Number(typed) || 0` with only `min={0}` stored a typed negative, and a non-positive lineWidth is drawn at the previous shape's width. */}
        <DraftField
          type="number"
          min={0}
          value={String(layer.strokeWidth)}
          live={(typed) => isTypedInRange(typed, 0)}
          commit={(typed) => {
            const n = clampTyped(typed, 0)
            if (n !== null) updateLayer(layer.id, { strokeWidth: n } as Partial<CanvasLayer>, 'strokeWidth')
            return null
          }}
          className="w-20 bg-bg-base rounded px-1 py-0.5 font-mono"
        />
      </label>
    </>
  )
}

function TextFields({ layer }: { layer: TextLayer }): JSX.Element {
  const updateLayer = useCanvasStore((s) => s.updateLayer)
  return (
    <>
      <label className="flex items-start gap-2">
        <span className="text-xs text-ink-muted w-16 mt-1">Text</span>
        <textarea
          value={layer.text}
          onChange={(e) =>
            updateLayer(layer.id, { text: e.target.value } as Partial<CanvasLayer>, 'text')
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
            if (n !== null) updateLayer(layer.id, { fontSize: n } as Partial<CanvasLayer>, 'fontSize')
            return null
          }}
          className="w-20 bg-bg-base rounded px-1 py-0.5 font-mono"
        />
      </label>
      <label className={COLOR_ROW}>
        <span className="text-xs text-ink-muted w-16">Color</span>
        <ColorBox key={layer.id} layerId={layer.id} field="fill" caption="Color" value={layer.fill} />
      </label>
    </>
  )
}
