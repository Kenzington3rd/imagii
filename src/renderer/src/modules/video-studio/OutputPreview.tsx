import { useEffect, useRef, useState } from 'react'
import type { PlatformId } from '@shared/clip'
import { useVideoStore } from './store/videoStore'
import { ALL_PLATFORM_IDS, PLATFORM_INFO } from './presets'
import { PanelHeader } from '../../components/PanelHeader'

interface OutputPreviewProps {
  videoElement: HTMLVideoElement | null
}

interface CropDims {
  w: number
  h: number
  x: number
  y: number
}

function computeAutoCrop(sourceW: number, sourceH: number, targetAspect: number): CropDims {
  const sourceAspect = sourceW / sourceH
  if (Math.abs(sourceAspect - targetAspect) < 0.01) {
    return { w: sourceW, h: sourceH, x: 0, y: 0 }
  }
  if (sourceAspect > targetAspect) {
    const w = Math.round(sourceH * targetAspect)
    return { w, h: sourceH, x: Math.max(0, (sourceW - w) / 2), y: 0 }
  }
  const h = Math.round(sourceW / targetAspect)
  return { w: sourceW, h, x: 0, y: Math.max(0, (sourceH - h) / 2) }
}

export function OutputPreview({ videoElement }: OutputPreviewProps): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const [previewPlatform, setPreviewPlatform] = useState<PlatformId>('reels')
  const [tick, setTick] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!videoElement) return
    const handler = (): void => setTick((t) => t + 1)
    videoElement.addEventListener('timeupdate', handler)
    videoElement.addEventListener('seeked', handler)
    videoElement.addEventListener('loadeddata', handler)
    return () => {
      videoElement.removeEventListener('timeupdate', handler)
      videoElement.removeEventListener('seeked', handler)
      videoElement.removeEventListener('loadeddata', handler)
    }
  }, [videoElement])

  useEffect(() => {
    if (!videoElement || !source) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const platform = PLATFORM_INFO[previewPlatform]
    const clip = clips.find((c) => c.id === selectedClipId)
    let crop: CropDims
    if (clip?.cropRect) {
      const cr = clip.cropRect
      crop = {
        w: Math.max(2, Math.round(cr.w * source.probe.width)),
        h: Math.max(2, Math.round(cr.h * source.probe.height)),
        x: Math.max(0, Math.round(cr.x * source.probe.width)),
        y: Math.max(0, Math.round(cr.y * source.probe.height))
      }
    } else {
      crop = computeAutoCrop(source.probe.width, source.probe.height, platform.aspectRatio)
    }
    const targetW = platform.width
    const targetH = platform.height
    const previewMaxDim = 240
    const previewScale = Math.min(previewMaxDim / targetW, previewMaxDim / targetH)
    canvas.width = Math.round(targetW * previewScale)
    canvas.height = Math.round(targetH * previewScale)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    try {
      ctx.drawImage(
        videoElement,
        crop.x,
        crop.y,
        crop.w,
        crop.h,
        0,
        0,
        canvas.width,
        canvas.height
      )
    } catch {
      /* video may not be ready */
    }
    void tick
  }, [videoElement, source, clips, selectedClipId, previewPlatform, tick])

  if (!source) return null

  return (
    <div className="card p-3 flex flex-col gap-2 text-sm">
      <PanelHeader
        icon="search"
        actions={
          <select
            value={previewPlatform}
            onChange={(e) => setPreviewPlatform(e.target.value as PlatformId)}
            className="bg-bg-base rounded px-2 py-0.5 text-xs"
          >
            {ALL_PLATFORM_IDS.map((id) => (
              <option key={id} value={id}>
                {PLATFORM_INFO[id].label} ({PLATFORM_INFO[id].width}×
                {PLATFORM_INFO[id].height})
              </option>
            ))}
          </select>
        }
      >
        Output preview
      </PanelHeader>
      <div className="flex justify-center bg-bg-base rounded p-2">
        <canvas ref={canvasRef} className="rounded shadow-md" />
      </div>
      <p className="text-xs text-ink-dim">
        Live snapshot at the playhead position, after auto-crop and your manual crop. Move the
        playhead to see different moments.
      </p>
    </div>
  )
}
