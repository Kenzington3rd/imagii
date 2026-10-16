import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

/**
 * T-126 (23) - neither loudness pass computes a true peak.
 *
 * `ebur128=...:peak=true` oversamples every block 4x to find the true peak, and the parser (`parseEbur128`) reads only `t:` and `M:`:
 * the full-source scan paid about 3x its time (14.7 s against 4.8 s on a 30 minute source) for numbers it threw away, and so did the
 * per-clip hook window. `framelog=info` is the part that must stay (T-09, T-10: without it no "M:" line reaches stderr and every scan
 * finds nothing). The real `findHighlights` and `analyzeClipHook` run here against a fake child; the evidence is the argv ffmpeg is given.
 * Layer 5 ("T-126 (23)") runs the real binary on both strings and reads the series back.
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
let spawned: string[][] = []

vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    spawned.push(args)
    const child = new FakeChild()
    queueMicrotask(() => {
      child.stderr.emit('data', '[Parsed_ebur128_0 @ 0x1] t: 0.100 TARGET:-23 LUFS M: -30.0 S: -30.0\n')
      child.emit('close', 0, null)
    })
    return child
  }
}))
vi.mock('./probe', () => ({
  probeVideo: async () => ({ duration: 60, width: 640, height: 360, fps: 30, videoCodec: 'h264', audioCodec: 'aac', bitrate: 0, sizeBytes: 0 })
}))

const { findHighlights, analyzeClipHook, EBUR128_SCAN_FILTER } = await import('./highlights')

const filterOf = (args: string[]): string | undefined => args[args.indexOf('-af') + 1]

beforeEach(() => {
  spawned = []
})

describe('the loudness filter both passes run (T-126 (23))', () => {
  it('keeps framelog=info (the "M:" lines are logged at that level) and carries no true-peak option', () => {
    expect(EBUR128_SCAN_FILTER).toContain('ebur128=')
    expect(EBUR128_SCAN_FILTER).toContain('metadata=1')
    expect(EBUR128_SCAN_FILTER).toContain('framelog=info')
    expect(EBUR128_SCAN_FILTER).not.toMatch(/peak/)
  })

  it('the full-source scan runs exactly that filter', async () => {
    await findHighlights('scan-argv', '/in/vod.mp4', () => undefined)
    expect(spawned).toHaveLength(1)
    expect(filterOf(spawned[0] as string[])).toBe(EBUR128_SCAN_FILTER)
    expect((spawned[0] as string[]).join(' ')).not.toMatch(/peak=true/)
  })

  it('the per-clip hook window runs exactly that filter', async () => {
    await analyzeClipHook('/in/vod.mp4', 10, 3)
    expect(spawned).toHaveLength(1)
    expect(filterOf(spawned[0] as string[])).toBe(EBUR128_SCAN_FILTER)
    expect((spawned[0] as string[]).join(' ')).not.toMatch(/peak=true/)
  })

  it('and neither pass sends anything else through the audio chain', async () => {
    await findHighlights('scan-only', '/in/vod.mp4', () => undefined)
    await analyzeClipHook('/in/vod.mp4', 0, 1)
    for (const args of spawned) expect(args.filter((a) => a === '-af')).toHaveLength(1)
  })
})
