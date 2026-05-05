import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVideoStore } from './store/videoStore'

function formatShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const t = Math.floor((seconds - Math.floor(seconds)) * 10)
  return `${m}:${String(s).padStart(2, '0')}.${t}`
}

type DragMode = 'start' | 'end' | null

export function Timeline(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const currentTime = useVideoStore((s) => s.currentTime)
  const setClipRange = useVideoStore((s) => s.setClipRange)
  const trackRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragMode>(null)

  const duration = source?.probe.duration ?? 0
  const clip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) ?? null,
    [clips, selectedClipId]
  )

  const positionToSeconds = useCallback(
    (clientX: number): number => {
      const el = trackRef.current
      if (!el || duration <= 0) return 0
      const rect = el.getBoundingClientRect()
      const ratio = (clientX - rect.left) / rect.width
      return Math.min(Math.max(ratio, 0), 1) * duration
    },
    [duration]
  )

  useEffect(() => {
    if (!drag || !clip) return

    function onMove(e: MouseEvent): void {
      if (!clip) return
      const t = positionToSeconds(e.clientX)
      if (drag === 'start') {
        setClipRange(clip.id, Math.min(t, clip.endSec - 0.1), clip.endSec)
      } else if (drag === 'end') {
        setClipRange(clip.id, clip.startSec, Math.max(t, clip.startSec + 0.1))
      }
    }

    function onUp(): void {
      setDrag(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, clip, positionToSeconds, setClipRange])

  if (!source || !clip || duration <= 0) return null

  const startPct = (clip.startSec / duration) * 100
  const endPct = (clip.endSec / duration) * 100
  const playheadPct = (currentTime / duration) * 100
  const clipDuration = clip.endSec - clip.startSec

  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span>
          In <span className="font-mono text-ink-base">{formatShort(clip.startSec)}</span>
        </span>
        <span>
          Length <span className="font-mono text-ink-base">{formatShort(clipDuration)}</span>
        </span>
        <span>
          Out <span className="font-mono text-ink-base">{formatShort(clip.endSec)}</span>
        </span>
      </div>
      <div ref={trackRef} className="relative h-12 bg-bg-hover rounded-md select-none">
        <div
          className="absolute top-0 bottom-0 bg-accent/25 border-x-2 border-accent"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-pink-400"
          style={{ left: `calc(${playheadPct}% - 1px)` }}
        />
        <button
          aria-label="Trim start"
          onMouseDown={(e) => {
            e.preventDefault()
            setDrag('start')
          }}
          className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize bg-accent rounded-l hover:bg-accent-muted"
          style={{ left: `${startPct}%` }}
        />
        <button
          aria-label="Trim end"
          onMouseDown={(e) => {
            e.preventDefault()
            setDrag('end')
          }}
          className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize bg-accent rounded-r hover:bg-accent-muted"
          style={{ left: `${endPct}%` }}
        />
      </div>
      <p className="text-xs text-ink-dim">
        Drag the handles, or press <kbd className="px-1 bg-bg-hover rounded">I</kbd> /{' '}
        <kbd className="px-1 bg-bg-hover rounded">O</kbd> to set in/out at the playhead.
      </p>
    </div>
  )
}
