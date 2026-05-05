import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { useAudioStore } from './state/audioStore'

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

  useEffect(() => {
    if (!source || !containerRef.current) return
    const regions = RegionsPlugin.create()
    regionsRef.current = regions
    const ws = WaveSurfer.create({
      container: containerRef.current,
      url: source.url,
      waveColor: '#7c5cf0',
      progressColor: '#a78bfa',
      cursorColor: '#f472b6',
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

    let dragging = false
    regions.enableDragSelection({ color: 'rgba(244, 114, 182, 0.25)' })
    const offRegionCreated = regions.on('region-created', (region: Region) => {
      dragging = true
      region.on('update-end', () => {
        if (!dragging) return
        dragging = false
        addCutRegion({ startSec: region.start, endSec: region.end })
        region.remove()
      })
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
    const existing = regions.getRegions()
    for (const r of existing) {
      const isCut = (r as Region & { __cut?: boolean }).__cut
      if (isCut) r.remove()
    }
    cutRegions.forEach((cut, idx) => {
      const region = regions.addRegion({
        start: cut.startSec,
        end: cut.endSec,
        color: 'rgba(244, 63, 94, 0.35)',
        drag: false,
        resize: false,
        id: `cut-${idx}`
      }) as Region & { __cut?: boolean }
      region.__cut = true
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
        <button className="btn-ghost px-3 py-2" onClick={togglePlay} disabled={!ready}>
          {playing ? '⏸' : '▶'}
        </button>
        <div className="font-mono text-ink-muted">
          {formatTime(time)} / {formatTime(source.probe.duration)}
        </div>
        <div className="ml-auto text-xs text-ink-dim">
          {source.probe.sampleRate} Hz · {source.probe.channels}ch · {source.probe.codec}
        </div>
      </div>
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
