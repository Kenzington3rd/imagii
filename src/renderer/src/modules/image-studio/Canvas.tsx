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
import type { CanvasLayer, ImageLayer, LineLayer, RectLayer, EllipseLayer, TextLayer } from '@shared/canvas'
import {
  makeEllipseLayer,
  makeLineLayer,
  makeRectLayer,
  useCanvasStore
} from './state/canvasStore'

interface ImageNodeProps {
  layer: ImageLayer
  isSelected: boolean
  onSelect: () => void
  onChange: (patch: Partial<ImageLayer>) => void
  draggable: boolean
  shapeRef: React.RefObject<Konva.Image>
}

function ImageNode({
  layer,
  onSelect,
  onChange,
  draggable,
  shapeRef
}: ImageNodeProps): JSX.Element | null {
  const [img] = useImage(layer.src, 'anonymous')
  if (!img) return null
  return (
    <KonvaImage
      ref={shapeRef}
      image={img}
      x={layer.x}
      y={layer.y}
      width={layer.width}
      height={layer.height}
      rotation={layer.rotation}
      scaleX={layer.scaleX}
      scaleY={layer.scaleY}
      opacity={layer.opacity}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => {
        const node = e.target
        onChange({
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
          scaleX: node.scaleX(),
          scaleY: node.scaleY()
        })
      }}
    />
  )
}

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
        stroke="rgba(149,149,165,0.18)"
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
        stroke="rgba(149,149,165,0.18)"
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

  useEffect(() => {
    if (!transformerRef.current) return
    if (!selectedLayerId) {
      transformerRef.current.nodes([])
      transformerRef.current.getLayer()?.batchDraw()
      return
    }
    const node = nodeRefs.current[selectedLayerId]
    if (node) {
      transformerRef.current.nodes([node])
      transformerRef.current.getLayer()?.batchDraw()
    }
  }, [selectedLayerId, doc.layers])

  function snap(value: number): number {
    if (!snapToGrid) return value
    return Math.round(value / gridSize) * gridSize
  }

  const stageScale = Math.min(
    containerSize.w / doc.width,
    containerSize.h / doc.height,
    1
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
      setPencilPoints([snap(pos.x), snap(pos.y)])
      return
    }
    setDrawing({ start: { x: snap(pos.x), y: snap(pos.y) }, current: { x: snap(pos.x), y: snap(pos.y) } })
  }

  function handleMouseMove(): void {
    const pos = pointerInDocCoords()
    if (!pos) return
    if (tool === 'pencil' && pencilPoints) {
      setPencilPoints((prev) => (prev ? [...prev, snap(pos.x), snap(pos.y)] : prev))
      return
    }
    if (drawing) {
      setDrawing({ ...drawing, current: { x: snap(pos.x), y: snap(pos.y) } })
    }
  }

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
    if (absW > 4 && absH > 4) {
      if (tool === 'rect') addLayer(makeRectLayer(x, y, absW, absH))
      else if (tool === 'ellipse')
        addLayer(makeEllipseLayer(x + absW / 2, y + absH / 2, absW / 2, absH / 2))
      else if (tool === 'line')
        addLayer(makeLineLayer([drawing.start.x, drawing.start.y, drawing.current.x, drawing.current.y]))
    }
    setDrawing(null)
  }

  function setNodeRef(id: string): (node: Konva.Node | null) => void {
    return (node) => {
      nodeRefs.current[id] = node
    }
  }

  function renderLayer(layer: CanvasLayer): JSX.Element | null {
    if (!layer.visible) return null
    const draggable = tool === 'select' && !layer.locked
    const onSelect = (): void => selectLayer(layer.id)
    const baseProps = {
      x: layer.x,
      y: layer.y,
      rotation: layer.rotation,
      scaleX: layer.scaleX,
      scaleY: layer.scaleY,
      opacity: layer.opacity,
      draggable,
      onClick: onSelect,
      onTap: onSelect,
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
        updateLayer(layer.id, {
          x: snap(e.target.x()),
          y: snap(e.target.y())
        }),
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
        const ref = { current: null as Konva.Image | null }
        return (
          <ImageNode
            key={layer.id}
            layer={layer}
            isSelected={layer.id === selectedLayerId}
            onSelect={onSelect}
            onChange={(p) => updateLayer(layer.id, p)}
            draggable={draggable}
            shapeRef={{ ...ref, current: nodeRefs.current[layer.id] as Konva.Image | null }}
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
        onMouseUp={handleMouseUp}
        style={{
          background: doc.background,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
        }}
      >
        <KonvaLayer>{doc.layers.map(renderLayer)}</KonvaLayer>
        {showGrid ? (
          <KonvaLayer listening={false}>
            <GridOverlay width={doc.width} height={doc.height} size={gridSize} />
          </KonvaLayer>
        ) : null}
        <KonvaLayer>
          {drawing && (tool === 'rect' || tool === 'ellipse' || tool === 'line') ? (
            tool === 'line' ? (
              <Line
                points={[drawing.start.x, drawing.start.y, drawing.current.x, drawing.current.y]}
                stroke="#a78bfa"
                strokeWidth={2}
                dash={[4, 4]}
              />
            ) : tool === 'rect' ? (
              <Rect
                x={Math.min(drawing.start.x, drawing.current.x)}
                y={Math.min(drawing.start.y, drawing.current.y)}
                width={Math.abs(drawing.current.x - drawing.start.x)}
                height={Math.abs(drawing.current.y - drawing.start.y)}
                stroke="#a78bfa"
                strokeWidth={2}
                dash={[4, 4]}
              />
            ) : (
              <Ellipse
                x={(drawing.start.x + drawing.current.x) / 2}
                y={(drawing.start.y + drawing.current.y) / 2}
                radiusX={Math.abs(drawing.current.x - drawing.start.x) / 2}
                radiusY={Math.abs(drawing.current.y - drawing.start.y) / 2}
                stroke="#a78bfa"
                strokeWidth={2}
                dash={[4, 4]}
              />
            )
          ) : null}
          {pencilPoints && pencilPoints.length >= 4 ? (
            <Line
              points={pencilPoints}
              stroke="#f472b6"
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
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < 5 || newBox.height < 5 ? oldBox : newBox
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

export function getStageDataUrl(): string | null {
  const stage = (window as unknown as { __imagiiStage?: Konva.Stage }).__imagiiStage
  if (!stage) return null
  return stage.toDataURL()
}
