import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useVideoStore } from './store/videoStore'
import { CropOverlay } from './CropOverlay'
import { SafeZoneOverlay } from './SafeZoneOverlay'
import { Icon } from '../../components/Icon'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds - Math.floor(seconds)) * 100)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function Player(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const setCurrentTime = useVideoStore((s) => s.setCurrentTime)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [showSafeZones, setShowSafeZones] = useState(false)

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
  useEffect(() => {
    setPlaying(false)
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
      }),
    []
  )

  if (!source) return null

  const fps = source.probe.fps > 0 ? source.probe.fps : 30
  const duration = source.probe.duration

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
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
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
      <div className="relative bg-black rounded-xl overflow-hidden flex items-center justify-center">
        <video
          ref={(el) => {
            videoRef.current = el
            setVideoEl(el)
            ;(
              window as unknown as { __imagiiVideoEl?: HTMLVideoElement | null }
            ).__imagiiVideoEl = el
          }}
          src={source.url}
          className="max-h-[60vh] w-auto"
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
        <CropOverlay videoElement={videoRef.current} />
        <SafeZoneOverlay
          videoElement={videoRef.current}
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
