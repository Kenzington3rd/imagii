import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { useAudioStore } from './state/audioStore'
import { VolumeMeter } from './VolumeMeter'
import { Icon } from '../../components/Icon'
import { ACCENT, ACCENT_MUTED, EMBER, withAlpha } from '../../styles/tokens'

/**
 * Every region this view puts on the waveform for a stored cut carries this id
 * prefix. It is the only marker available inside the `region-created` handler:
 * `addRegion` emits that event synchronously, from inside the call, so any
 * property the caller sets on the returned region is not set yet.
 */
const CUT_ID_PREFIX = 'cut-'

/** The live drag selection, and the stored cut it becomes. Both are the
 *  accent (T-56 — the stored one used to be a raw rose-500 literal); the
 *  weight is what separates "being drawn now" from "committed". */
const SELECTION_FILL = withAlpha(ACCENT, 0.25)
const CUT_FILL = withAlpha(ACCENT, 0.35)

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

    regions.enableDragSelection({ color: SELECTION_FILL })
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
      const region = regions.addRegion({
        start: cut.startSec,
        end: cut.endSec,
        color: CUT_FILL,
        drag: false,
        resize: false,
        id: `${CUT_ID_PREFIX}${idx}`
      })
      // A stored cut is a MARK, not a control: it is removed through its chip
      // below, never dragged or resized. wavesurfer 7.12 gives every region
      // its own `makeDraggable` anyway — `initMouseEvents` calls it whatever
      // `drag`/`resize` say — and that handler `preventDefault`s the
      // document-level pointermove before `enableDragSelection`'s sees it, so
      // a new cut drag that STARTED on top of an existing cut silently did
      // nothing (T-61): the exact gesture for widening a cut. Making the mark
      // pointer-transparent is the fix at the root — no pointerdown on the
      // region, no draggable, and the gesture is an ordinary drag selection
      // like it is anywhere else on the waveform. (The plugin has no option
      // for this; `drag:false` only makes its `onMove` a no-op.)
      if (region.element) region.element.style.pointerEvents = 'none'
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
          {/* A chip is the legend for its mark on the waveform above, so it
              carries the same token — a user pairs the two by color. It was a
              raw rose-500 while the mark was a raw rose rgba(); T-56 moved
              both onto the accent together, because moving one alone is what
              would break the pairing. */}
          {cutRegions.map((cut, i) => (
            <button
              key={i}
              onClick={() => removeCutRegion(i)}
              className="px-2 py-0.5 bg-accent/20 border border-accent/40 rounded hover:bg-accent/30"
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
