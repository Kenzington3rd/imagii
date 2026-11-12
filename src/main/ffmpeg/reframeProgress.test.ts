import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ReframeProgress } from './reframe'

/**
 * T-108 (a) — Reframe's progress is only ever a measurement.
 *
 * The round-54 rule (T-89): a progress event carries `percent` only when main KNOWS
 * how far along the work is; a phase of unknown length sends the phase and no number,
 * and the panel draws an indeterminate bar. Reframe's first event, `analyzing` (checking
 * the source with ffprobe), sent `percent: 0` — a number that measured nothing, shown as
 * "0%" for as long as the probe took (seconds, for a file on a slow share).
 *
 * Only the child is faked (captionsProgress.test.ts's technique): the real runner runs.
 */

class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runner sets utf8 on both pipes */
  }
}

class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  kill(): boolean {
    return true
  }
}

let scratch = ''
let onSpawn: (child: FakeChild) => void = () => undefined

vi.mock('node:child_process', () => ({
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    // T-140 (1): ffmpeg writes its output (a partial beside the name the runner chose) before it exits; the runner swaps it in when the run is whole.
    queueMicrotask(() => {
      writeFileSync(args[args.length - 1] as string, 'mp4')
      onSpawn(child)
    })
    return child
  }
}))
vi.mock('./probe', () => ({
  probeVideo: async () => ({
    duration: 60,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: 'h264',
    audioCodec: 'aac',
    bitrate: 0,
    sizeBytes: 0
  })
}))

const { runReframe } = await import('./reframe')

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-t108-reframe-'))
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('runReframe — progress without invented numbers (T-108)', () => {
  it('checking the source sends no percent; rendering sends its position; done is 100', async () => {
    onSpawn = (child) => {
      // Encoded time over a 10 s range: 2 s, 5 s, then the end.
      child.stdout.emit('data', 'out_time=00:00:02.000000\n')
      child.stdout.emit('data', 'out_time=00:00:05.000000\n')
      child.stdout.emit('data', 'out_time=00:00:10.000000\n')
      child.emit('close', 0)
    }
    const events: ReframeProgress[] = []
    await runReframe(
      {
        jobId: 'r1',
        sourcePath: '/tmp/in.mp4',
        outputPath: path.join(scratch, 'out.mp4'),
        position: 'center',
        startSec: 0,
        endSec: 10,
        outputWidth: 1080,
        outputHeight: 1920
      },
      (p) => events.push(p)
    )

    const phases = events.map((e) => e.phase)
    expect(phases[0]).toBe('analyzing')
    expect(phases).toContain('rendering')
    expect(phases[phases.length - 1]).toBe('done')

    // The claim: the phase of unknown length carries no number at all...
    const analyzing = events.filter((e) => e.phase === 'analyzing')
    expect(analyzing).toHaveLength(1)
    expect('percent' in (analyzing[0] as object), 'analyzing carries no percent key').toBe(false)
    // ...and the phases that measure something still do, truthfully.
    const rendering = events.filter((e) => e.phase === 'rendering')
    expect(rendering.every((e) => typeof e.percent === 'number')).toBe(true)
    expect(rendering.map((e) => e.percent)).toEqual([0, 20, 50, 100])
    expect(events[events.length - 1]?.percent).toBe(100)
  })
})

/**
 * T-111 — the preload bridge forwards `video:reframeProgress` straight to the
 * renderer, and its listener was annotated `percent: number` while main sends no
 * `percent` at all for a phase of unknown length (the test above) and
 * `ImagiiApi.video.onReframeProgress` (shared/api.ts) says `percent?: number`. The
 * annotation is not a type error (a narrower value fits a wider parameter), it is
 * a lie in the one place a reader checks what the bridge delivers. The preload
 * imports `electron`, which a unit test cannot load, so the source is what is read.
 */
describe('the preload bridge types the reframe progress the way main sends it (T-111)', () => {
  const preload = readFileSync(path.join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8')
  const listener = preload.slice(
    preload.indexOf('onReframeProgress'),
    preload.indexOf("ipcRenderer.on('video:reframeProgress'")
  )

  it('says percent may be absent', () => {
    expect(listener).toMatch(/phase: ReframePhase; percent\?: number/)
  })

  it('the shared API type says the same', () => {
    const api = readFileSync(path.join(process.cwd(), 'src', 'shared', 'api.ts'), 'utf8')
    expect(api).toMatch(/onReframeProgress\(\s*handler: \(p: \{ jobId: string; phase: ReframePhase; percent\?: number \}\) => void/)
  })
})
