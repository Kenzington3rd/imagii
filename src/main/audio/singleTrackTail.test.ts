import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_CHAIN_SPEC } from '../../shared/audio'
import type { AudioExportSpec, ChainSpec } from '../../shared/audio'

// T-140 (1): the runner hands ffmpeg a partial and swaps it in when whole. This file pins what is on the command line and in the progress events, with a child
// that writes nothing and paths that are not a folder of its own, so the swap is left out of it: it is `partialOutput.test.ts`'s, `cancelSentinel.test.ts`'s
// (every runner, a child that writes where ffmpeg writes) and Layer 5's (the real binary).
vi.mock('../ffmpeg/partialOutput', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ffmpeg/partialOutput')>()),
  finishPartial: async <T,>(work: Promise<T>, o: { target: string }) => ({ value: await work, outputPath: o.target })
}))


/**
 * T-123 (10) and (11): what the single-track export puts at the END of its `-af`, and what it tells
 * loudnorm about the source's channels.
 *
 * (10) The mix bus ended in a stage that answers for its peaks and the single-track path did not:
 * +12 dB of Manual gain on a -2 dBFS source exported at 0.0 dBFS. A chain with any stage now ends in
 * the same limiter the mix bus uses; a bare 'anull' stays a pass-through; Even volume ends in loudnorm,
 * whose own true-peak limit is the answer.
 * (11) A mono source's loudnorm is measured as dual mono (`dual_mono=true`, both passes). The mix path
 * already forces stereo ahead of its last stage, so it is not told.
 *
 * The real runner runs here with a fake child and a probe whose channel count the test picks; a string
 * cannot say ffmpeg accepts it or that the result lands where it says, so Layer 5 (media.spec.ts, "a
 * single-track export answers for its peaks and its loudness label") runs the real binary.
 */
class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runner sets utf8 */
  }
}
class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  kill(): boolean {
    return true
  }
}
const spawned: string[][] = []
let channels = 2
/** What `probeAudioChannels` answers (T-164 (1): the MP3 fold reads the source's own count, the most of any stream); null is a count it could not read. */
let sourceChannels: number | null = 2
let probeAudioChannelsCalls = 0

const MEASUREMENT = `{ "input_i": "-23.50", "input_tp": "-3.20", "input_lra": "5.10", "input_thresh": "-33.50", "output_i": "-16.0", "target_offset": "-0.12" }`
const SILENT = `{ "input_i": "-inf", "input_tp": "-inf", "input_lra": "0.00", "input_thresh": "-inf", "output_i": "-inf", "target_offset": "inf" }`
/** What pass 1 prints. */
let pass1Prints = MEASUREMENT

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    spawned.push(args)
    setImmediate(() => {
      if (args.includes('null')) child.stderr.emit('data', pass1Prints)
      child.emit('close', 0, null)
    })
    return child
  }
}))
vi.mock('./probe', () => ({
  probeAudio: async () => ({ duration: 4, sampleRate: 44100, channels, codec: 'pcm_s16le', bitrate: 0, format: 'wav', sizeBytes: 0 }),
  probeAudioChannels: async () => {
    probeAudioChannelsCalls++
    return sourceChannels
  }
}))

const { runAudioExport } = await import('./process')

const LIMITER = 'alimiter=limit=0.891:level=disabled'

async function exportWith(
  chain: Partial<ChainSpec>,
  format: AudioExportSpec['format'] = 'wav'
): Promise<{ passes: string[][]; afs: string[]; render: string[] }> {
  spawned.length = 0
  const spec: AudioExportSpec = {
    jobId: 'tail',
    sourcePath: path.join(tmpdir(), 'voice.wav'),
    outputPath: path.join(tmpdir(), `out.${format}`),
    chain: { ...DEFAULT_CHAIN_SPEC, ...chain } as ChainSpec,
    format
  }
  await runAudioExport(spec, () => undefined)
  const afOf = (args: string[]): string => args[args.indexOf('-af') + 1] ?? ''
  return { passes: [...spawned], afs: spawned.map(afOf), render: spawned[spawned.length - 1] ?? [] }
}

beforeEach(() => {
  channels = 2
  sourceChannels = 2
  probeAudioChannelsCalls = 0
  pass1Prints = MEASUREMENT
})

