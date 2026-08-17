import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { playableDuration, useVideoStore } from './store/videoStore'

function formatShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const t = Math.floor((seconds - Math.floor(seconds)) * 10)
  return `${m}:${String(s).padStart(2, '0')}.${t}`
}

type DragMode = 'start' | 'end' | 'scrub' | null

/** Arrow-key step on the track, matching the Player's own ←/→ nudge. */
const NUDGE_SEC = 0.1

export function Timeline(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const currentTime = useVideoStore((s) => s.currentTime)
  const setClipRange = useVideoStore((s) => s.setClipRange)
  const requestSeek = useVideoStore((s) => s.requestSeek)
  const trackRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragMode>(null)

  // T-56: the track's coordinate space is what the video really PLAYS, not
  // what ffprobe rounded the container to. They differ by up to a frame, and
  // the difference was the last frames of every file: unreachable by click,
  // by drag, and by End, while the Player's own nudge already reached them.
  const duration = useVideoStore((s) => playableDuration(s.source, s.mediaDuration))
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

  // One gesture loop for all three drags. The listeners live on `window`, not
  // the track, so a drag that leaves the element keeps scrubbing until the
  // button comes up — the same capture a pointer-capture call would buy.
  useEffect(() => {
    if (!drag) return

    function onMove(e: MouseEvent): void {
      const t = positionToSeconds(e.clientX)
      if (drag === 'scrub') {
        requestSeek(t)
        return
      }
      if (!clip) return
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
  }, [drag, clip, positionToSeconds, setClipRange, requestSeek])

  /** Click or drag anywhere on the track: seek to that point in the source. */
  function startScrub(e: ReactMouseEvent<HTMLDivElement>): void {
    // No preventDefault: the surface is a focusable slider, and mousedown is
    // how a pointer user hands it the keyboard. The track is `select-none`,
    // so nothing is dragged into a text selection either.
    setDrag('scrub')
    requestSeek(positionToSeconds(e.clientX))
  }

  function onScrubKey(e: ReactKeyboardEvent<HTMLDivElement>): void {
    let next: number
    switch (e.key) {
      case 'ArrowLeft':
        next = currentTime - NUDGE_SEC
        break
      case 'ArrowRight':
        next = currentTime + NUDGE_SEC
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = duration
        break
      default:
        return
    }
    e.preventDefault()
    requestSeek(next)
  }

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
        {/* The scrub surface. Its own element rather than the track itself for
            two reasons: `role="slider"` makes its DOM children presentational,
            which would hide the trim handles from assistive tech, and keeping
            it BELOW the handles in paint order is what gives their drags
            priority over a scrub. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={Number(duration.toFixed(2))}
          aria-valuenow={Number(currentTime.toFixed(2))}
          aria-valuetext={formatShort(currentTime)}
          onMouseDown={startScrub}
          onKeyDown={onScrubKey}
          className="absolute inset-0 rounded-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {/* Indicators only — `pointer-events-none` so the clip range and the
            playhead never swallow a click meant for the track under them. */}
        <div
          className="absolute top-0 bottom-0 bg-accent/25 border-x-2 border-accent pointer-events-none"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />
        {/* The playhead. `bg-ember` is the same mark the Audio Studio's
            waveform cursor carries, and the one color on the track that stays
            readable across the accent clip range under it (T-56 — it was a
            raw `bg-pink-400` that predated the round-19 retheme). */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-ember pointer-events-none"
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
        Click or drag the track to scrub. Drag the handles, or press{' '}
        <kbd className="px-1 bg-bg-hover rounded">I</kbd> /{' '}
        <kbd className="px-1 bg-bg-hover rounded">O</kbd> to set in/out at the playhead.
      </p>
    </div>
  )
}
