import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_CHAIN_SPEC } from '../../shared/audio'

/**
 * T-125 (6) - an audio export's bar measures the file it WRITES.
 *
 * `out_time` is the position in the OUTPUT, and the output is the source with its cuts removed, but both passes divided it by the
 * SOURCE's length: a 300 s source with 200 s kept jumped 33.3% -> 100% at the end instead of 50% at the middle (Reframe's change
 * got this right, T-124 (16)). The denominator is the source's length less the merged length of the cuts, in the measure pass
 * (whose chain is cut-first) and in the render pass. The real runner runs; the child prints what ffmpeg's `-progress` prints.
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

/** The `out_time` (seconds into the OUTPUT) the next child prints before it exits. */
let outTimeSec = 100
const spawned: string[][] = []

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    spawned.push(args)
    const hh = String(Math.floor(outTimeSec / 3600)).padStart(2, '0')
    const mm = String(Math.floor((outTimeSec % 3600) / 60)).padStart(2, '0')
    const ss = (outTimeSec % 60).toFixed(6).padStart(9, '0')
    setImmediate(() => {
      child.stdout.emit('data', `out_time=${hh}:${mm}:${ss}\nprogress=continue\n`)
      child.emit('close', 0, null)
    })
    return child
  }
}))
vi.mock('./probe', () => ({
  probeAudio: async () => ({ duration: 300, sampleRate: 48000, channels: 2, codec: 'pcm_s16le', bitrate: 0, format: 'wav', sizeBytes: 0 })
}))

const { runAudioExport } = await import('./process')

interface Event {
  pass: string
  percent: number
}
async function progressOf(chain: Partial<typeof DEFAULT_CHAIN_SPEC>): Promise<Event[]> {
  const seen: Event[] = []
  await runAudioExport(
    {
      jobId: 'progress-job',
      sourcePath: path.join(tmpdir(), 'long.wav'),
      outputPath: path.join(tmpdir(), 'out.wav'),
      chain: { ...DEFAULT_CHAIN_SPEC, ...chain },
      format: 'wav'
    },
    (p) => seen.push({ pass: p.pass, percent: p.percent })
  )
  return seen
}
/** The runner's own events, without the synthetic 100% every pass ends with. */
const measured = (seen: Event[], pass: string): number[] => seen.filter((e) => e.pass === pass && e.percent < 100).map((e) => e.percent)

beforeEach(() => {
  spawned.length = 0
  outTimeSec = 100
})

describe('the audio export\'s progress is over the length of the file it writes (T-125 (6))', () => {
  // 300 s source; cut 50-150 (100 s) -> 200 s written. 100 s into the OUTPUT is the middle: 50%, not 33.3%.
  const CUT = [{ startSec: 50, endSec: 150 }]

  it('the render pass: 100 s into a 200 s output is 50%', async () => {
    const seen = await progressOf({ cutRegions: CUT })
    expect(measured(seen, 'render')).toEqual([50])
  })

  it('both passes of a loudness export: the measure pass is cut-first, so it is over the kept length too', async () => {
    const seen = await progressOf({ cutRegions: CUT, loudnorm: true, loudnormTargetLufs: -16 })
    expect(measured(seen, 'measure')).toEqual([50])
    expect(measured(seen, 'render')).toEqual([50])
  })

  it('overlapping and touching cuts are one span: 50-100 and 80-150 remove 100 s, not 120', async () => {
    const seen = await progressOf({ cutRegions: [{ startSec: 80, endSec: 150 }, { startSec: 50, endSec: 100 }] })
    expect(measured(seen, 'render')).toEqual([50])
  })

  it('a cut that runs past the end removes only what is there: 250-400 of a 300 s source is 50 s', async () => {
    outTimeSec = 125 // 125 s of a 250 s output
    const seen = await progressOf({ cutRegions: [{ startSec: 250, endSec: 400 }] })
    expect(measured(seen, 'render')).toEqual([50])
  })

  it('no cut: the source\'s length, as it was (100 s of 300 s)', async () => {
    const seen = await progressOf({})
    const [only] = measured(seen, 'render')
    expect(only).toBeCloseTo(100 / 3, 6)
  })

  it('cuts that leave next to nothing cannot divide by zero: the bar is capped at 100', async () => {
    // T-135 (12): a chain that cuts EVERYTHING is refused before any child runs (below), so the smallest export that can reach the bar keeps 0.1 s.
    outTimeSec = 5 // far more than the 0.1 s the chain writes
    const seen = await progressOf({ cutRegions: [{ startSec: 0, endSec: 299.9 }] })
    expect(seen.length).toBeGreaterThan(0)
    for (const e of seen) {
      expect(Number.isFinite(e.percent)).toBe(true)
      expect(e.percent).toBeLessThanOrEqual(100)
    }
  })

  it('cuts that cover everything are refused before any child runs: no pass, no event (T-135 (12))', async () => {
    const seen: Event[] = []
    await expect(
      runAudioExport(
        {
          jobId: 'all-cut',
          sourcePath: path.join(tmpdir(), 'long.wav'),
          outputPath: path.join(tmpdir(), 'out.wav'),
          chain: { ...DEFAULT_CHAIN_SPEC, cutRegions: [{ startSec: 0, endSec: 300 }] },
          format: 'wav'
        },
        (p) => seen.push({ pass: p.pass, percent: p.percent })
      )
    ).rejects.toThrow('Everything is cut out. Click a mark to put a part back.')
    expect(spawned, 'nothing was spawned').toEqual([])
    expect(seen).toEqual([])
  })
})
