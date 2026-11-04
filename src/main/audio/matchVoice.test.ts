import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_CHAIN_SPEC } from '../../shared/audio'
import type { AudioExportSpec, AudioJobProgress, ChainSpec, SecondaryTrack } from '../../shared/audio'
import { isCancelledError } from '../../shared/cancel'

// The runner hands ffmpeg a partial and swaps it in when whole; this file pins the command lines and the progress events, so the swap is left out of it
// (`partialOutput.test.ts`, `cancelSentinel.test.ts` and Layer 5 are its).
vi.mock('../ffmpeg/partialOutput', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ffmpeg/partialOutput')>()),
  finishPartial: async <T,>(work: Promise<T>, o: { target: string }) => ({ value: await work, outputPath: o.target })
}))

/**
 * T-150 (1) - "Match loudness with your voice" with Even volume OFF.
 *
 * The checkbox makes the VOICE the reference, but the music and the voice both went to a hidden -16 (the Even volume target, read while its box is disabled):
 * a -22 LUFS voice came out at -16 with its loudness range reshaped. Now the voice's own chain is measured (a measure pass, the pass-1 builder's
 * `print_format=json` stage), the music is brought to THAT, the voice gets no loudnorm and the bus ends in the limiter. With Even volume ON nothing moves.
 * The real runner runs here with a fake child that prints what loudnorm prints; Layer 5 (media.spec.ts) proves the real binary accepts the graphs and
 * that the output measures where it says, on both majors.
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
    queueMicrotask(() => this.emit('close', null, 'SIGTERM'))
    return true
  }
}
const spawned: string[][] = []
/** What the measure pass (the one writing to the null muxer) prints. */
let measurePrints = ''
/** A child that never ends on its own: the test cancels it. */
let hold = false

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    spawned.push(args)
    if (!hold) {
      setImmediate(() => {
        if (args.includes('null')) child.stderr.emit('data', measurePrints)
        child.emit('close', 0, null)
      })
    }
    return child
  }
}))
vi.mock('./probe', () => ({
  probeAudio: async () => ({ duration: 4, sampleRate: 44100, channels: 1, codec: 'pcm_s16le', bitrate: 0, format: 'wav', sizeBytes: 0 })
}))

const { runAudioExport, cancelAudioJob } = await import('./process')

const BLOCK = (inputI: string): string =>
  `[Parsed_loudnorm_0 @ 0x1]\n${JSON.stringify(
    { input_i: inputI, input_tp: '-3.20', input_lra: '5.10', input_thresh: '-33.50', output_i: '-16.0', target_offset: '-0.12' },
    null,
    2
  )}\n`
const SILENT = BLOCK('-inf')
const LIMITER = 'alimiter=limit=0.891:level=disabled'

const second = (over: Partial<SecondaryTrack> = {}): SecondaryTrack => ({
  filePath: path.join(tmpdir(), 'bed.wav'),
  fileName: 'bed.wav',
  role: 'music',
  gainDb: -12,
  duckUnderPrimary: false,
  matchLoudness: false,
  ...over
})

async function exportWith(
  chain: Partial<ChainSpec>,
  secondary: Partial<SecondaryTrack>,
  events: AudioJobProgress[] = []
): Promise<{ measures: string[]; graph: string; count: number }> {
  spawned.length = 0
  const spec: AudioExportSpec = {
    jobId: 'match-voice',
    sourcePath: path.join(tmpdir(), 'voice.wav'),
    outputPath: path.join(tmpdir(), 'out.wav'),
    chain: { ...DEFAULT_CHAIN_SPEC, ...chain, secondaryTrack: second(secondary) },
    format: 'wav'
  }
  await runAudioExport(spec, (p) => events.push(p))
  const flag = (args: string[], name: string): string => args[args.indexOf(name) + 1] ?? ''
  const render = spawned[spawned.length - 1] ?? []
  return {
    measures: spawned.filter((a) => a.includes('null')).map((a) => flag(a, '-af')),
    graph: flag(render, '-filter_complex'),
    count: spawned.length
  }
}

