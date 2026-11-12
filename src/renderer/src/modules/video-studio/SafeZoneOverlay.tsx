import { computeCropBox, type CropBox } from '@shared/safeZone'
import { EMBER, SIGNAL_CYAN, SIGNAL_PINK } from '../../styles/tokens'

/** The three crop guides. (T-112: a fourth, '16:9', had a color and a shape in the
 *  tables below and no caller — Player has only ever passed these three — so it was
 *  dead data, and a color reserved in the palette for a guide nobody draws.) */
type GuideRatio = '9:16' | '1:1' | '4:5'

interface SafeZoneOverlayProps {
  /** The picture's rectangle inside the player box, in CSS pixels — see
   *  Player's `useVideoContentRect`. null until it can be measured. */
  rect: CropBox | null
  show: boolean
  ratios: GuideRatio[]
}

export const RATIO_VALUE: Record<GuideRatio, number> = {
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5
}

const RATIO_COLOR: Record<GuideRatio, string> = {
  '9:16': SIGNAL_PINK,
  '1:1': EMBER,
  '4:5': SIGNAL_CYAN
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
      {/* T-112: decorative. The guides are a picture of what a platform keeps, drawn over
          the video; the labels in it ("9:16") are read out of context if the svg is exposed,
          and the Crop guides checkbox already says what they are. */}
      <svg
        width={picture.w}
        height={picture.h}
        viewBox={`0 0 ${picture.w} ${picture.h}`}
        aria-hidden="true"
      >
        {ratios.map((label) => {
          const targetAspect = RATIO_VALUE[label]
          // Phase 3.4: reuse the shared geometry helper rather than
          // recomputing inline. SafeZoneOverlay (here) and the export
          // pre-flight modal both source from the same function so the
          // preview matches what the modal warns about.
          const box = computeCropBox(picture.w, picture.h, targetAspect)
          const x = box.x
          const y = box.y
          const cropW = box.w
          const cropH = box.h
          const color = RATIO_COLOR[label]
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
