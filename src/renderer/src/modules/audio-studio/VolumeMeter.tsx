import { useEffect, useRef, useState } from 'react'

interface VolumeMeterProps {
  audioElement: HTMLAudioElement | HTMLMediaElement | null
  /** The source's channel count from the probe. It picks the fold that is both heard and metered (T-162 (6)); a count the person never sees changes. */
  channels?: number
}

const NUM_BARS = 12

/**
 * T-162 (6): the 7.1 stereo fold, as an explicit matrix. Web Audio's speakers rule down-mixes 1, 2, 4 and 6 channels and has nothing for 8, so a 7.1 file
 * fell back to the discrete rule: only FL and FR passed, and the person heard (and the meter read) a 7.1 recording without its centre and surrounds.
 * 7.1 channel order is FL FR FC LFE BL BR SL SR. L = FL + 0.7071 FC + 0.7071 BL + 0.7071 SL and R = FR + 0.7071 FC + 0.7071 BR + 0.7071 SR; the LFE
 * (channel 3) is dropped. These are the 5.1 speakers-rule values extended to the side pair, and what ffmpeg's float down-mix does (T-162 (2)).
 */
export const FOLD_7_1: ReadonlyArray<{ channel: number; gain: number; to: ReadonlyArray<0 | 1> }> = [
  { channel: 0, gain: 1, to: [0] },
  { channel: 1, gain: 1, to: [1] },
  { channel: 2, gain: Math.SQRT1_2, to: [0, 1] },
  { channel: 4, gain: Math.SQRT1_2, to: [0] },
  { channel: 5, gain: Math.SQRT1_2, to: [1] },
  { channel: 6, gain: Math.SQRT1_2, to: [0] },
  { channel: 7, gain: Math.SQRT1_2, to: [1] }
]

/** The stereo fold of a source with `channels` channels: its nodes (all to be disconnected) and the node whose output is what is heard and metered. */
function buildFold(ctx: AudioContext, source: AudioNode, channels: number): { nodes: AudioNode[]; out: AudioNode } {
  if (channels === 8) {
    const splitter = ctx.createChannelSplitter(8)
    const merger = ctx.createChannelMerger(2)
    const nodes: AudioNode[] = [splitter, merger]
    source.connect(splitter)
    for (const { channel, gain, to } of FOLD_7_1) {
      const g = ctx.createGain()
      g.gain.value = gain
      splitter.connect(g, channel)
      for (const side of to) g.connect(merger, 0, side)
      nodes.push(g)
    }
    return { nodes, out: merger }
  }
  // simplification: the speakers rule folds 1, 2, 4 and 6 channels exactly (mono up-mixes to both sides, 5.1 and quad fold their centre and surrounds in).
  // 3, 5, 7 and more than 8 channels have no rule, so they fall back to the discrete one: FL and FR only. Upgrade path: a matrix per layout, as 8 has.
  const fold = ctx.createGain()
  fold.channelCount = 2
  fold.channelCountMode = 'explicit'
  fold.channelInterpretation = 'speakers'
  source.connect(fold)
  return { nodes: [fold], out: fold }
}

export function VolumeMeter({ audioElement, channels = 2 }: VolumeMeterProps): JSX.Element {
  const [levels, setLevels] = useState<number[]>(() => Array(NUM_BARS).fill(0))
  const [peakDb, setPeakDb] = useState(-60)
  const rafRef = useRef<number | null>(null)
  // The graph of the current element. The media-element source node is made ONCE per element (createMediaElementSource cannot run twice on one
  // element); the fold section between it and the outputs is rebuilt when the channel count changes.
  const graphRef = useRef<{
    ctx: AudioContext
    source: MediaElementAudioSourceNode
    analyser: AnalyserNode
    split: ChannelSplitterNode
    left: AnalyserNode
    right: AnalyserNode
    fold: { nodes: AudioNode[]; out: AudioNode; channels: number } | null
  } | null>(null)
  const channelsRef = useRef(channels)
  channelsRef.current = channels

  /** T-162 (6): source -> fold -> destination, the spectrum analyser on the fold's output, so what is heard is what is metered. */
  function connectFold(g: NonNullable<typeof graphRef.current>, count: number): void {
    if (g.fold) {
      for (const n of g.fold.nodes) n.disconnect()
      g.source.disconnect()
    }
    const built = buildFold(g.ctx, g.source, count)
    built.out.connect(g.analyser)
    built.out.connect(g.split)
    g.fold = { ...built, channels: count }
  }

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
        analyser.connect(ctx.destination)
        // T-160 (3): one analyser per channel, after the fold and not connected onward: they only read. An AnalyserNode analyses its input down-mixed to
        // mono ((L+R)/2), so one read a tone on L only 6 dB low and an L = -R signal as silence; the level is the larger of these two peaks.
        // T-161 (4): a ChannelSplitter(2) takes channels 0 and 1 of its input and nothing else, so a 5.1 file with its voice on the centre (channel 2) read
        // "-60 dB" until the fold ahead of it (a stereo down-mix by the speakers rule) put the centre into both sides.
        const split = ctx.createChannelSplitter(2)
        const left = ctx.createAnalyser()
        const right = ctx.createAnalyser()
        left.fftSize = 1024
        right.fftSize = 1024
        split.connect(left, 0)
        split.connect(right, 1)
        const g = { ctx, source, analyser, split, left, right, fold: null }
        graphRef.current = g
        connectFold(g, channelsRef.current)
        loop()
      } catch {
        /* media element already attached or ctx failed */
      }
    }

    function loop(): void {
      const g = graphRef.current
      if (!g) return
      const { analyser } = g
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
      const wave = new Float32Array(analyser.fftSize)
      let peak = 0
      for (const node of [g.left, g.right]) {
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
      const g = graphRef.current
      try {
        g?.source.disconnect()
        for (const n of g?.fold?.nodes ?? []) n.disconnect()
        g?.analyser.disconnect()
        g?.split.disconnect()
        g?.left.disconnect()
        g?.right.disconnect()
        void g?.ctx.close()
      } catch {
        /* ignore */
      }
      graphRef.current = null
    }
  }, [audioElement])

  // A probe that answers after the element is wired (or a source swapped for one with another layout) rebuilds only the fold.
  useEffect(() => {
    const g = graphRef.current
    if (!g || g.fold?.channels === channels) return
    try {
      connectFold(g, channels)
    } catch {
      /* ctx closed */
    }
  }, [channels])

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
