import { Rnd } from 'react-rnd'
import type { CropBox } from '@shared/safeZone'
import { useVideoStore } from './store/videoStore'

export type AspectMode = 'free' | '16:9' | '9:16' | '1:1' | '4:5'

const ASPECTS: Record<AspectMode, number | null> = {
  free: null,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5
}

const PRESETS: AspectMode[] = ['free', '16:9', '9:16', '1:1', '4:5']

interface CropControlsProps {
  enabled: boolean
  onEnabledChange: (on: boolean) => void
  aspect: AspectMode
  onAspectChange: (mode: AspectMode) => void
}

/**
 * The Crop control row. Rendered ABOVE the player box (T-39): the tutorial's
 * crop step tells the user to "tick 'Crop' above the player", and the row
 * used to render as a flex sibling of the <video> INSIDE the player's black
 * box — beside the picture, squeezing it sideways.
 *
 * The rectangle it switches on is `CropOverlay` below, which Player renders
 * inside the box. They are two components rather than one so each sits where
 * it belongs; the pair's shared state (on/off, locked aspect) lives in Player.
 */
export function CropControls({
  enabled,
  onEnabledChange,
  aspect,
  onAspectChange
}: CropControlsProps): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const setClipCrop = useVideoStore((s) => s.setClipCrop)

  const clip = clips.find((c) => c.id === selectedClipId) ?? null
  if (!source || !clip) return null
  const activeClip = clip
  const probe = source.probe

  function applyAspectPreset(mode: AspectMode): void {
    onAspectChange(mode)
    const ratio = ASPECTS[mode]
    if (!ratio) return
    // T-39: normalized against the SOURCE frame, which is what the stored
    // rect means everywhere else — ExportPanel and OutputPreview both
    // multiply it back out by the probe's dimensions. The rendered picture is
    // contain-fitted to that same aspect, so this is the number the on-screen
    // box used to supply, minus the dependency on the window's width.
    const sourceAspect = probe.width / probe.height
    if (!Number.isFinite(sourceAspect) || sourceAspect <= 0) return
    let normW: number
    let normH: number
    if (ratio > sourceAspect) {
      normW = 0.9
      normH = (normW * sourceAspect) / ratio
    } else {
      normH = 0.9
      normW = (normH * ratio) / sourceAspect
    }
    setClipCrop(activeClip.id, {
      x: (1 - normW) / 2,
      y: (1 - normH) / 2,
      w: normW,
      h: normH
    })
  }

  function clearCrop(): void {
    setClipCrop(activeClip.id, null)
  }

  return (
    // T-16: the tutorial's crop step highlighted nothing — this control
    // row is what its copy describes ("tick 'Crop' above the player").
    <div className="flex items-center gap-2 text-xs" data-tutorial="video-crop">
      <label className="flex items-center gap-1.5 text-ink-muted">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            const value = e.target.checked
            onEnabledChange(value)
            if (!value) clearCrop()
          }}
        />
        Crop
      </label>
      {enabled ? (
        <>
          {PRESETS.map((m) => (
            <button
              key={m}
              className={`px-2 py-1 rounded ${
                aspect === m ? 'bg-accent text-bg-base' : 'bg-bg-hover text-ink-base'
              }`}
              onClick={() => applyAspectPreset(m)}
            >
              {m}
            </button>
          ))}
          <button className="ml-auto text-ink-dim hover:text-ink-base" onClick={clearCrop}>
            Reset
          </button>
        </>
      ) : null}
    </div>
  )
}

interface CropOverlayProps {
  /** The picture's rectangle inside the player box, in CSS pixels — see
   *  Player's `useVideoContentRect`. null until it can be measured. */
  rect: CropBox | null
  aspect: AspectMode
}

/**
 * The draggable crop rectangle, positioned on the PICTURE rather than on the
 * player's black box (T-39). The stored rect is normalized to the frame, so
 * anchoring it to the box let a user place a crop over a black bar and get
 * an export that framed something else entirely.
 */
export function CropOverlay({ rect, aspect }: CropOverlayProps): JSX.Element | null {
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const setClipCrop = useVideoStore((s) => s.setClipCrop)

  const clip = clips.find((c) => c.id === selectedClipId) ?? null
  if (!clip || !rect || rect.w <= 0 || rect.h <= 0) return null
  const activeClip = clip
  const picture = rect

  const cropRect = clip.cropRect ?? { x: 0, y: 0, w: 1, h: 1 }
  const lockRatio = ASPECTS[aspect]

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: picture.x, top: picture.y, width: picture.w, height: picture.h }}
    >
      <Rnd
        bounds="parent"
        lockAspectRatio={lockRatio ?? false}
        position={{
          x: cropRect.x * picture.w,
          y: cropRect.y * picture.h
        }}
        size={{
          width: cropRect.w * picture.w,
          height: cropRect.h * picture.h
        }}
        onDragStop={(_e, d) => {
          setClipCrop(activeClip.id, {
            x: Math.max(0, Math.min(1 - cropRect.w, d.x / picture.w)),
            y: Math.max(0, Math.min(1 - cropRect.h, d.y / picture.h)),
            w: cropRect.w,
            h: cropRect.h
          })
        }}
        onResizeStop={(_e, _dir, ref, _delta, position) => {
          setClipCrop(activeClip.id, {
            x: Math.max(0, position.x / picture.w),
            y: Math.max(0, position.y / picture.h),
            w: ref.offsetWidth / picture.w,
            h: ref.offsetHeight / picture.h
          })
        }}
        className="pointer-events-auto border-2 border-accent"
        style={{
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
          boxSizing: 'border-box'
        }}
      />
    </div>
  )
}