describe('the single-track -af ends in the mix bus\'s limiter (T-123 (10))', () => {
  it.each([
    ['Manual gain', { gainDb: 12 }, 'volume=12dB'],
    ['a high-pass', { rumbleHighpass: true }, 'highpass=f=80'],
    ['hum removal', { hum60: true }, 'bandreject=f=60:width_type=h:w=2,bandreject=f=120:width_type=h:w=2'],
    ['a compressor', { compressor: 'voice' as const }, 'acompressor=']
  ])('%s: the chain, then the limiter, last', async (_name, chain, head) => {
    const { afs } = await exportWith(chain)
    expect(afs).toHaveLength(1)
    expect(afs[0]).toContain(head)
    expect(afs[0]?.endsWith(`,${LIMITER}`)).toBe(true)
    expect(afs[0]?.match(/alimiter=/g)).toHaveLength(1)
  })

  it('a cut alone is a stage: the chain is the cut, then the limiter', async () => {
    const { afs } = await exportWith({ cutRegions: [{ startSec: 1, endSec: 2 }] })
    expect(afs[0]).toBe(
      `asetnsamples=n=256:p=0,aselect='not(between(t\\,1.000\\,2.000))',asetpts=N/SR/TB,asetnsamples=n=4096:p=0,${LIMITER}`
    )
  })

  it('the limiter is the very constant the mix bus uses (one ceiling, -1 dBFS, no re-leveling)', async () => {
    const { afs } = await exportWith({ gainDb: 3 })
    expect(afs[0]).toBe(`volume=3dB,${LIMITER}`)
    expect(LIMITER).toContain('level=disabled')
    expect(LIMITER).toContain('limit=0.891')
  })

  it('a bare pass-through stays anull: nothing switched on is the file that went in', async () => {
    const { afs } = await exportWith({})
    expect(afs).toEqual(['anull'])
  })

  it('Even volume ends in loudnorm, and gets no second last stage (its true-peak limit is the answer)', async () => {
    const { afs } = await exportWith({ loudnorm: true, loudnormTargetLufs: -16, gainDb: 6 })
    expect(afs).toHaveLength(2)
    for (const af of afs) expect(af).not.toContain('alimiter')
    expect(afs[1]?.split(',').pop()?.startsWith('loudnorm=')).toBe(true)
  })

  it('a second track keeps the mix bus\'s own limiter: the primary\'s chain is not limited twice', async () => {
    const { render } = await exportWith({
      gainDb: 6,
      secondaryTrack: {
        filePath: path.join(tmpdir(), 'bed.wav'),
        fileName: 'bed.wav',
        role: 'music',
        gainDb: 0,
        duckUnderPrimary: false
      }
    })
    expect(render).not.toContain('-af')
    const graph = render[render.indexOf('-filter_complex') + 1] ?? ''
    expect(graph.match(/alimiter=/g)).toHaveLength(1)
  })
})

describe('a mono source\'s loudnorm is told it is mono, on both passes (T-123 (11))', () => {
  const EVEN = { loudnorm: true, loudnormTargetLufs: -16 } as const

  it('mono: the measure pass and the render pass both say dual_mono=true', async () => {
    channels = 1
    const { afs } = await exportWith(EVEN)
    expect(afs).toHaveLength(2)
    expect(afs[0]).toMatch(/loudnorm=.*print_format=json:dual_mono=true$/)
    expect(afs[1]).toMatch(/loudnorm=.*measured_I=-23\.50.*dual_mono=true$/)
  })

  it('mono with a silent measurement: the single-pass fallback is a loudnorm too, and says it', async () => {
    channels = 1
    pass1Prints = SILENT // nothing pass 2 can use, so pass 2 is the single-pass loudnorm
    const { afs } = await exportWith({ ...EVEN })
    expect(afs[1]).not.toContain('measured_I')
    expect(afs[1]).toBe('loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json:dual_mono=true')
  })

  it.each([2, 6])('%d channels: loudnorm is unchanged (the option is for mono, and a stereo file is not dual mono)', async (n) => {
    channels = n
    const { afs } = await exportWith(EVEN)
    for (const af of afs) expect(af).not.toContain('dual_mono')
  })

  it('mono with Even volume off: nothing to set it on (and the limiter is still the last stage)', async () => {
    channels = 1
    const { afs } = await exportWith({ gainDb: 3 })
    expect(afs[0]).toBe(`volume=3dB,${LIMITER}`)
  })

  it('mono with a second track: the mix path is not told (it forces stereo ahead of its own last stage)', async () => {
    channels = 1
    const { passes } = await exportWith({
      ...EVEN,
      secondaryTrack: {
        filePath: path.join(tmpdir(), 'bed.wav'),
        fileName: 'bed.wav',
        role: 'music',
        gainDb: 0,
        duckUnderPrimary: false
      }
    })
    for (const args of passes) expect(args.join(' ')).not.toContain('dual_mono')
  })
})

