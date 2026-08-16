import { computeCropBox, type CropBox } from '@shared/safeZone'
import { ACCENT } from '../../styles/tokens'

interface SafeZoneOverlayProps {
  /** The picture's rectangle inside the player box, in CSS pixels — see
   *  Player's `useVideoContentRect`. null until it can be measured. */
  rect: CropBox | null
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
  '16:9': ACCENT
}

/**
 * The framing guides, drawn on the PICTURE rather than on the player's black
 * box (T-39). A guide is a promise about what a platform will keep, so one
 * drawn across a letterbox bar is worse than no guide at all.
 */
export function SafeZoneOverlay({ rect, show, ratios }: SafeZoneOverlayProps): JSX.Element | null {
  if (!show || !rect || rect.w <= 0 || rect.h <= 0) return null
  const picture = rect

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: picture.x, top: picture.y, width: picture.w, height: picture.h }}
    >
      <svg width={picture.w} height={picture.h} viewBox={`0 0 ${picture.w} ${picture.h}`}>
        {ratios.map((label) => {
          const targetAspect = RATIO_VALUE[label]
          if (!targetAspect) return null
          // Phase 3.4: reuse the shared geometry helper rather than
          // recomputing inline. SafeZoneOverlay (here) and the export
          // pre-flight modal both source from the same function so the
          // preview matches what the modal warns about.
          const box = computeCropBox(picture.w, picture.h, targetAspect)
          const x = box.x
          const y = box.y
          const cropW = box.w
          const cropH = box.h
          const color = RATIO_COLOR[label] ?? ACCENT
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