/** The second track's branch of the graph: `[1:a]` up to the label it feeds. */
const musicBranch = (graph: string): string => /\[1:a\](.*?)\[secondary(?:_pre)?\]/.exec(graph)?.[1] ?? ''
/** The primary's branch: `[0:a]` up to its normalising resample. */
const voiceBranch = (graph: string): string => /\[0:a\](.*?),aresample=48000,aformat=channel_layouts=stereo/.exec(graph)?.[1] ?? ''
/** The mix bus: everything after `[premix]`. */
const bus = (graph: string): string => /;\[premix\](.*)\[mix\]/.exec(graph)?.[1] ?? ''

beforeEach(() => {
  measurePrints = BLOCK('-22.40')
  hold = false
})

describe('the graph for each of Even volume x Match loudness (T-150 (1))', () => {
  it('Even volume OFF, Match OFF: one pass; the music takes its own gain; the bus is the limiter (unchanged)', async () => {
    const { count, graph, measures } = await exportWith({}, {})
    expect(count).toBe(1)
    expect(measures).toEqual([])
    expect(musicBranch(graph)).toBe('aresample=48000,aformat=channel_layouts=stereo,volume=-12dB')
    expect(graph).not.toContain('loudnorm')
    expect(bus(graph)).toBe(LIMITER)
  })

  it('Even volume OFF, Match ON: the voice is measured; the music follows the measured I; the voice and the bus get no loudnorm', async () => {
    const { count, graph, measures } = await exportWith({}, { matchLoudness: true })
    expect(count).toBe(2)
    expect(measures).toEqual(['loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json'])
    expect(musicBranch(graph)).toBe('aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-22.4:TP=-1.5:LRA=11')
    expect(voiceBranch(graph)).toBe('anull')
    expect(bus(graph)).toBe(LIMITER)
    // The only loudnorm in the render is the music's: the voice is not moved to a target, and the bus is not either.
    expect(graph.match(/loudnorm=/g)).toHaveLength(1)
  })

  it('Even volume OFF, Match ON: the measure pass is the voice\'s own chain (cut, filters, gain), and its target box is not read', async () => {
    const { graph, measures } = await exportWith(
      { rumbleHighpass: true, gainDb: 3, cutRegions: [{ startSec: 1, endSec: 2 }], loudnormTargetLufs: -3 },
      { matchLoudness: true }
    )
    expect(measures).toHaveLength(1)
    expect(measures[0]).toBe(
      `asetnsamples=n=256:p=0,aselect='not(between(t\\,1.000\\,2.000))',asetpts=N/SR/TB,asetnsamples=n=4096:p=0,highpass=f=80,volume=3dB,loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json`
    )
    // The render's voice has the same stages (the cut is applied once, on the mix) and still no loudnorm.
    expect(voiceBranch(graph)).toBe('highpass=f=80,volume=3dB')
    expect(graph).not.toContain('I=-3:')
  })

  it('Even volume ON, Match OFF: unchanged - the voice\'s loudnorm is in its chain, the music takes its gain, the bus loudnorms to the target', async () => {
    const { count, graph, measures } = await exportWith({ loudnorm: true, loudnormTargetLufs: -18 }, {})
    expect(count).toBe(2)
    expect(measures).toHaveLength(1)
    expect(voiceBranch(graph)).toContain('loudnorm=I=-18:TP=-1.5:LRA=11:measured_I=-22.40')
    expect(musicBranch(graph)).toBe('aresample=48000,aformat=channel_layouts=stereo,volume=-12dB')
    expect(bus(graph)).toBe('loudnorm=I=-18:TP=-1.5:LRA=11')
  })

  it('Even volume ON, Match ON: unchanged - one measure pass, the music goes to the TARGET (not to the measurement), the bus loudnorms to it', async () => {
    const { count, graph, measures } = await exportWith({ loudnorm: true, loudnormTargetLufs: -18 }, { matchLoudness: true })
    expect(count).toBe(2)
    expect(measures).toHaveLength(1)
    expect(voiceBranch(graph)).toContain('loudnorm=I=-18:TP=-1.5:LRA=11:measured_I=-22.40')
    expect(musicBranch(graph)).toBe('aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-18:TP=-1.5:LRA=11')
    expect(bus(graph)).toBe('loudnorm=I=-18:TP=-1.5:LRA=11')
  })

  it('ducking keeps the same music branch: the matched loudnorm is ahead of the sidechain', async () => {
    const { graph } = await exportWith({}, { matchLoudness: true, duckUnderPrimary: true })
    expect(graph).toContain('[1:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-22.4:TP=-1.5:LRA=11[secondary_pre]')
    expect(bus(graph)).toBe(LIMITER)
  })
})

