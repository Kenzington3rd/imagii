import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { computeCropBox, type CropBox } from '@shared/safeZone'
import { playableDuration, useVideoStore } from './store/videoStore'
import { CropControls, CropOverlay, type AspectMode } from './CropOverlay'
import { SafeZoneOverlay } from './SafeZoneOverlay'
import { Icon } from '../../components/Icon'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds - Math.floor(seconds)) * 100)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/**
 * Where the PICTURE is inside the player box, in CSS pixels.
 *
 * Two offsets stack up, and anchoring an overlay to the box ignored both
 * (T-39). The element is centered in a box that is wider than it, and the
 * UA's own `object-fit: contain` letterboxes the picture INSIDE the element
 * whenever the element's box and the media's intrinsic aspect disagree — so
 * the crop rectangle and the safe-zone guides were drawn across black bars.
 * The contain fit is `computeCropBox`: the centered rect of a given aspect
 * inside a frame is the same shape whether the frame is a source image or an
 * on-screen box.
 *
 * The container is observed as well as the video. A window resize moves a
 * centered `w-auto` video WITHOUT changing its size, and a ResizeObserver on
 * the element alone never hears about that.
 */
function useVideoContentRect(
  video: HTMLVideoElement | null,
  container: HTMLElement | null
): CropBox | null {
  const [rect, setRect] = useState<CropBox | null>(null)

  useEffect(() => {
    if (!video || !container) return
    const v = video
    const base = container
    function measure(): void {
      const box = v.getBoundingClientRect()
      const outer = base.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) {
        setRect(null)
        return
      }
      // Before metadata there is no intrinsic size to fit to; the element's
      // own box is both the best answer available and what it is painting.
      const fitted =
        v.videoWidth > 0 && v.videoHeight > 0
          ? computeCropBox(box.width, box.height, v.videoWidth / v.videoHeight)
          : { x: 0, y: 0, w: box.width, h: box.height }
      const next: CropBox = {
        x: box.left - outer.left + fitted.x,
        y: box.top - outer.top + fitted.y,
        w: fitted.w,
        h: fitted.h
      }
      setRect((prev) =>
        prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h
          ? prev
          : next
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(v)
    observer.observe(base)
    v.addEventListener('loadedmetadata', measure)
    return () => {
      observer.disconnect()
      v.removeEventListener('loadedmetadata', measure)
    }
  }, [video, container])

  return rect
}

interface PlayerProps {
  /** Publishes the <video> as it attaches and detaches. T-38: the output
   *  preview used to read it off a global during a render that happens
   *  before the element exists, so it stayed blank until something unrelated
   *  re-rendered the studio. */
  onVideoElement: (el: HTMLVideoElement | null) => void
}

export function Player({ onVideoElement }: PlayerProps): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const setCurrentTime = useVideoStore((s) => s.setCurrentTime)
  const setMediaDuration = useVideoStore((s) => s.setMediaDuration)
  const playable = useVideoStore((s) => playableDuration(s.source, s.mediaDuration))
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [showSafeZones, setShowSafeZones] = useState(false)
  const [cropEnabled, setCropEnabled] = useState(false)
  const [cropAspect, setCropAspect] = useState<AspectMode>('free')
  const pictureRect = useVideoContentRect(videoEl, frameEl)

  // Stable, so React attaches it once on mount instead of detaching and
  // reattaching on every render — an inline arrow is a new ref each render,
  // and each swap published null and then the element again to everything
  // downstream.
  const attachVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el
      setVideoEl(el)
      // Kept as the E2E suite's handle on the media element.
      ;(window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }).__imagiiVideoEl = el
      onVideoElement(el)
    },
    [onVideoElement]
  )

  // T-52: a genuinely different FILE resets the transport readout and the
  // shared playhead. Keyed on the path, not the `imagii-file://` url derived
  // from it — the url is a projection of the path, and re-deriving one must
  // never rewind a user's playhead. The media element is not touched: setting
  // `src` already rewinds it, and this effect writing `currentTime = 0` is
  // exactly how a re-run would move a playhead the user placed.
  // The store's currentTime is reset here too. It has to be: this runs on
  // mount as well, and a remounted Player attaches a NEW <video> that starts
  // at 0 while the store still holds the position from before the studio was
  // left — the Timeline would draw a playhead the video is nowhere near.
  //
  // T-47 is the one exception: an UNCONSUMED seek request means somebody
  // asked for a position while no Player existed to serve it — a session
  // restore parks the playhead and then navigates here. Rewinding that to 0
  // would throw away the position the user closed the app at. Seeks made
  // while a Player is mounted are consumed as they land (below), so a stale
  // one can never reach this branch.
  useEffect(() => {
    setPlaying(false)
    const parked = useVideoStore.getState().seekRequest
    if (parked) {
      useVideoStore.setState({ seekRequest: null, currentTime: parked.seconds })
      setTime(parked.seconds)
      // At HAVE_NOTHING the element stores this as its default playback
      // start position and seeks there once metadata arrives.
      const v = videoRef.current
      if (v) v.currentTime = parked.seconds
      return
    }
    setTime(0)
    setCurrentTime(0)
  }, [source?.filePath, setCurrentTime])

  // The Timeline scrubs by asking the store; the Player owns the <video>, so
  // it is the one that applies the request. Subscribed imperatively rather
  // than read as state: a seek is an effect on the media element, not
  // something the render depends on. Object identity is the signal, so two
  // requests for the same second both land (see videoStore.seekRequest).
  useEffect(
    () =>
      useVideoStore.subscribe((state, prev) => {
        const request = state.seekRequest
        if (request === null || request === prev.seekRequest) return
        const v = videoRef.current
        // The element clamps to its own duration, which is the authority —
        // see `nudge` below for why that is not the probe's number.
        if (v) v.currentTime = request.seconds
        // Emptied as it lands (T-47): the request is a mailbox with one
        // reader, and leaving a served request in it would make the next
        // mount think it was parked for a restore.
        useVideoStore.setState({ seekRequest: null })
      }),
    []
  )

  if (!source) return null

  const fps = source.probe.fps > 0 ? source.probe.fps : 30
  // The readout says what the transport can reach, so it is the same number
  // the Timeline's track is scaled to (T-56): the element's own duration once
  // it has published one, the probe's until then. A readout that topped out
  // 20 ms below where the playhead can go is the same lie in words.
  const duration = playable

  function togglePlay(): void {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      void v.play()
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }

  function nudge(deltaSec: number): void {
    const v = videoRef.current
    if (!v) return
    // T-52: the media element's own duration is the ceiling, not ffprobe's.
    // They are not the same number — the fixture probes at 2.000 s and
    // decodes 2.020136 s — and clamping to the probe stopped every tail nudge
    // ~20 ms short of the real end of the file.
    const limit = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : duration
    const next = Math.min(Math.max(0, v.currentTime + deltaSec), limit)
    v.currentTime = next
  }

  function step(frames: number): void {
    nudge(frames / fps)
  }

  function setMarker(which: 'in' | 'out'): void {
    const v = videoRef.current
    if (!v) return
    const state = useVideoStore.getState()
    const id = state.selectedClipId
    if (!id) return
    const clip = state.clips.find((c) => c.id === id)
    if (!clip) return
    if (which === 'in') {
      state.setClipStart(id, v.currentTime)
    } else {
      state.setClipEnd(id, v.currentTime)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const tag = (e.target as HTMLElement).tagName
    // A control that owns the key gets it, and the studio shortcut stands
    // down. Text fields own every key. A BUTTON owns Space and only Space:
    // Space is how a keyboard user clicks one, so a Space that reached the
    // transport from a focused crop preset both moved the video and (with
    // `preventDefault` below) fought the button's own activation (T-63) —
    // while `,`, `.`, the arrows and I/O carry no meaning for a button and
    // stay available from anywhere in the column, which is what makes them
    // feel global inside the player.
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (tag === 'BUTTON' && e.key === ' ') return
    switch (e.key) {
      case ' ':
        e.preventDefault()
        togglePlay()
        break
      case 'ArrowLeft':
        e.preventDefault()
        nudge(-0.1)
        break
      case 'ArrowRight':
        e.preventDefault()
        nudge(0.1)
        break
      case ',':
        e.preventDefault()
        step(-1)
        break
      case '.':
        e.preventDefault()
        step(1)
        break
      case 'i':
      case 'I':
        e.preventDefault()
        setMarker('in')
        break
      case 'o':
      case 'O':
        e.preventDefault()
        setMarker('out')
        break
      default:
    }
  }

  return (
    <div
      className="flex flex-col gap-3 outline-none focus:ring-2 focus:ring-accent"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <CropControls
        enabled={cropEnabled}
        onEnabledChange={setCropEnabled}
        aspect={cropAspect}
        onAspectChange={setCropAspect}
      />

      <div
        ref={setFrameEl}
        className="relative bg-black rounded-xl overflow-hidden flex items-center justify-center"
      >
        <video
          ref={attachVideo}
          src={source.url}
          className="max-h-[60vh] w-auto"
          // T-56: the decoder is the only thing that knows how long the file
          // really is. Chromium reports the container's rounded duration at
          // metadata time and refines it once it has parsed the file, firing
          // this again — so the Timeline's coordinate space follows the
          // refinement instead of freezing on the probe's number.
          onDurationChange={(e) => setMediaDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime
            setTime(t)
            setCurrentTime(t)
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          controls={false}
        />
        {cropEnabled ? <CropOverlay rect={pictureRect} aspect={cropAspect} /> : null}
        <SafeZoneOverlay
          rect={pictureRect}
          show={showSafeZones}
          ratios={['9:16', '1:1', '4:5']}
        />
      </div>

      <div className="flex items-center gap-3 text-sm">
        <button
          className="btn-ghost px-3 py-2"
          onClick={togglePlay}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
        <button
          className="btn-ghost px-3 py-2 inline-flex items-center gap-1.5"
          onClick={() => step(-1)}
          title="Previous frame (,)"
        >
          <Icon name="step-back" size={15} /> frame
        </button>
        <button
          className="btn-ghost px-3 py-2 inline-flex items-center gap-1.5"
          onClick={() => step(1)}
          title="Next frame (.)"
        >
          frame <Icon name="step-forward" size={15} />
        </button>
        <div className="ml-2 font-mono text-ink-muted">
          {formatTime(time)} / {formatTime(duration)}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showSafeZones}
            onChange={(e) => setShowSafeZones(e.target.checked)}
          />
          Safe zones
        </label>
        <div className="text-xs text-ink-dim">
          {source.probe.width}×{source.probe.height} · {fps.toFixed(2)} fps ·{' '}
          {source.probe.videoCodec}
          {source.probe.audioCodec ? ` · ${source.probe.audioCodec}` : ' · (no audio)'}
        </div>
      </div>

      <p className="text-xs text-ink-dim">
        <kbd className="px-1 bg-bg-hover rounded">Space</kbd> play/pause ·{' '}
        <kbd className="px-1 bg-bg-hover rounded">←</kbd>/<kbd className="px-1 bg-bg-hover rounded">→</kbd>{' '}
        nudge 0.1s · <kbd className="px-1 bg-bg-hover rounded">,</kbd>/<kbd className="px-1 bg-bg-hover rounded">.</kbd>{' '}
        frame step · <kbd className="px-1 bg-bg-hover rounded">I</kbd>/
        <kbd className="px-1 bg-bg-hover rounded">O</kbd> set in/out
      </p>
    </div>
  )
}
