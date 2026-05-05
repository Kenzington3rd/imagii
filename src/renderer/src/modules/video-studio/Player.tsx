import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useVideoStore } from './store/videoStore'
import { CropOverlay } from './CropOverlay'
import { SafeZoneOverlay } from './SafeZoneOverlay'

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
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [showSafeZones, setShowSafeZones] = useState(false)

  useEffect(() => {
    setPlaying(false)
    setTime(0)
    if (videoRef.current) videoRef.current.currentTime = 0
  }, [source?.url])

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
    const next = Math.min(Math.max(0, v.currentTime + deltaSec), duration || v.duration || 0)
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
      className="flex flex-col gap-3 outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="relative bg-black rounded-xl overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
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
        <button className="btn-ghost px-3 py-2" onClick={togglePlay}>
          {playing ? '⏸' : '▶'}
        </button>
        <button
          className="btn-ghost px-3 py-2"
          onClick={() => step(-1)}
          title="Previous frame (,)"
        >
          ⏮ frame
        </button>
        <button
          className="btn-ghost px-3 py-2"
          onClick={() => step(1)}
          title="Next frame (.)"
        >
          frame ⏭
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
