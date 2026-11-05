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
  // T-160 (3): one analyser per channel. An AnalyserNode analyses its input down-mixed to mono ((L+R)/2), so the one above
  // read a tone on L only 6 dB low and an L = -R signal as silence; the level is the larger of these two peaks.
  const channelRef = useRef<{ splitter: ChannelSplitterNode; left: AnalyserNode; right: AnalyserNode } | null>(null)
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
        // Not connected onward: they only read. A mono source up-mixes discretely, so channel 1 is silent and the max is the mono peak.
        const splitter = ctx.createChannelSplitter(2)
        const left = ctx.createAnalyser()
        const right = ctx.createAnalyser()
        left.fftSize = 1024
        right.fftSize = 1024
        source.connect(splitter)
        splitter.connect(left, 0)
        splitter.connect(right, 1)
        channelRef.current = { splitter, left, right }
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
      // Bars stay frequency-based — they're a spectrum visual, not a level.
      const data = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(data)
      const segments = NUM_BARS
      const segLen = Math.floor(data.length / segments)
      const next: number[] = []
      for (let i = 0; i < segments; i++) {
        let sum = 0
        for (let j = 0; j < segLen; j++) sum += data[i * segLen + j] ?? 0
        next.push(sum / segLen / 255)
      }
      setLevels(next)
      // T-160 (3): the readout is the larger peak of the two channels, not the mono down-mix.
      // Round 18: the dB readout now comes from TIME-domain samples.
      // getByteFrequencyData bytes are already dB-scaled (min..maxDecibels),
      // so running them through 20*log10 again double-logged the value —
      // the old "peak dB" and clip flag never corresponded to real dBFS.
      const channels = channelRef.current
      const wave = new Float32Array(analyser.fftSize)
      let peak = 0
      for (const node of channels ? [channels.left, channels.right] : [analyser]) {
        node.getFloatTimeDomainData(wave)
        for (let i = 0; i < wave.length; i++) {
          const abs = Math.abs(wave[i] ?? 0)
          if (abs > peak) peak = abs
        }
      }
      const db = peak > 0 ? 20 * Math.log10(peak) : -60
      setPeakDb(Math.max(-60, Math.min(0, db)))
      rafRef.current = requestAnimationFrame(loop)
    }

    start()
    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      try {
        sourceRef.current?.disconnect()
        analyserRef.current?.disconnect()
        channelRef.current?.splitter.disconnect()
        channelRef.current?.left.disconnect()
        channelRef.current?.right.disconnect()
        void ctxRef.current?.close()
      } catch {
        /* ignore */
      }
      ctxRef.current = null
      analyserRef.current = null
      channelRef.current = null
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
                isHot ? 'bg-danger-strong' : lvl > 0.55 ? 'bg-ember' : 'bg-ok-strong'
              }`}
              style={{ height: `${Math.max(2, pct)}%` }}
            />
          )
        })}
      </div>
      <span
        className={`font-mono w-14 shrink-0 whitespace-nowrap text-right ${clipping ? 'text-danger' : 'text-ink-muted'}`}
      >
        {/* T-159 (2): a number, not toFixed(0): toFixed returns the string "-0" for any peak within half a dB of full scale, while a number's -0 prints as "0".
            T-160 (3): ceil, not round - a peak meter never under-reads, and every peak above -1 dBFS (the red one) lands on "0 dB", so a "-1 dB" is never red. */}
        {Math.ceil(peakDb)} dB
      </span>
    </div>
  )
}
