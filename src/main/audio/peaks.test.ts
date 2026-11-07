import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { CANCELLED_MESSAGE, isCancelledError } from '../../shared/cancel'
import { PEAK_BUCKETS, WAVEFORM_READ_FAILED, isWaveformPeaks, type WaveformPeaksProgress } from '../../shared/audio'
import { openRunCount } from '../ffmpeg/cancelLatch'

/**
 * T-129 (T-110 (ao)): the waveform is computed in main from a STREAM of the sound, folded as it arrives into a bounded number
 * of highest/lowest pairs. The renderer used to decode the whole file (3.25 GB of renderer memory for a 1 h WAV). Here: the
 * fold itself (pure), the command line, and the job around it - its progress, its failure sentence, the per-job Cancel and the
 * quit sweep, and the latch run the quit waits for - with a fake ffmpeg and probe. Layer 5 runs the real decode on a fixture of
 * tone bursts at known times and amplitudes, and measures this process's memory while a 2-hour file goes through it.
 */
class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* text or bytes: the job sets stderr to text, stdout stays bytes */
  }
}
class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  signals: string[] = []
  kill(signal?: string): boolean {
    this.signals.push(signal ?? 'SIGTERM')
    return true
  }
}
interface Spawned {
  args: string[]
  child: FakeChild
}
let spawned: Spawned[] = []
vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    const child = new FakeChild()
    spawned.push({ args, child })
    return child
  }
}))

let probeDuration = 10
let probeGate: Promise<void> | null = null
vi.mock('./probe', () => ({
  probeAudio: async () => {
    if (probeGate) await probeGate
    return { duration: probeDuration, sampleRate: 48000, channels: 2, codec: 'pcm_s16le', bitrate: 0, format: 'wav', sizeBytes: 0 }
  }
}))

const { createPeakFolder, bucketCount, peaksArgs, readPeaks, cancelPeaksJob, cancelAllPeaks, PEAKS_SAMPLE_RATE, __peaksTesting__ } =
  await import('./peaks')

/** s16le bytes of `values` (each -1..1). */
function pcm(values: number[]): Buffer {
  const b = Buffer.alloc(values.length * 2)
  values.forEach((v, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32768))), i * 2))
  return b
}
const settle = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    (value) => ({ resolved: value }),
    (err: unknown) => err
  )

beforeEach(() => {
  spawned = []
  probeDuration = 10
  probeGate = null
  cancelAllPeaks()
})

describe('the fold (T-129): a stream of samples becomes a bounded array of highest/lowest pairs', () => {
  it('a sample lands in the bucket of its position: floor(sample / expected * buckets)', () => {
    const folder = createPeakFolder(4, 8)
    folder.push(pcm([0.5, -0.25, 0, 0, 0.75, 0, -1, 0.125]))
    expect(folder.samples).toBe(8)
    expect(folder.peaks()).toEqual([
      [0.5, 0, 0.75, 0.125],
      [-0.25, 0, 0, -1]
    ])
  })

  it('a chunk that ends in the middle of a sample keeps the odd byte for the next one: the same peaks however the bytes are cut', () => {
    const bytes = pcm([0.1, -0.9, 0.3, 0.6, -0.2, 0.05, 0.7, -0.4, 0.2])
    const whole = createPeakFolder(3, 9)
    whole.push(bytes)
    for (const cut of [1, 3, 5, 7, 11, 17]) {
      const split = createPeakFolder(3, 9)
      split.push(bytes.subarray(0, cut))
      split.push(bytes.subarray(cut))
      expect(split.peaks(), `cut at byte ${cut}`).toEqual(whole.peaks())
      expect(split.samples).toBe(9)
    }
    // One byte at a time, the worst case a pipe can deliver.
    const dribble = createPeakFolder(3, 9)
    for (let i = 0; i < bytes.length; i++) dribble.push(bytes.subarray(i, i + 1))
    expect(dribble.peaks()).toEqual(whole.peaks())
  })

  it('a negative sample split across two chunks is read as negative (the high byte carries the sign)', () => {
    const bytes = pcm([-0.5])
    const folder = createPeakFolder(1, 1)
    folder.push(bytes.subarray(0, 1))
    folder.push(bytes.subarray(1))
    expect(folder.peaks()).toEqual([[0], [-0.5]])
  })

  it('a decode longer than the probed length lands its extra samples in the LAST bucket; a shorter one leaves its tail at 0', () => {
    const long = createPeakFolder(2, 4)
    long.push(pcm([0, 0, 0.1, 0.1, 0.9, -0.8]))
    expect(long.peaks()).toEqual([
      [0, 0.9],
      [0, -0.8]
    ])
    const short = createPeakFolder(4, 8)
    short.push(pcm([0.4, -0.4]))
    expect(short.peaks()).toEqual([
      [0.4, 0, 0, 0],
      [-0.4, 0, 0, 0]
    ])
  })

  it('holds the same two arrays however much sound goes through it (nothing of the stream is kept)', () => {
    const folder = createPeakFolder(PEAK_BUCKETS, 10 * PEAKS_SAMPLE_RATE * 60)
    const second = pcm(Array.from({ length: PEAKS_SAMPLE_RATE }, (_, i) => Math.sin(i / 7) * 0.5))
    for (let s = 0; s < 600; s++) folder.push(second)
    const [high, low] = folder.peaks()
    expect(high).toHaveLength(PEAK_BUCKETS)
    expect(low).toHaveLength(PEAK_BUCKETS)
    expect(Math.max(...high)).toBeLessThanOrEqual(0.5)
    expect(Math.min(...low)).toBeGreaterThanOrEqual(-0.5)
  })

  it('rounds to 4 decimals (the payload is a picture, not the sound)', () => {
    const folder = createPeakFolder(1, 1)
    const b = Buffer.alloc(2)
    b.writeInt16LE(4049, 0) // 4049 / 32768 = 0.123565...
    folder.push(b)
    expect(folder.peaks()[0][0]).toBe(0.1236)
  })

  it('bucketCount: PEAK_BUCKETS for anything a person opens, one per sample for a file shorter than that', () => {
    expect(PEAK_BUCKETS).toBe(4000)
    expect(bucketCount(7500)).toBe(PEAK_BUCKETS)
    expect(bucketCount(0.5)).toBe(PEAK_BUCKETS)
    expect(bucketCount(0.25)).toBe(2000)
    expect(bucketCount(0.0001)).toBe(1)
    expect(() => bucketCount(0)).toThrow()
  })
})

