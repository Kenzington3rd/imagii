import { useEffect, useRef, useState } from 'react'

interface SafeZoneOverlayProps {
  videoElement: HTMLVideoElement | null
  show: boolean
  ratios: Array<'9:16' | '1:1' | '4:5' | '16:9'>
}

const RATIO_VALUE: Record<string, number> = {
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

  const sourceAspect = size.w / size.h

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
          let cropW: number
          let cropH: number
          if (sourceAspect > targetAspect) {
            cropH = size.h
            cropW = cropH * targetAspect
          } else {
            cropW = size.w
            cropH = cropW / targetAspect
          }
          const x = (size.w - cropW) / 2
          const y = (size.h - cropH) / 2
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
