import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { useAudioStore } from './state/audioStore'
import { VolumeMeter } from './VolumeMeter'
import { Icon } from '../../components/Icon'
import { ACCENT, ACCENT_MUTED, EMBER } from '../../styles/tokens'

/**
 * Every region this view puts on the waveform for a stored cut carries this id
 * prefix. It is the only marker available inside the `region-created` handler:
 * `addRegion` emits that event synchronously, from inside the call, so any
 * property the caller sets on the returned region is not set yet.
 */
const CUT_ID_PREFIX = 'cut-'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds - Math.floor(seconds)) * 100)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function WaveformView(): JSX.Element | null {
  const source = useAudioStore((s) => s.source)
  const cutRegions = useAudioStore((s) => s.chain.cutRegions)
  const setCurrentTime = useAudioStore((s) => s.setCurrentTime)
  const addCutRegion = useAudioStore((s) => s.addCutRegion)
  const removeCutRegion = useAudioStore((s) => s.removeCutRegion)
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<RegionsPlugin | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [ready, setReady] = useState(false)
  const [mediaEl, setMediaEl] = useState<HTMLMediaElement | null>(null)

  useEffect(() => {
    if (!source || !containerRef.current) return
    const regions = RegionsPlugin.create()
    regionsRef.current = regions
    const ws = WaveSurfer.create({
      container: containerRef.current,
      url: source.url,
      waveColor: ACCENT_MUTED,
      progressColor: ACCENT,
      cursorColor: EMBER,
      cursorWidth: 2,
      height: 96,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      plugins: [regions]
    })
    wsRef.current = ws
    setReady(false)

    const offReady = ws.on('ready', () => {
      setReady(true)
      try {
        const internal = (ws as unknown as { getMediaElement?: () => HTMLMediaElement })
          .getMediaElement
        if (internal) setMediaEl(internal.call(ws))
      } catch {
        /* ignore */
      }
    })
    const offTime = ws.on('audioprocess', (t) => {
      setTime(t)
      setCurrentTime(t)
    })
    const offSeek = ws.on('seeking', (t) => {
      setTime(t)
      setCurrentTime(t)
    })
    const offPlay = ws.on('play', () => setPlaying(true))
    const offPause = ws.on('pause', () => setPlaying(false))
    const offFinish = ws.on('finish', () => setPlaying(false))

    regions.enableDragSelection({ color: 'rgba(255, 49, 49, 0.25)' })
    // One drag is one cut, which is what the panel copy below promises.
    // wavesurfer 7.12 emits `region-created` from `saveRegion()` in
    // `enableDragSelection`'s "end" branch — i.e. when the button comes up —
    // and emits no `update-end` for that gesture at all, because the region's
    // own draggable never saw the pointerdown. Committing on `update-end`
    // therefore needed a second gesture on the leftover region (T-36).
    const offRegionCreated = regions.on('region-created', (region: Region) => {
      // Stored cuts are re-rendered through `addRegion` below, which emits
      // this same event; without the id guard every re-render would commit its
      // own regions again and the cut list would double each time.
      if (region.id.startsWith(CUT_ID_PREFIX)) return
      addCutRegion({ startSec: region.start, endSec: region.end })
      region.remove()
    })

    return () => {
      offReady()
      offTime()
      offSeek()
      offPlay()
      offPause()
      offFinish()
      offRegionCreated()
      ws.destroy()
      wsRef.current = null
      regionsRef.current = null
    }
  }, [source, setCurrentTime, addCutRegion])

  useEffect(() => {
    const regions = regionsRef.current
    if (!regions) return
    for (const r of regions.getRegions()) {
      if (r.id.startsWith(CUT_ID_PREFIX)) r.remove()
    }
    cutRegions.forEach((cut, idx) => {
      regions.addRegion({
        start: cut.startSec,
        end: cut.endSec,
        color: 'rgba(244, 63, 94, 0.35)',
        drag: false,
        resize: false,
        id: `${CUT_ID_PREFIX}${idx}`
      })
    })
  }, [cutRegions])

  if (!source) return null

  function togglePlay(): void {
    wsRef.current?.playPause()
  }

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div ref={containerRef} className="bg-bg-base rounded-md overflow-hidden" />
      <div className="flex items-center gap-3 text-sm">
        <button
          className="btn-ghost px-3 py-2"
          onClick={togglePlay}
          disabled={!ready}
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
        <div className="font-mono text-ink-muted">
          {formatTime(time)} / {formatTime(source.probe.duration)}
        </div>
        <div className="ml-auto text-xs text-ink-dim">
          {source.probe.sampleRate} Hz · {source.probe.channels}ch · {source.probe.codec}
        </div>
      </div>
      <VolumeMeter audioElement={mediaEl} />
      {cutRegions.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-ink-muted">Cuts:</span>
          {cutRegions.map((cut, i) => (
            <button
              key={i}
              onClick={() => removeCutRegion(i)}
              className="px-2 py-0.5 bg-rose-500/20 border border-rose-400/40 rounded hover:bg-rose-500/30"
              title="Click to remove this cut"
            >
              {formatTime(cut.startSec)}–{formatTime(cut.endSec)} ✕
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-dim">
          Drag on the waveform to select a region to cut. Click a cut tag to undo it.
        </p>
      )}
    </div>
  )
}