describe('the measurement the music follows (T-150 (1))', () => {
  it.each([
    ['-3.00', '-5'],
    ['-80.00', '-70'],
    ['-5.00', '-5'],
    ['-70.00', '-70'],
    ['-31.70', '-31.7']
  ])('a measured I of %s is handed on as %s (loudnorm accepts -70 to -5)', async (measured, handed) => {
    measurePrints = BLOCK(measured)
    const { graph } = await exportWith({}, { matchLoudness: true })
    expect(musicBranch(graph)).toBe(`aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=${handed}:TP=-1.5:LRA=11`)
  })

  it('a silent voice (-inf) has nothing to follow: the music takes its plain gain, and no -inf reaches ffmpeg', async () => {
    measurePrints = SILENT
    const { count, graph } = await exportWith({}, { matchLoudness: true })
    expect(count).toBe(2)
    expect(musicBranch(graph)).toBe('aresample=48000,aformat=channel_layouts=stereo,volume=-12dB')
    expect(graph).not.toContain('loudnorm')
    expect(graph).not.toMatch(/inf/i)
    expect(bus(graph)).toBe(LIMITER)
  })

  it('a measure pass that printed nothing parseable is the same fallback', async () => {
    measurePrints = 'Output file is empty, nothing was encoded\n'
    const { graph } = await exportWith({}, { matchLoudness: true })
    expect(musicBranch(graph)).toBe('aresample=48000,aformat=channel_layouts=stereo,volume=-12dB')
  })
})

describe('the measure pass is announced and can be cancelled (T-150 (1))', () => {
  it('Match ON with Even volume off reports measure then render, each starting at 0%', async () => {
    const events: AudioJobProgress[] = []
    await exportWith({}, { matchLoudness: true }, events)
    const starts = events.filter((e) => e.percent === 0).map((e) => e.pass)
    expect(starts).toEqual(['measure', 'render'])
  })

  it('Match OFF with Even volume off reports the render alone', async () => {
    const events: AudioJobProgress[] = []
    await exportWith({}, {}, events)
    expect(events.map((e) => e.pass)).not.toContain('measure')
  })

  it('a Cancel during the voice measurement ends the export and starts no render', async () => {
    hold = true
    spawned.length = 0
    const outcome = runAudioExport(
      {
        jobId: 'match-cancel',
        sourcePath: path.join(tmpdir(), 'voice.wav'),
        outputPath: path.join(tmpdir(), 'out.wav'),
        chain: { ...DEFAULT_CHAIN_SPEC, secondaryTrack: second({ matchLoudness: true }) },
        format: 'wav'
      },
      () => undefined
    ).then(
      () => null,
      (err: unknown) => err
    )
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    expect(spawned[0]).toContain('null')
    expect(cancelAudioJob('match-cancel')).toBe(true)
    expect(isCancelledError(await outcome)).toBe(true)
    expect(spawned).toHaveLength(1)
  })
})