describe('an MP3 export of a surround source folds it first, in float (T-164 (1))', () => {
  // MP3 holds two channels at most; with nothing on the chain ffmpeg folded the source in the s16 output conversion, where swresample normalises the matrix (a front-left tone
  // 7.8 dB down). The fold is `SURROUND_TO_STEREO_FILTER`, the first stage of both passes. What ffmpeg does with it is Layer 5's ("an MP3 export of a surround file keeps its level").
  const FOLD = 'aformat=sample_fmts=fltp:channel_layouts=stereo'
  const EVEN = { loudnorm: true, loudnormTargetLufs: -16 } as const
  const BED = { filePath: path.join(tmpdir(), 'bed.wav'), fileName: 'bed.wav', role: 'music' as const, gainDb: 0, duckUnderPrimary: false }

  it.each([6, 8, 3])('a %d-channel source to MP3 with nothing switched on: the fold, then the bare pass-through, and no limiter', async (n) => {
    sourceChannels = n
    channels = n
    const { afs } = await exportWith({}, 'mp3')
    expect(afs).toEqual([`${FOLD},anull`])
  })

  it('a stage on the chain: the fold is FIRST, the chain next, the limiter last (the limiter is decided on the chain, not on the fold)', async () => {
    sourceChannels = 6
    const { afs } = await exportWith({ gainDb: 3 }, 'mp3')
    expect(afs).toEqual([`${FOLD},volume=3dB,${LIMITER}`])
  })

  it('Even volume: BOTH passes start with the fold, so the measuring is of the stereo file that is written', async () => {
    sourceChannels = 6
    const { afs } = await exportWith(EVEN, 'mp3')
    expect(afs).toHaveLength(2)
    for (const af of afs) {
      expect(af.startsWith(`${FOLD},`), af).toBe(true)
      expect(af.match(/aformat=/g), 'folded once').toHaveLength(1)
    }
    expect(afs[0]).toContain('print_format=json')
    expect(afs[1]).toContain('measured_I=-23.50')
    expect(afs[1]).not.toContain('alimiter')
  })

  it('a cut is after the fold on both passes (the fold is the first stage, whatever the chain starts with)', async () => {
    sourceChannels = 6
    const { afs } = await exportWith({ ...EVEN, cutRegions: [{ startSec: 1, endSec: 2 }] }, 'mp3')
    for (const af of afs) expect(af.startsWith(`${FOLD},asetnsamples=n=256:p=0,aselect=`), af).toBe(true)
  })

  it.each([1, 2])('a %d-channel source to MP3 is unchanged: no fold', async (n) => {
    sourceChannels = n
    channels = n
    const { afs } = await exportWith({}, 'mp3')
    expect(afs).toEqual(['anull'])
  })

  it('a source whose channels cannot be read (null) is exported as it always was', async () => {
    sourceChannels = null
    const { afs } = await exportWith({ gainDb: 3 }, 'mp3')
    expect(afs).toEqual([`volume=3dB,${LIMITER}`])
  })

  it.each(['wav', 'flac', 'aac'] as const)('%s keeps the file\'s channels: no fold, and the source is not even probed for them', async (format) => {
    sourceChannels = 6
    const { afs } = await exportWith(EVEN, format)
    for (const af of afs) expect(af).not.toContain(FOLD)
    expect((await exportWith({}, format)).afs).toEqual(['anull'])
    expect(probeAudioChannelsCalls).toBe(0)
  })

  it('a second track, MP3: the primary is folded by the player\'s matrix, ahead of the mix\'s own normalise (T-173 (2))', async () => {
    sourceChannels = 6
    const { render } = await exportWith({ secondaryTrack: BED }, 'mp3')
    const graph = render[render.indexOf('-filter_complex') + 1] ?? ''
    expect(graph.startsWith(`[0:a]${FOLD},anull,aresample=48000,aformat=channel_layouts=stereo[primary];`)).toBe(true)
    expect(graph.match(/aformat=sample_fmts=fltp/g), 'the bed is stereo: one fold only').toHaveLength(1)
  })

  it('the channel count is read once per export', async () => {
    sourceChannels = 6
    await exportWith(EVEN, 'mp3')
    expect(probeAudioChannelsCalls).toBe(1)
  })
})

