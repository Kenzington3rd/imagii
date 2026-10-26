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
  probeAudio: async () => ({ duration: 4, sampleRate: 44100, channels, codec: 'pcm_s16le', bitrate: 0, format: 'wav', sizeBytes: 0 })
}))

const { runAudioExport } = await import('./process')

const LIMITER = 'alimiter=limit=0.891:level=disabled'

async function exportWith(
  chain: Partial<ChainSpec>
): Promise<{ passes: string[][]; afs: string[]; render: string[] }> {
  spawned.length = 0
  const spec: AudioExportSpec = {
    jobId: 'tail',
    sourcePath: path.join(tmpdir(), 'voice.wav'),
    outputPath: path.join(tmpdir(), 'out.wav'),
    chain: { ...DEFAULT_CHAIN_SPEC, ...chain } as ChainSpec,
    format: 'wav'
  }
  await runAudioExport(spec, () => undefined)
  const afOf = (args: string[]): string => args[args.indexOf('-af') + 1] ?? ''
  return { passes: [...spawned], afs: spawned.map(afOf), render: spawned[spawned.length - 1] ?? [] }
}

beforeEach(() => {
  channels = 2
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
