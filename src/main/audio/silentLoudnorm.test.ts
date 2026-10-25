import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_CHAIN_SPEC } from '../../shared/audio'

/**
 * T-114 - the two-pass loudness export of a SILENT input.
 *
 * Pass 1 over silence prints `input_i: "-inf"` and `target_offset: "inf"`. Pass 2 used to hand those
 * back as `measured_I=-inf ... offset=inf`, which loudnorm's option ranges refuse, so a silent track
 * (a muted mic, a game-only capture) could not be exported with "Match loudness" on. The parser now
 * reports no measurement for a non-finite value and the runner's existing fallback applies: the
 * single-pass, dynamic loudnorm. The real runner runs here with a fake child that prints what
 * ffmpeg prints; Layer 5 (media.spec.ts) proves the real binary accepts the fallback.
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
/** What pass 1 (the one writing to the null muxer) prints to stderr. */
let pass1Stderr = ''

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    spawned.push(args)
    setImmediate(() => {
      if (args.includes('null')) child.stderr.emit('data', pass1Stderr)
      child.emit('close', 0, null)
    })
    return child
  }
}))
vi.mock('./probe', () => ({
  probeAudio: async () => ({ duration: 4, sampleRate: 44100, channels: 1, codec: 'pcm_s16le', bitrate: 0, format: 'wav', sizeBytes: 0 })
}))

const { runAudioExport } = await import('./process')

const BLOCK = (fields: Record<string, string>): string =>
  `[Parsed_loudnorm_0 @ 0x1]\n${JSON.stringify(
    { input_i: '-23.50', input_tp: '-3.20', input_lra: '5.10', input_thresh: '-33.50', output_i: '-16.0', target_offset: '-0.12', ...fields },
    null,
    2
  )}\n`

const exportWith = async (stderr: string): Promise<{ pass1: string; pass2: string }> => {
  pass1Stderr = stderr
  await runAudioExport(
    {
      jobId: 'silent-loudnorm',
      sourcePath: path.join(tmpdir(), 'voice.wav'),
      outputPath: path.join(tmpdir(), 'out.wav'),
      chain: { ...DEFAULT_CHAIN_SPEC, loudnorm: true, loudnormTargetLufs: -16 },
      format: 'wav'
    },
    () => undefined
  )
  expect(spawned.length, 'measure pass + render pass').toBe(2)
  const afOf = (args: string[] | undefined): string => args?.[(args?.indexOf('-af') ?? -2) + 1] ?? ''
  return { pass1: afOf(spawned[0]), pass2: afOf(spawned[1]) }
}

beforeEach(() => {
  spawned.length = 0
})

describe('runAudioExport - the two-pass loudness render of silence (T-114)', () => {
  it('a silent measurement (-inf / inf) is not handed back: pass 2 is the single-pass loudnorm', async () => {
    const { pass2 } = await exportWith(BLOCK({ input_i: '-inf', input_tp: '-inf', output_i: '-inf', target_offset: 'inf' }))
    expect(pass2).toContain('loudnorm=I=-16:TP=-1.5:LRA=11')
    expect(pass2).not.toMatch(/measured_|offset=|linear=/)
    expect(pass2).not.toMatch(/inf/i)
  })

  it('the control: a finite measurement is handed back exactly, as a linear second pass', async () => {
    const { pass2 } = await exportWith(BLOCK({}))
    expect(pass2).toContain('measured_I=-23.50')
    expect(pass2).toContain('measured_TP=-3.20')
    expect(pass2).toContain('offset=-0.12')
    expect(pass2).toContain('linear=true')
  })

  it('a pass 1 that printed nothing parseable is the same fallback (the existing behavior, now pinned)', async () => {
    const { pass2 } = await exportWith('Output file is empty, nothing was encoded\n')
    expect(pass2).toContain('loudnorm=I=-16:TP=-1.5:LRA=11')
    expect(pass2).not.toMatch(/measured_/)
  })
})

// T-137 (8): the measure pass kept ALL of its stderr (`collectStderr`), the one pass that runs for the whole file at a log level that can be verbose.
// loudnorm prints its JSON LAST, so the pass keeps the same 16 KB tail every other spawn does and the parse reads the tail. This pins that the
// measurement survives a log far bigger than the tail (a damaged source warns on every packet) and one with lines after the block.
describe('runAudioExport - the measure pass keeps a tail, and the measurement is in it (T-137 (8))', () => {
  const WARNING = '[aac @ 0x55d0c0a1] Number of bands (23) exceeds limit (22).\n'
  const FLOOD = WARNING.repeat(Math.ceil((600 * 1024) / WARNING.length))

  it('a block printed after 600 KB of warnings is still found, and handed to the second pass exactly', async () => {
    const { pass2 } = await exportWith(FLOOD + BLOCK({ input_i: '-21.30', input_tp: '-2.10', target_offset: '0.40' }))
    expect(pass2).toContain('measured_I=-21.30')
    expect(pass2).toContain('measured_TP=-2.10')
    expect(pass2).toContain('offset=0.40')
    expect(pass2).toContain('linear=true')
  })

  it('and when ffmpeg prints a few lines after the block (the muxer closing) the block is still the one used', async () => {
    const { pass2 } = await exportWith(FLOOD + BLOCK({ input_i: '-19.80' }) + '[out#0/null @ 0x1] video:0kB audio:1234kB subtitle:0kB other streams:0kB\n')
    expect(pass2).toContain('measured_I=-19.80')
  })
})