describe('a mix folds a surround voice by the player\'s matrix, first; the bed needs no fold of its own (T-173 (2))', () => {
  // Even volume and Match measured the voice on its six channels (BS.1770 weights a surround channel +1.5 dB, the fold drops it at 0.7071), so a voice on a surround channel landed ~4.5 dB off the balance
  // its stereo twin gets. A primary of more than two channels is folded by `SURROUND_TO_STEREO_FILTER` as the first stage of every pass. The bed has no fold of its own: its conversion is the mix's float one
  // (the same matrix), and its Match loudnorm measures after it.
  // Mono and stereo inputs get no new stage (the strings below are today's, to the character). What ffmpeg does with the graph is Layer 5's ("a surround voice keeps its level in a mix").
  const FOLD = 'aformat=sample_fmts=fltp:channel_layouts=stereo'
  const NORM = 'aresample=48000,aformat=channel_layouts=stereo'
  const EVEN = { loudnorm: true, loudnormTargetLufs: -16 } as const
  const BED = { filePath: path.join(tmpdir(), 'bed.wav'), fileName: 'bed.wav', role: 'music' as const, gainDb: -6, duckUnderPrimary: false }

  /** The mix: every spawned command, the filters of the passes that measure (null muxer), and the render's graph. */
  async function mixWith(
    chain: Partial<ChainSpec>,
    bed: Partial<typeof BED & { matchLoudness: boolean }> = {},
    format: AudioExportSpec['format'] = 'wav'
  ): Promise<{ measures: string[]; graph: string }> {
    const { passes, render } = await exportWith({ ...chain, secondaryTrack: { ...BED, ...bed } }, format)
    const flag = (args: string[]): string => args[args.indexOf('-af') + 1] ?? ''
    return {
      measures: passes.filter((a) => a.includes('null')).map(flag),
      graph: render[render.indexOf('-filter_complex') + 1] ?? ''
    }
  }
  const voiceBranch = (graph: string): string => /^\[0:a\](.*?)\[primary\]/.exec(graph)?.[1] ?? ''
  const bedBranch = (graph: string): string => /\[1:a\](.*?)\[secondary(?:_pre)?\]/.exec(graph)?.[1] ?? ''

  it.each([6, 8, 3])('a %d-channel voice over a stereo bed: the fold is the FIRST stage of the voice\'s branch, and the bed is untouched', async (n) => {
    sourceChannels = n
    const { graph } = await mixWith({})
    expect(voiceBranch(graph)).toBe(`${FOLD},anull,${NORM}`)
    expect(bedBranch(graph)).toBe(`${NORM},volume=-6dB`)
    expect(graph.match(/sample_fmts=fltp/g)).toHaveLength(1)
  })

  it('it is the first stage whatever the chain holds: a stage, a cut, and the limiter stays on the bus', async () => {
    sourceChannels = 6
    const { graph } = await mixWith({ gainDb: 3, cutRegions: [{ startSec: 1, endSec: 2 }] })
    expect(voiceBranch(graph)).toBe(`${FOLD},volume=3dB,${NORM}`)
    expect(graph).toContain(`[premix]asetnsamples=n=256:p=0,aselect=`)
    expect(graph.endsWith(`,${LIMITER}[mix]`)).toBe(true)
  })

  it('Even volume: the measure pass and the render both start with the fold (loudnorm measures the stereo voice that is mixed)', async () => {
    sourceChannels = 6
    const { measures, graph } = await mixWith(EVEN)
    expect(measures).toHaveLength(1)
    expect(measures[0]?.startsWith(`${FOLD},`), measures[0]).toBe(true)
    expect(measures[0]).toContain('print_format=json')
    expect(voiceBranch(graph).startsWith(`${FOLD},`)).toBe(true)
    expect(voiceBranch(graph)).toContain('measured_I=-23.50')
  })

  it('Match loudness with Even volume off: the voice\'s own measure (the one Match follows) is folded too', async () => {
    sourceChannels = 6
    const { measures, graph } = await mixWith({}, { matchLoudness: true })
    expect(measures).toHaveLength(1)
    expect(measures[0]?.startsWith(`${FOLD},`), measures[0]).toBe(true)
    expect(bedBranch(graph)).toBe(`${NORM},loudnorm=I=-23.5:TP=-1.5:LRA=11`)
    expect(voiceBranch(graph)).toBe(`${FOLD},anull,${NORM}`)
  })

  it('Even volume and Match together: one folded measure pass, the bed brought to the target', async () => {
    sourceChannels = 6
    const { measures, graph } = await mixWith(EVEN, { matchLoudness: true })
    expect(measures).toHaveLength(1)
    expect(measures[0]?.startsWith(`${FOLD},`)).toBe(true)
    expect(bedBranch(graph)).toBe(`${NORM},loudnorm=I=-16:TP=-1.5:LRA=11`)
  })

  it('ducking: the voice is folded before it is split, so the sidechain keys on the same stereo voice that is mixed', async () => {
    sourceChannels = 6
    const { graph } = await mixWith({}, { duckUnderPrimary: true })
    expect(graph.startsWith(`[0:a]${FOLD},anull,${NORM},asplit=2[primary][primary_sc];`)).toBe(true)
    expect(graph.match(/sample_fmts=fltp/g)).toHaveLength(1)
  })

  it('a surround bed keeps the plain normalise: no fold in its branch (gain, Match and ducking), and the measure pass is of the voice alone', async () => {
    for (const bed of [{}, { matchLoudness: true }, { duckUnderPrimary: true }]) {
      const { graph, measures } = await mixWith(EVEN, bed)
      expect(graph.match(/sample_fmts=fltp/g), JSON.stringify(bed)).toBeNull()
      expect(bedBranch(graph).startsWith(NORM), JSON.stringify(bed)).toBe(true)
      for (const m of measures) expect(m).not.toContain(FOLD)
    }
  })

  it('a surround voice over a bed: only the voice is folded, and only the voice is probed', async () => {
    sourceChannels = 6
    const { graph } = await mixWith({})
    expect(voiceBranch(graph)).toBe(`${FOLD},anull,${NORM}`)
    expect(bedBranch(graph)).toBe(`${NORM},volume=-6dB`)
    expect(probeAudioChannelsCalls).toBe(1)
  })

  it.each([
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2]
  ])('a %d-channel voice and a %d-channel bed: no fold, the graph is exactly the one it always was', async (v) => {
    sourceChannels = v
    const { graph, measures } = await mixWith({})
    expect(graph).toBe(
      `[0:a]anull,${NORM}[primary];[1:a]${NORM},volume=-6dB[secondary];` +
        `[primary][secondary]amix=inputs=2:duration=longest:dropout_transition=0:weights='1 1':normalize=0[premix];[premix]${LIMITER}[mix]`
    )
    expect(measures).toHaveLength(0)
    expect((await mixWith(EVEN)).graph).not.toContain('sample_fmts')
  })

  it('a count it cannot read (null) leaves the graph as it was', async () => {
    sourceChannels = null
    const { graph } = await mixWith(EVEN, { matchLoudness: true })
    expect(graph).not.toContain('sample_fmts')
  })

  it('the voice is asked for its channels once, only when there is a mix or an MP3', async () => {
    sourceChannels = 6
    await mixWith({})
    expect(probeAudioChannelsCalls).toBe(1)
    probeAudioChannelsCalls = 0
    await exportWith({}, 'wav')
    expect(probeAudioChannelsCalls).toBe(0)
  })
})
