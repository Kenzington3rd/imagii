import type { CanvasLayer, EllipseLayer, RectLayer, TextLayer } from '@shared/canvas'
import { useCanvasStore } from './state/canvasStore'
import { PanelHeader } from '../../components/PanelHeader'

const ROTATION_PRESETS = [0, 15, 30, 45, 90, 180, 270]

export function PropertiesPanel(): JSX.Element | null {
  const layers = useCanvasStore((s) => s.doc.layers)
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
          className="flex-1 bg-bg-base rounded px-2 py-1"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-ink-muted">x</span>
          <input
            type="number"
            value={Math.round(layer.x)}
            onChange={(e) => updateLayer(layer.id, { x: Number(e.target.value) })}
            className="flex-1 bg-bg-base rounded px-1 py-0.5 font-mono"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-ink-muted">y</span>
          <input
            type="number"
            value={Math.round(layer.y)}
            onChange={(e) => updateLayer(layer.id, { y: Number(e.target.value) })}
            className="flex-1 bg-bg-base rounded px-1 py-0.5 font-mono"
          />
        </label>
      </div>

      <label className="flex items-center gap-2">
        <span className="text-xs text-ink-muted w-16">Rotation</span>
        <input
          type="number"
          step={0.5}
          value={Number(layer.rotation.toFixed(2))}
          onChange={(e) => setRotation(layer.id, Number(e.target.value) || 0)}
          className="w-20 bg-bg-base rounded px-1 py-0.5 font-mono"
        />
        <span className="text-ink-dim">°</span>
        <div className="flex gap-1 ml-1">
          {ROTATION_PRESETS.map((r) => (
            <button
              key={r}
              className="px-1.5 py-0.5 text-xs bg-bg-hover rounded hover:bg-accent hover:text-bg-base"
              onClick={() => setRotation(layer.id, r)}
            >
              {r}
            </button>
          ))}
        </div>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-xs text-ink-muted w-16">Opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={layer.opacity}
          onChange={(e) => updateLayer(layer.id, { opacity: Number(e.target.value) })}
          className="flex-1"
        />
        <span className="text-xs font-mono text-ink-muted w-10">
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
          className="flex-1 bg-bg-base rounded px-2 py-1 font-mono text-xs"
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
          className="flex-1 bg-bg-base rounded px-2 py-1 font-mono text-xs"
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
          className="flex-1 bg-bg-base rounded px-2 py-1 min-h-[60px] resize-none"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-xs text-ink-muted w-16">Size</span>
        <input
          type="number"
          min={4}
          value={layer.fontSize}
          onChange={(e) =>
            updateLayer(layer.id, {
              fontSize: Number(e.target.value) || 4
            } as Partial<CanvasLayer>)
          }
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
          className="flex-1 bg-bg-base rounded px-2 py-1 font-mono text-xs"
        />
      </label>
    </>
  )
}
