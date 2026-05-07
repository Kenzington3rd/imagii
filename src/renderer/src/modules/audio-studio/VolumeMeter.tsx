import { useEffect, useRef, useState } from 'react'

interface VolumeMeterProps {
  audioElement: HTMLAudioElement | HTMLMediaElement | null
}

const NUM_BARS = 12

export function VolumeMeter({ audioElement }: VolumeMeterProps): JSX.Element {
  const [levels, setLevels] = useState<number[]>(() => Array(NUM_BARS).fill(0))
  const [peakDb, setPeakDb] = useState(-60)
  const rafRef = useRef<number | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)

  useEffect(() => {
    if (!audioElement) return
    let cancelled = false

    function start(): void {
      if (cancelled || !audioElement) return
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new Ctx()
        const source = ctx.createMediaElementSource(audioElement as HTMLMediaElement)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        source.connect(analyser)
        analyser.connect(ctx.destination)
        ctxRef.current = ctx
        analyserRef.current = analyser
        sourceRef.current = source
        loop()
      } catch {
        /* media element already attached or ctx failed */
      }
    }

    function loop(): void {
      const analyser = analyserRef.current
      if (!analyser) return
      const data = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(data)
      const segments = NUM_BARS
      const segLen = Math.floor(data.length / segments)
      const next: number[] = []
      let maxAmp = 0
      for (let i = 0; i < segments; i++) {
        let sum = 0
        for (let j = 0; j < segLen; j++) sum += data[i * segLen + j] ?? 0
        const avg = sum / segLen / 255
        next.push(avg)
        maxAmp = Math.max(maxAmp, avg)
      }
      setLevels(next)
      const db = maxAmp > 0 ? 20 * Math.log10(maxAmp) : -60
      setPeakDb(Math.max(-60, db))
      rafRef.current = requestAnimationFrame(loop)
    }

    start()
    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      try {
        sourceRef.current?.disconnect()
        analyserRef.current?.disconnect()
        void ctxRef.current?.close()
      } catch {
        /* ignore */
      }
      ctxRef.current = null
      analyserRef.current = null
      sourceRef.current = null
    }
  }, [audioElement])

  const clipping = peakDb > -1
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-ink-muted w-12">Meter</span>
      <div className="flex items-end gap-0.5 h-6 flex-1">
        {levels.map((lvl, i) => {
          const pct = Math.min(1, lvl) * 100
          const isHot = lvl > 0.85
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-[height] ${
                isHot ? 'bg-rose-400' : lvl > 0.55 ? 'bg-amber-300' : 'bg-emerald-400'
              }`}
              style={{ height: `${Math.max(2, pct)}%` }}
            />
          )
        })}
      </div>
      <span
        className={`font-mono w-14 text-right ${clipping ? 'text-rose-300' : 'text-ink-muted'}`}
      >
        {peakDb.toFixed(0)} dB
      </span>
    </div>
  )
}
