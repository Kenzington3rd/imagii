import { useEffect, useMemo, useRef, useState } from 'react'
import { Rnd } from 'react-rnd'
import { useVideoStore } from './store/videoStore'

type AspectMode = 'free' | '16:9' | '9:16' | '1:1' | '4:5'

const ASPECTS: Record<AspectMode, number | null> = {
  free: null,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5
}

interface CropOverlayProps {
  videoElement: HTMLVideoElement | null
}

export function CropOverlay({ videoElement }: CropOverlayProps): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const setClipCrop = useVideoStore((s) => s.setClipCrop)

  const containerRef = useRef<HTMLDivElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [aspect, setAspect] = useState<AspectMode>('free')
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

  const clip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) ?? null,
    [clips, selectedClipId]
  )

  useEffect(() => {
    if (!videoElement) return
    function update(): void {
      if (!videoElement) return
      setContainerSize({
        w: videoElement.clientWidth,
        h: videoElement.clientHeight
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(videoElement)
    return () => ro.disconnect()
  }, [videoElement])

  if (!source || !clip || !videoElement) return null
  if (containerSize.w === 0 || containerSize.h === 0) return null

  const cropRect = clip.cropRect ?? { x: 0, y: 0, w: 1, h: 1 }
  const lockRatio = ASPECTS[aspect]

  function applyAspectPreset(mode: AspectMode): void {
    setAspect(mode)
    const ratio = ASPECTS[mode]
    if (!ratio || !clip) return
    const sourceAspect = source && source.probe.width / source.probe.height
    if (!sourceAspect) return
    const containerAspect = containerSize.w / containerSize.h
    let normW: number
    let normH: number
    if (ratio > containerAspect) {
      normW = 0.9
      normH = (normW * containerAspect) / ratio
    } else {
      normH = 0.9
      normW = (normH * ratio) / containerAspect
    }
    setClipCrop(clip.id, {
      x: (1 - normW) / 2,
      y: (1 - normH) / 2,
      w: normW,
      h: normH
    })
  }

  function clearCrop(): void {
    if (!clip) return
    setClipCrop(clip.id, null)
  }

  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 text-ink-muted">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              const value = e.target.checked
              setEnabled(value)
              if (!value) clearCrop()
            }}
          />
          Crop
        </label>
        {enabled ? (
          <>
            {(['free', '16:9', '9:16', '1:1', '4:5'] as AspectMode[]).map((m) => (
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

      {enabled ? (
        <div
          ref={containerRef}
          className="absolute inset-0 pointer-events-none"
          style={{ width: containerSize.w, height: containerSize.h }}
        >
          <Rnd
            bounds="parent"
            lockAspectRatio={lockRatio ?? false}
            position={{
              x: cropRect.x * containerSize.w,
              y: cropRect.y * containerSize.h
            }}
            size={{
              width: cropRect.w * containerSize.w,
              height: cropRect.h * containerSize.h
            }}
            onDragStop={(_e, d) => {
              setClipCrop(clip.id, {
                x: Math.max(0, Math.min(1 - cropRect.w, d.x / containerSize.w)),
                y: Math.max(0, Math.min(1 - cropRect.h, d.y / containerSize.h)),
                w: cropRect.w,
                h: cropRect.h
              })
            }}
            onResizeStop={(_e, _dir, ref, _delta, position) => {
              setClipCrop(clip.id, {
                x: Math.max(0, position.x / containerSize.w),
                y: Math.max(0, position.y / containerSize.h),
                w: ref.offsetWidth / containerSize.w,
                h: ref.offsetHeight / containerSize.h
              })
            }}
            className="pointer-events-auto"
            style={{
              border: '2px solid #a78bfa',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
              boxSizing: 'border-box'
            }}
          />
        </div>
      ) : null}
    </>
  )
}
