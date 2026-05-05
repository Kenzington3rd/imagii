import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { ImageLayer } from '@shared/canvas'
import { useCanvasStore } from './state/canvasStore'
import { pickColorAt, replaceColor } from './tools/colorReplace'

export function ColorReplacePanel(): JSX.Element | null {
  const tool = useCanvasStore((s) => s.tool)
  const layers = useCanvasStore((s) => s.doc.layers)
  const selectedLayerId = useCanvasStore((s) => s.selectedLayerId)
  const updateLayer = useCanvasStore((s) => s.updateLayer)

  const [tolerance, setTolerance] = useState(20)
  const [replacement, setReplacement] = useState('#ffffff')
  const [pickedColor, setPickedColor] = useState<string | null>(null)
  const [pickedXY, setPickedXY] = useState<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const layer = layers.find((l) => l.id === selectedLayerId)
  const isImageLayer = layer?.type === 'image'

  useEffect(() => {
    if (tool !== 'colorReplace') return
    function onClick(e: MouseEvent): void {
      const target = e.target as HTMLElement
      const stageContainer = target.closest('[data-konva-stage]')
      if (!stageContainer) return
      const stage = (window as unknown as {
        __imagiiStage?: {
          getPointerPosition(): { x: number; y: number } | null
          scaleX(): number
        }
      }).__imagiiStage
      if (!stage || !layer || !isImageLayer) return
      const pointer = stage.getPointerPosition()
      if (!pointer) return
      const scale = stage.scaleX()
      const xInDoc = pointer.x / scale
      const yInDoc = pointer.y / scale
      const xInLayer = xInDoc - layer.x
      const yInLayer = yInDoc - layer.y
      void doPick(xInLayer, yInLayer)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        useCanvasStore.getState().setTool('select')
      }
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, layer?.id])

  async function doPick(x: number, y: number): Promise<void> {
    if (!layer || layer.type !== 'image') return
    const picked = await pickColorAt(layer.src, x, y)
    if (picked) {
      setPickedColor(picked.hex)
      setPickedXY({ x, y })
      toast(`Picked ${picked.hex}`)
    }
  }

  async function applyReplace(): Promise<void> {
    if (!layer || layer.type !== 'image' || !pickedXY) {
      toast.error('Click on the image first to pick a color')
      return
    }
    setBusy(true)
    try {
      const newSrc = await replaceColor(
        layer.src,
        pickedXY.x,
        pickedXY.y,
        replacement,
        tolerance
      )
      updateLayer(layer.id, { src: newSrc } as Partial<ImageLayer>)
      toast.success('Color replaced')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Replace failed')
    } finally {
      setBusy(false)
    }
  }

  if (tool !== 'colorReplace') return null

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm border-accent">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Color replace
        </h3>
        <button
          className="text-xs text-ink-dim hover:text-ink-base"
          onClick={() => useCanvasStore.getState().setTool('select')}
        >
          Done
        </button>
      </div>
      {!isImageLayer ? (
        <p className="text-xs text-amber-300">Select an image layer to use this tool.</p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-muted">Picked</span>
            {pickedColor ? (
              <>
                <span
                  className="inline-block w-5 h-5 rounded border border-ink-dim/40"
                  style={{ background: pickedColor }}
                />
                <span className="font-mono">{pickedColor}</span>
              </>
            ) : (
              <span className="text-ink-dim">Click on the image to pick a color</span>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-ink-muted w-20">Replace with</span>
            <input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              className="flex-1 bg-bg-base rounded px-2 py-1 font-mono"
            />
            <input
              type="color"
              value={replacement.length === 7 ? replacement : '#ffffff'}
              onChange={(e) => setReplacement(e.target.value)}
              className="w-8 h-7 bg-bg-base rounded"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-ink-muted w-20">Tolerance</span>
            <input
              type="range"
              min={1}
              max={100}
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
              className="flex-1"
            />
            <span className="font-mono w-8 text-right">{tolerance}</span>
          </label>
          <button
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            onClick={applyReplace}
            disabled={busy || !pickedColor}
          >
            {busy ? 'Replacing…' : 'Replace color'}
          </button>
          <p className="text-xs text-ink-dim">
            Tolerance is the maximum RGB distance counted as "similar". 20 is conservative; 60+
            bleeds across gradients.
          </p>
        </>
      )}
    </div>
  )
}
