import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

/**
 * T-149 (1) - a loud moment is closed by the digital silence after it.
 *
 * The peak loop used to walk only the "meaningful" samples (above -70 LUFS and finite), so a decay that jumped from above the threshold
 * straight under -70 (ebur128's momentary falls to about -160 on exact zeros within a few hops) showed the loop no below-threshold sample at
 * all: the peak stayed open through the whole silence and closed at the next audible sample (or the file's end). The loop now walks EVERY
 * sample in time order and reads `m <= -70` or a non-finite `m` as below the threshold. The real `findHighlights` runs here against a fake
 * ffmpeg whose stderr is the series under test; Layer 5 ("T-149 (1)") holds the same case on real audio.
 */
class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the scan sets utf8 on stderr */
  }
}
class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  exitCode: number | null = null
  kill(): boolean {
    return true
  }
}
let stderrText = ''

vi.mock('node:child_process', () => ({
  spawn: () => {
    const child = new FakeChild()
    queueMicrotask(() => {
      child.stderr.emit('data', stderrText)
      child.emit('close', 0, null)
    })
    return child
  }
}))
vi.mock('./probe', () => ({
  probeVideo: async () => ({ duration: 200, width: 640, height: 360, fps: 30, videoCodec: 'h264', audioCodec: 'aac', bitrate: 0, sizeBytes: 0 })
}))

const { findHighlights } = await import('./highlights')

/** One ebur128 line per 100 ms hop; `m` is the printed token ("-27.1", "-163.3", "-nan"). */
function series(tokens: Array<[count: number, m: string]>): string {
  const lines: string[] = []
  let t = 0
  for (const [count, m] of tokens) {
    for (let i = 0; i < count; i++) {
      t += 0.1
      lines.push(`[Parsed_ebur128_0 @ 0x1] t: ${t.toFixed(6)}  TARGET:-23 LUFS    M:${m.padStart(6)} S: -30.0     I: -30.0 LUFS       LRA:   0.0 LU`)
    }
  }
  return lines.join('\n')
}

beforeEach(() => {
  stderrText = ''
})

describe('a loud moment followed by digital silence (T-149 (1))', () => {
  it('closes at the first silent sample: the candidate is the moment plus its pad, not the silence', async () => {
    // 20 s of bed (-54.6), 2.5 s loud (-35), then the decay jumps straight to -161 for 60 s, then the bed again.
    stderrText = series([[200, '-54.6'], [25, '-35.0'], [600, '-161.0'], [200, '-54.6']])
    const found = await findHighlights('silence-1', '/in/vod.mp4', () => undefined)
    expect(found).toHaveLength(1)
    const c = found[0]!
    expect(c.startSec).toBeCloseTo(15.1, 1) // 20.1 - 5
    // The loud run is t = 20.1 .. 22.5, and the first silent sample is t = 22.6: closed there, padded 5 s.
    expect(c.endSec).toBeCloseTo(27.6, 1)
    expect(c.reason).toBe('sustained-loud')
  })

  it('a sample ffmpeg printed as nan closes it too (the parser keeps it as a non-finite sample, not as a missing line)', async () => {
    stderrText = series([[200, '-54.6'], [25, '-35.0'], [600, '-nan'], [200, '-54.6']])
    const found = await findHighlights('silence-nan', '/in/vod.mp4', () => undefined)
    expect(found).toHaveLength(1)
    expect(found[0]!.endSec).toBeCloseTo(27.6, 1)
  })

  it('the statistics still ignore the silence: a mostly silent file keeps the same threshold', async () => {
    // Were the silence counted, the median would be -161 and the bed (-54.6) would itself be "loud".
    stderrText = series([[200, '-54.6'], [25, '-35.0'], [3000, '-161.0'], [200, '-54.6']])
    const found = await findHighlights('silence-stats', '/in/vod.mp4', () => undefined)
    expect(found).toHaveLength(1)
    expect(found[0]!.peakDb).toBe(-35)
  })

  it('a moment that runs to the end of the file still closes at the end', async () => {
    stderrText = series([[200, '-54.6'], [30, '-35.0']])
    const found = await findHighlights('silence-eof', '/in/vod.mp4', () => undefined)
    expect(found).toHaveLength(1)
    expect(found[0]!.endSec).toBeCloseTo(Math.min(200, 23 + 5), 1)
  })
})
