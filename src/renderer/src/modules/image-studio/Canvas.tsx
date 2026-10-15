import { useEffect, useRef, useState } from 'react'
import {
  Stage,
  Layer as KonvaLayer,
  Image as KonvaImage,
  Rect,
  Ellipse,
  Line,
  Text,
  Transformer,
  Group
} from 'react-konva'
import useImage from 'use-image'
import type Konva from 'konva'
import {
  HINT_NODE_NAME,
  displayOpacity,
  type CanvasLayer,
  type ImageLayer,
  type LineLayer,
  type RectLayer,
  type EllipseLayer,
  type TextLayer
} from '@shared/canvas'
import {
  makeEllipseLayer,
  makeLineLayer,
  makeRectLayer,
  useCanvasStore
} from './state/canvasStore'
import { ACCENT, EMBER, INK_MUTED, withAlpha } from '../../styles/tokens'

/**
 * What every layer type shares on the stage: where it is, how it is transformed, and the handlers that make it selectable,
 * draggable (snapped) and transformable. One object per layer, built in `renderLayer`.
 */
interface NodeBaseProps {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
  opacity: number
  name: string | undefined
  draggable: boolean
  onClick: () => void
  onTap: () => void
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void
}

interface ImageNodeProps {
  layer: ImageLayer
  base: NodeBaseProps
  /** The callback ref that registers the node for the Transformer (T-124 (8)): the same one the other layer types use. */
  shapeRef: (node: Konva.Image | null) => void
}

/**
 * T-124 (8), (14): a picture is a node like the others. It used to rebuild its handlers (a drag end that skipped Snap) and to
 * be handed a throwaway ref object (`{ ...ref, current: ... }`) whose writes never reached the table the Transformer attaches
 * from, so no picture ever had handles. It spreads the shared props and registers through the shared ref callback. The node only
 * exists once `use-image` has decoded the bitmap, which is why registering has to tell the canvas (see `setNodeRef`).
 */
function ImageNode({ layer, base, shapeRef }: ImageNodeProps): JSX.Element | null {
  const [img] = useImage(layer.src, 'anonymous')
  if (!img) return null
  return <KonvaImage ref={shapeRef} image={img} width={layer.width} height={layer.height} {...base} />
}

/**
 * T-71: the grid was two hand-copied `rgba(165,154,151,0.18)` literals —
 * `INK_MUTED` at 18%, spelled out, twice. `withAlpha` is the mechanical
 * form; a literal cannot follow the token it was copied from.
 */
const GRID_LINE = withAlpha(INK_MUTED, 0.18)

function GridOverlay({
  width,
  height,
  size
}: {
  width: number
  height: number
  size: number
}): JSX.Element {
  const lines: JSX.Element[] = []
  for (let x = 0; x <= width; x += size) {
    lines.push(
      <Line
        key={`vx-${x}`}
        points={[x, 0, x, height]}
        stroke={GRID_LINE}
        strokeWidth={1}
        listening={false}
      />
    )
  }
  for (let y = 0; y <= height; y += size) {
    lines.push(
      <Line
        key={`vy-${y}`}
        points={[0, y, width, y]}
        stroke={GRID_LINE}
        strokeWidth={1}
        listening={false}
      />
    )
  }
  return <Group>{lines}</Group>
}

