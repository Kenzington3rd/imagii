import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { playableDuration, playheadNow, useVideoStore } from './store/videoStore'
import { focusOwnsKey, hasChordModifier, inputTypeOf } from '../../lib/keyOwnership'
import { formatClock } from '@shared/clockTime'

type DragMode = 'start' | 'end' | 'scrub' | null

/** Arrow-key step on the track, matching the Player's own ←/→ nudge. */
const NUDGE_SEC = 0.1

export function Timeline(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const clips = useVideoStore((s) => s.clips)
  const selectedClipId = useVideoStore((s) => s.selectedClipId)
  const currentTime = useVideoStore((s) => s.currentTime)
  const setClipRange = useVideoStore((s) => s.setClipRange)
  const endGesture = useVideoStore((s) => s.endGesture)
  const requestSeek = useVideoStore((s) => s.requestSeek)
  const fps = useVideoStore((s) => (s.source && s.source.probe.fps > 0 ? s.source.probe.fps : 30))
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
      // T-40: the button coming up ends this trim. Without it the next drag
      // of the same handle carried the same coalescing key and disappeared
      // into this one's undo step.
      endGesture()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, clip, positionToSeconds, setClipRange, requestSeek, endGesture])

  /** Click or drag anywhere on the track: seek to that point in the source. */
  function startScrub(e: ReactMouseEvent<HTMLDivElement>): void {
    // No preventDefault: the surface is a focusable slider, and mousedown is
    // how a pointer user hands it the keyboard. The track is `select-none`,
    // so nothing is dragged into a text selection either.
    setDrag('scrub')
    requestSeek(positionToSeconds(e.clientX))
  }

  /**
   * T-119: I / O at the playhead, the same store calls the Player's own handler makes. The USER_GUIDE's
   * sequence is "click the track, press I", and a click on the track hands THIS element the keyboard (it is
   * the focusable slider), not the Player's column, so the keys the guide promises have to be heard here too.
   * The playhead is the element's own time when a Player is mounted (T-120: the store's `currentTime` is
   * written on `timeupdate`, so during playback it is up to a quarter second behind the frame on screen, and
   * the Player's own I / O read the element), and the store's, the number the track draws, otherwise.
   */
  function setMarker(which: 'in' | 'out'): void {
    const state = useVideoStore.getState()
    const id = state.selectedClipId
    if (!id) return
    const at = playheadNow(state)
    if (which === 'in') state.setClipStart(id, at)
    else state.setClipEnd(id, at)
    // T-40: a keypress is the whole gesture (both markers coalesce with the drags).
    state.endGesture()
  }

  function onScrubKey(e: ReactKeyboardEvent<HTMLDivElement>): void {
    // Same stand-down as the Player's handler (T-123 (2): `focusOwnsKey`, not "any INPUT"). (The slider has no
    // children today, so its own target is never a control; this is the line a future child would rely on.)
    if (focusOwnsKey((e.target as HTMLElement).tagName, inputTypeOf(e.target), e.key)) return
    // T-124 (29): Ctrl+O is a browser chord, not "set Out"; the handler read no modifier and swallowed it with `preventDefault`.
    if (hasChordModifier(e)) return
    // T-121: the four relative keys step from the frame on screen, the way I / O mark it (T-120). The store's
    // `currentTime` is written on `timeupdate`, so during playback it trails the picture by up to a quarter
    // second: `.` stepped back 0.15 s and the right arrow moved 0.05 s instead of 0.1 in QA's measurement.
    const now = playheadNow(useVideoStore.getState())
    let next: number
    switch (e.key) {
      case ' ':
        // T-120: the guide's "click the track, then Space". The slider is the focused element after a click,
        // not the Player's column, so the Player's own handler never heard it, and an unhandled Space scrolls
        // the studio. The same toggle, through the Player's registration.
        e.preventDefault()
        // T-133 (7b): one toggle per press, as the Player's Space is; the arrows and , . below repeat on purpose.
        if (!e.repeat) useVideoStore.getState().transport?.togglePlay()
        return
      case 'ArrowLeft':
        next = now - NUDGE_SEC
        break
      case 'ArrowRight':
        next = now + NUDGE_SEC
        break
      case ',':
        next = now - 1 / fps
        break
      case '.':
        next = now + 1 / fps
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = duration
        break
      case 'i':
      case 'I':
        e.preventDefault()
        setMarker('in')
        return
      case 'o':
      case 'O':
        e.preventDefault()
        setMarker('out')
        return
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
          In <span className="font-mono text-ink-base">{formatClock(clip.startSec, 1)}</span>
        </span>
        <span>
          Length <span className="font-mono text-ink-base">{formatClock(clipDuration, 1)}</span>
        </span>
        <span>
          Out <span className="font-mono text-ink-base">{formatClock(clip.endSec, 1)}</span>
        </span>
      </div>
      <div ref={trackRef} className="relative h-12 bg-bg-hover rounded-md select-none">
        {/* The scrub surface. Its own element rather than the track itself so
            that it sits BELOW the trim handles in paint order, which is what
            gives their drags priority over a scrub. (The handles are pointer
            affordances and hidden from assistive tech on purpose, below.) */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={Number(duration.toFixed(2))}
          aria-valuenow={Number(currentTime.toFixed(2))}
          aria-valuetext={formatClock(currentTime, 1)}
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
        {/* T-119: the two trim handles are pointer affordances. They take no keyboard focus and are hidden
            from assistive tech, because pressing Enter or Space on one did nothing: they were dead tab stops
            that announced themselves as buttons. The keyboard's way to the same trim is I / O on the
            Playhead slider above, said in the line under the track. */}
        <button
          tabIndex={-1}
          aria-hidden="true"
          onMouseDown={(e) => {
            e.preventDefault()
            setDrag('start')
          }}
          className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize bg-accent rounded-l hover:bg-accent-muted"
          style={{ left: `${startPct}%` }}
        />
        <button
          tabIndex={-1}
          aria-hidden="true"
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
        <kbd className="px-1 bg-bg-hover rounded">O</kbd> to set in/out at the playhead ·{' '}
        <kbd className="px-1 bg-bg-hover rounded">?</kbd> all shortcuts
      </p>
    </div>
  )
}
