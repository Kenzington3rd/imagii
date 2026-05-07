import { useEffect, useRef, useState } from 'react'
import { computeCropBox } from '@shared/safeZone'

interface SafeZoneOverlayProps {
  videoElement: HTMLVideoElement | null
  show: boolean
  ratios: Array<'9:16' | '1:1' | '4:5' | '16:9'>
}

export const RATIO_VALUE: Record<string, number> = {
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '16:9': 16 / 9
}

const RATIO_COLOR: Record<string, string> = {
  '9:16': '#f472b6',
  '1:1': '#fbbf24',
  '4:5': '#22d3ee',
  '16:9': '#a78bfa'
}

export function SafeZoneOverlay({
  videoElement,
  show,
  ratios
}: SafeZoneOverlayProps): JSX.Element | null {
  const [size, setSize] = useState({ w: 0, h: 0 })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!videoElement) return
    function update(): void {
      if (!videoElement) return
      setSize({ w: videoElement.clientWidth, h: videoElement.clientHeight })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(videoElement)
    return () => ro.disconnect()
  }, [videoElement])

  if (!show || !videoElement || size.w === 0 || size.h === 0) return null

  return (
    <div
      ref={ref}
      className="absolute inset-0 pointer-events-none"
      style={{ width: size.w, height: size.h }}
    >
      <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
        {ratios.map((label) => {
          const targetAspect = RATIO_VALUE[label]
          if (!targetAspect) return null
          // Phase 3.4: reuse the shared geometry helper rather than
          // recomputing inline. SafeZoneOverlay (here) and the export
          // pre-flight modal both source from the same function so the
          // preview matches what the modal warns about.
          const box = computeCropBox(size.w, size.h, targetAspect)
          const x = box.x
          const y = box.y
          const cropW = box.w
          const cropH = box.h
          const color = RATIO_COLOR[label] ?? '#a78bfa'
          return (
            <g key={label}>
              <rect
                x={x}
                y={y}
                width={cropW}
                height={cropH}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeDasharray="6 4"
                opacity={0.85}
              />
              <text
                x={x + 6}
                y={y + 18}
                fontSize={12}
                fontFamily="monospace"
                fill={color}
                opacity={0.95}
              >
                {label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