export function Canvas(): JSX.Element {
  const doc = useCanvasStore((s) => s.doc)
  const tool = useCanvasStore((s) => s.tool)
  const showGrid = useCanvasStore((s) => s.showGrid)
  const snapToGrid = useCanvasStore((s) => s.snapToGrid)
  const gridSize = useCanvasStore((s) => s.gridSize)
  const selectedLayerId = useCanvasStore((s) => s.selectedLayerId)
  const selectLayer = useCanvasStore((s) => s.selectLayer)
  const addLayer = useCanvasStore((s) => s.addLayer)
  const updateLayer = useCanvasStore((s) => s.updateLayer)

  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef<Record<string, Konva.Node | null>>({})
  const [drawing, setDrawing] = useState<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(null)
  const [pencilPoints, setPencilPoints] = useState<number[] | null>(null)
  // T-124 (8): bumped when the SELECTED layer's node mounts or changes (a picture mounts only after it has decoded), so the
  // attach below runs for a node that was not there when the selection was made.
  const [nodeTick, setNodeTick] = useState(0)
  const selectedIdRef = useRef(selectedLayerId)
  selectedIdRef.current = selectedLayerId

  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    function update(): void {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) setContainerSize({ w: Math.max(400, rect.width), h: Math.max(300, rect.height) })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // The Transformer follows the selection. It is attached again when the TOOL changes (T-124 (9): drawing selects the new shape
  // while the tool is a draw tool and no Transformer is mounted, and pressing Select mounts one that nothing attached), and when
  // the selected node mounts (T-124 (8)). It holds NOTHING for a layer it cannot show or may not change: a node that does not
  // exist yet, an invisible layer, and (T-124 (13)) a locked one - `draggable` honored the lock and the handles did not, so a
  // locked layer still resized and rotated. Detaching rather than leaving the previous node attached is what stops the handles
  // sticking to the layer before.
  useEffect(() => {
    const tr = transformerRef.current
    if (!tr) return
    const layer = doc.layers.find((l) => l.id === selectedLayerId)
    const node = layer && layer.visible && !layer.locked ? nodeRefs.current[layer.id] : null
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedLayerId, doc.layers, tool, nodeTick])

  function snap(value: number, _axis: 'x' | 'y'): number {
    if (!snapToGrid) return value
    return Math.round(value / gridSize) * gridSize
  }

  // Fit-to-container scaling, with a generous max-zoom cap. Previously
  // capped at 1.0, which meant a 1920×1080 document on a 4K monitor with
  // a 2500-wide container only rendered at 1:1 (1920×1080), leaving lots
  // of empty space. Now allows up to 4× zoom so big monitors get a big
  // visible canvas, while a 112×112 emote can't blow up to fill a 4K
  // screen entirely (which would look comically pixelated). 4× balances:
  //   - 1080p doc on 4K (container ~2500): 1.3× fits, sharp
  //   - 720p doc on 4K (container ~2500): 1.8× fits, sharp
  //   - 112px emote on 4K (container ~2500): cap to 4×, still readable
  const MAX_STAGE_ZOOM = 4
  const stageScale = Math.min(
    containerSize.w / doc.width,
    containerSize.h / doc.height,
    MAX_STAGE_ZOOM
  )
  const stageWidth = doc.width * stageScale
  const stageHeight = doc.height * stageScale

  function pointerInDocCoords(): { x: number; y: number } | null {
    const stage = stageRef.current
    if (!stage) return null
    const pos = stage.getPointerPosition()
    if (!pos) return null
    return { x: pos.x / stageScale, y: pos.y / stageScale }
  }

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>): void {
    if (tool === 'select') {
      if (e.target === e.target.getStage()) selectLayer(null)
      return
    }
    const pos = pointerInDocCoords()
    if (!pos) return
    if (tool === 'pencil') {
      setPencilPoints([snap(pos.x, 'x'), snap(pos.y, 'y')])
      return
    }
    setDrawing({
      start: { x: snap(pos.x, 'x'), y: snap(pos.y, 'y') },
      current: { x: snap(pos.x, 'x'), y: snap(pos.y, 'y') }
    })
  }

  function handleMouseMove(): void {
    const pos = pointerInDocCoords()
    if (!pos) return
    if (tool === 'pencil' && pencilPoints) {
      setPencilPoints((prev) =>
        prev ? [...prev, snap(pos.x, 'x'), snap(pos.y, 'y')] : prev
      )
      return
    }
    if (drawing) {
      setDrawing({ ...drawing, current: { x: snap(pos.x, 'x'), y: snap(pos.y, 'y') } })
    }
  }

  // The smallest a drawn shape is (px): a click, or a hand that wobbled, is not a shape.
  const MIN_DRAW_PX = 4
  // The smallest a side of the selection box may be shrunk to (screen px).
  const MIN_BOX_PX = 5

  function handleMouseUp(): void {
    if (tool === 'pencil' && pencilPoints) {
      if (pencilPoints.length >= 4) {
        addLayer(makeLineLayer(pencilPoints, false))
      }
      setPencilPoints(null)
      return
    }
    if (!drawing) return
    const w = drawing.current.x - drawing.start.x
    const h = drawing.current.y - drawing.start.y
    const x = w >= 0 ? drawing.start.x : drawing.current.x
    const y = h >= 0 ? drawing.start.y : drawing.current.y
    const absW = Math.abs(w)
    const absH = Math.abs(h)
    if (tool === 'line') {
      // T-124 (11): a line is gated on its LENGTH. A box needs both sides to have size, and a straight line has none on one
      // (Snap makes `dy = 0` certain), so the box rule refused every horizontal and vertical line.
      if (Math.hypot(w, h) > MIN_DRAW_PX) {
        addLayer(makeLineLayer([drawing.start.x, drawing.start.y, drawing.current.x, drawing.current.y]))
      }
    } else if (absW > MIN_DRAW_PX && absH > MIN_DRAW_PX) {
      if (tool === 'rect') addLayer(makeRectLayer(x, y, absW, absH))
      else if (tool === 'ellipse')
        addLayer(makeEllipseLayer(x + absW / 2, y + absH / 2, absW / 2, absH / 2))
    }
    setDrawing(null)
  }

  // T-124 (10): a draw ends when the button comes up ANYWHERE. `onMouseUp` was on the Stage alone, so a release outside it
  // (the pointer left the canvas on the way to the corner) never ended the draw: the shape was lost and the dashed preview
  // followed the pointer back in with no button down. While a draw is in progress the window hears the release, with the last
  // position the canvas saw as the shape's far corner.
  const finishDrawRef = useRef(handleMouseUp)
  finishDrawRef.current = handleMouseUp
  const drawInProgress = drawing !== null || pencilPoints !== null
  useEffect(() => {
    if (!drawInProgress) return
    const onUp = (): void => finishDrawRef.current()
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [drawInProgress])

  // One stable callback per layer id: a new function every render would make React call it with null and then the node on every
  // render. Registers the node for the Transformer, and when it is the SELECTED layer's node that appeared (or changed) it asks
  // the attach effect to run again (T-124 (8)).
  const nodeRefCallbacks = useRef<Record<string, (node: Konva.Node | null) => void>>({})
  function setNodeRef(id: string): (node: Konva.Node | null) => void {
    const known = nodeRefCallbacks.current[id]
    if (known) return known
    const callback = (node: Konva.Node | null): void => {
      const had = nodeRefs.current[id]
      nodeRefs.current[id] = node
      if (node && node !== had && id === selectedIdRef.current) setNodeTick((t) => t + 1)
    }
    nodeRefCallbacks.current[id] = callback
    return callback
  }

  function renderLayer(layer: CanvasLayer): JSX.Element | null {
    if (!layer.visible) return null
    const draggable = tool === 'select' && !layer.locked
    const onSelect = (): void => selectLayer(layer.id)
    const baseProps: NodeBaseProps = {
      x: layer.x,
      y: layer.y,
      rotation: layer.rotation,
      scaleX: layer.scaleX,
      scaleY: layer.scaleY,
      opacity: layer.opacity,
      // T-91: a hint node carries this name so the export capture can switch
      // it off (captureDocument), exactly as it does the `chrome` layers.
      name: layer.hint ? HINT_NODE_NAME : undefined,
      draggable,
      onClick: onSelect,
      onTap: onSelect,
      // T-124 (14): the node is put ON the snapped position as well as the store. When the snapped value equals the layer's
      // old one (a drag shorter than half a cell) the store's x does not change, React sees no new prop, and Konva would
      // leave the node where the pointer let go of it.
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
        const x = snap(e.target.x(), 'x')
        const y = snap(e.target.y(), 'y')
        e.target.position({ x, y })
        updateLayer(layer.id, { x, y })
      },
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
        const node = e.target
        updateLayer(layer.id, {
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
          scaleX: node.scaleX(),
          scaleY: node.scaleY()
        })
      }
    }
    switch (layer.type) {
      case 'image': {
        return (
          <ImageNode
            key={layer.id}
            layer={layer}
            base={baseProps}
            shapeRef={setNodeRef(layer.id) as (node: Konva.Image | null) => void}
          />
        )
      }
      case 'rect': {
        const r = layer as RectLayer
        return (
          <Rect
            key={layer.id}
            ref={setNodeRef(layer.id)}
            {...baseProps}
            width={r.width}
            height={r.height}
            fill={r.fill}
            stroke={r.stroke}
            strokeWidth={r.strokeWidth}
            cornerRadius={r.cornerRadius}
          />
        )
      }
      case 'ellipse': {
        const el = layer as EllipseLayer
        return (
          <Ellipse
            key={layer.id}
            ref={setNodeRef(layer.id)}
            {...baseProps}
            radiusX={el.radiusX}
            radiusY={el.radiusY}
            fill={el.fill}
            stroke={el.stroke}
            strokeWidth={el.strokeWidth}
          />
        )
      }
      case 'line': {
        const l = layer as LineLayer
        return (
          <Line
            key={layer.id}
            ref={setNodeRef(layer.id)}
            {...baseProps}
            points={l.points}
            stroke={l.stroke}
            strokeWidth={l.strokeWidth}
            closed={l.closed}
            lineCap="round"
            lineJoin="round"
            tension={0.2}
          />
        )
      }
      case 'text': {
        const t = layer as TextLayer
        return (
          <Text
            key={layer.id}
            ref={setNodeRef(layer.id)}
            {...baseProps}
            // T-112: a hint's words are drawn dimmed — the canvas shows what the export
            // will not have. Last, so it wins over baseProps' own `opacity`.
            opacity={displayOpacity(t)}
            text={t.text}
            fontSize={t.fontSize}
            fontFamily={t.fontFamily}
            fill={t.fill}
          />
        )
      }
      default:
        return null
    }
  }

  useEffect(() => {
    if (stageRef.current) {
      ;(window as unknown as { __imagiiStage?: Konva.Stage }).__imagiiStage = stageRef.current
    }
  })

  return (
    <div ref={containerRef} className="relative flex-1 min-h-[400px] bg-bg-base/60 rounded-lg overflow-hidden flex items-center justify-center">
      <Stage
        ref={stageRef}
        width={stageWidth}
        height={stageHeight}
        scaleX={stageScale}
        scaleY={stageScale}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        style={{
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
        }}
      >
        <KonvaLayer>
          {/*
            T-54: the document's background, drawn as the first NODE of the
            document layer. It used to be a CSS `background` on the stage
            element, which Konva cannot see — `Stage._toKonvaCanvas` draws
            nodes — so every export dropped it: PNGs came out transparent and
            JPGs, having no alpha, composited onto black, while the canvas
            showed the template's fill. Drawing it here rather than painting
            it inside the capture keeps ONE render of `doc.background`, so the
            screen and every export (single, emote pack, variants, anything
            added later) agree by construction instead of by two code paths
            staying in step. It is deliberately NOT tagged `chrome`: that tag
            means "hide for the capture", which is the opposite of why this
            exists. `listening={false}` keeps an empty-canvas click on the
            Stage itself, which is what deselects. A `transparent` fill (the
            overlay and emote templates) draws nothing at all, so those
            documents still export with a real alpha channel.
          */}
          <Rect
            name="background"
            x={0}
            y={0}
            width={doc.width}
            height={doc.height}
            fill={doc.background}
            listening={false}
          />
          {doc.layers.map(renderLayer)}
        </KonvaLayer>
        {/*
          T-53: the two layers below are the EDITOR's, not the document's — the
          grid the user aligns against and the in-progress/selection chrome.
          Konva's `Stage._toKonvaCanvas` draws every visible layer, so they are
          tagged `chrome` for `captureDocument` (ExportDialog.tsx) to switch off
          for the duration of a capture. A new editor-only layer needs the same
          tag or it lands in the user's PNG.
        */}
        {showGrid ? (
          <KonvaLayer name="grid chrome" listening={false}>
            <GridOverlay width={doc.width} height={doc.height} size={gridSize} />
          </KonvaLayer>
        ) : null}
        <KonvaLayer name="overlay chrome">
          {drawing && (tool === 'rect' || tool === 'ellipse' || tool === 'line') ? (
            tool === 'line' ? (
              <Line
                points={[drawing.start.x, drawing.start.y, drawing.current.x, drawing.current.y]}
                stroke={ACCENT}
                strokeWidth={2}
                dash={[4, 4]}
              />
            ) : tool === 'rect' ? (
              <Rect
                x={Math.min(drawing.start.x, drawing.current.x)}
                y={Math.min(drawing.start.y, drawing.current.y)}
                width={Math.abs(drawing.current.x - drawing.start.x)}
                height={Math.abs(drawing.current.y - drawing.start.y)}
                stroke={ACCENT}
                strokeWidth={2}
                dash={[4, 4]}
              />
            ) : (
              <Ellipse
                x={(drawing.start.x + drawing.current.x) / 2}
                y={(drawing.start.y + drawing.current.y) / 2}
                radiusX={Math.abs(drawing.current.x - drawing.start.x) / 2}
                radiusY={Math.abs(drawing.current.y - drawing.start.y) / 2}
                stroke={ACCENT}
                strokeWidth={2}
                dash={[4, 4]}
              />
            )
          ) : null}
          {pencilPoints && pencilPoints.length >= 4 ? (
            <Line
              points={pencilPoints}
              stroke={EMBER}
              strokeWidth={3}
              lineCap="round"
              lineJoin="round"
              tension={0.2}
            />
          ) : null}
          {tool === 'select' ? (
            <Transformer
              ref={transformerRef}
              rotateEnabled
              keepRatio={false}
              // A box may not be shrunk below 5 px on a side. T-124 (11): only a SHRINK is refused. The rule used to refuse any box
              // under 5 px, and a straight line is as thin as its stroke (about 2 px at the usual zoom), so every move of its handles
              // (stretching it, rotating it) came back as "no change": the first horizontal line the Line tool allowed could not be
              // resized at all.
              boundBoxFunc={(oldBox, newBox) =>
                (newBox.width < MIN_BOX_PX && newBox.width < oldBox.width) ||
                (newBox.height < MIN_BOX_PX && newBox.height < oldBox.height)
                  ? oldBox
                  : newBox
              }
            />
          ) : null}
        </KonvaLayer>
      </Stage>
      <div className="absolute bottom-2 right-2 text-xs text-ink-dim font-mono bg-bg-elevated/80 px-2 py-0.5 rounded">
        {doc.width} × {doc.height} · {Math.round(stageScale * 100)}%
      </div>
    </div>
  )
}