describe('the command line (T-129)', () => {
  it('decodes the first sound stream, mono, at the peaks rate, as raw 16-bit PCM on stdout - never to a file', () => {
    const args = peaksArgs('/v/long take.wav')
    const at = (flag: string): string | undefined => args[args.indexOf(flag) + 1]
    expect(at('-i')).toBe('/v/long take.wav')
    expect(at('-map')).toBe('0:a:0')
    expect(at('-ac')).toBe('1')
    expect(at('-ar')).toBe(String(PEAKS_SAMPLE_RATE))
    expect(at('-f')).toBe('s16le')
    expect(at('-acodec')).toBe('pcm_s16le')
    expect(args[args.length - 1]).toBe('pipe:1')
    expect(args.indexOf('-ac'), 'output options come after the input').toBeGreaterThan(args.indexOf('-i'))
  })
})

describe('the peaks job (T-129): progress, failure, Cancel, quit', () => {
  it('answers peaks the renderer accepts, reports progress as it reads, and ends at 100', async () => {
    probeDuration = 1
    const progress: WaveformPeaksProgress[] = []
    const done = readPeaks('/a.wav', 'job-1', (p) => progress.push(p))
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    const child = (spawned[0] as Spawned).child
    const quarter = pcm(Array.from({ length: PEAKS_SAMPLE_RATE / 4 }, () => 0.5))
    for (let i = 0; i < 4; i++) child.stdout.emit('data', quarter)
    child.emit('close', 0, null)
    const result = await done
    expect(isWaveformPeaks(result)).toBe(true)
    expect(result.duration).toBe(1)
    expect(result.peaks[0]).toHaveLength(PEAK_BUCKETS)
    const percents = progress.map((p) => p.percent)
    expect(progress.every((p) => p.jobId === 'job-1')).toBe(true)
    expect(percents).toEqual([25, 50, 75, 99, 100])
    expect([...percents].sort((a, b) => a - b), 'never backwards').toEqual(percents)
  })

  it('a decode ffmpeg cannot finish is the finished sentence, not ffmpeg\'s words (they go to the console)', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const done = settle(readPeaks('/bad.wav', 'job-bad', () => undefined))
      await vi.waitFor(() => expect(spawned).toHaveLength(1))
      const child = (spawned[0] as Spawned).child
      child.stderr.emit('data', 'Decoder (codec none) not found for input stream #0:0')
      child.emit('close', 1, null)
      const err = (await done) as Error
      expect(err.message).toBe(WAVEFORM_READ_FAILED)
      expect(isCancelledError(err)).toBe(false)
      expect(String(quiet.mock.calls[0]?.[0])).toMatch(/Decoder \(codec none\) not found/)
      expect(__peaksTesting__.activeCount()).toBe(0)
    } finally {
      quiet.mockRestore()
    }
  })

  it('the per-job Cancel kills ITS ffmpeg (SIGKILL, marked first) and the job answers the cancel sentinel; a sibling runs on', async () => {
    const a = settle(readPeaks('/a.wav', 'job-a', () => undefined))
    const b = readPeaks('/b.wav', 'job-b', () => undefined)
    await vi.waitFor(() => expect(spawned).toHaveLength(2))
    const childOf = (file: string): FakeChild => (spawned.find((s) => s.args.includes(file)) as Spawned).child
    expect(cancelPeaksJob('job-a')).toBe(true)
    expect(childOf('/a.wav').signals).toEqual(['SIGKILL'])
    expect(childOf('/b.wav').signals).toEqual([])
    childOf('/a.wav').emit('close', null, 'SIGKILL')
    const outcome = (await a) as Error
    expect(isCancelledError(outcome)).toBe(true)
    expect(outcome.message).toBe(CANCELLED_MESSAGE)
    childOf('/b.wav').stdout.emit('data', pcm([0.25]))
    childOf('/b.wav').emit('close', 0, null)
    expect((await b).peaks[0][0]).toBe(0.25)
    expect(__peaksTesting__.activeCount()).toBe(0)
  })

  it('a Cancel that lands while the probe runs ends the wait at once, and no ffmpeg is ever started (the latch, T-98)', async () => {
    let release: () => void = () => undefined
    probeGate = new Promise<void>((resolve) => (release = resolve))
    const done = settle(readPeaks('/a.wav', 'job-early', () => undefined))
    await new Promise((r) => setTimeout(r, 10))
    expect(cancelPeaksJob('job-early'), 'the run is marked though there is no child yet').toBe(true)
    // The probe is still held (a file on a slow share): the job has answered anyway.
    expect(isCancelledError(await done)).toBe(true)
    release()
    await new Promise((r) => setTimeout(r, 10))
    expect(spawned, 'no ffmpeg was started for a job the person stopped').toHaveLength(0)
  })

  it('a Cancel aimed at no running job finds nothing, and cannot reach the next job', async () => {
    expect(cancelPeaksJob('nobody')).toBe(false)
    const done = readPeaks('/a.wav', 'nobody', () => undefined)
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    ;(spawned[0] as Spawned).child.emit('close', 0, null)
    await expect(done).resolves.toMatchObject({ duration: probeDuration })
  })

  it('the quit sweep (cancelAllPeaks, and cancelAllAudioJobs which calls it) kills every peaks ffmpeg', async () => {
    const a = settle(readPeaks('/a.wav', 'job-a', () => undefined))
    const b = settle(readPeaks('/b.wav', 'job-b', () => undefined))
    await vi.waitFor(() => expect(spawned).toHaveLength(2))
    const { cancelAllAudioJobs } = await import('./process')
    cancelAllAudioJobs()
    expect(spawned.map((s) => s.child.signals)).toEqual([['SIGKILL'], ['SIGKILL']])
    expect(__peaksTesting__.activeCount()).toBe(0)
    for (const s of spawned) s.child.emit('close', null, 'SIGKILL')
    for (const outcome of [await a, await b]) expect(isCancelledError(outcome)).toBe(true)
  })

  it('the Cancel the renderer sends (`audio:cancel` -> cancelAudioJob) reaches a peaks job by its id', async () => {
    const done = settle(readPeaks('/a.wav', 'job-ipc', () => undefined))
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    const { cancelAudioJob } = await import('./process')
    expect(cancelAudioJob('job-ipc')).toBe(true)
    expect((spawned[0] as Spawned).child.signals).toEqual(['SIGKILL'])
    ;(spawned[0] as Spawned).child.emit('close', null, 'SIGKILL')
    expect(isCancelledError(await done)).toBe(true)
  })

  it('holds a latch run open until its ffmpeg has closed, so the quit drain waits for it (T-127 (3))', async () => {
    const before = openRunCount()
    const done = settle(readPeaks('/a.wav', 'job-run', () => undefined))
    await vi.waitFor(() => expect(spawned).toHaveLength(1))
    expect(openRunCount()).toBe(before + 1)
    cancelAllPeaks()
    expect(openRunCount(), 'killed, not yet closed: the run is still open').toBe(before + 1)
    ;(spawned[0] as Spawned).child.emit('close', null, 'SIGKILL')
    await done
    expect(openRunCount()).toBe(before)
  })
})
