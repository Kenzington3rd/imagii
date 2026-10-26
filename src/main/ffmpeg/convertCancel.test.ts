import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ConvertOwner } from './convert'

// T-44: a convert the user cancelled must be distinguishable from a convert
// that crashed, and the distinction has to be made HERE — at the spawn site
// that knows why the child died — not by string-matching ffmpeg's output
// somewhere upstream. These tests drive convertToMp4 against a fake child so
// every branch of the close handler is reachable without a real encode
// (Layer 5 runs the real binary; see docs/TESTING.md).

class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* convert.ts sets utf8 on both pipes */
  }
}

class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  signals: string[] = []
  kill(signal: string): boolean {
    this.signals.push(signal)
    return true
  }
}

let lastChild: FakeChild | null = null
let lastArgs: string[] = []

vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    lastChild = new FakeChild()
    lastArgs = args
    return lastChild
  }
}))

const {
  convertToMp4,
  remuxWebm,
  cancelConverts,
  cancelAllConverts,
  recordingOwner,
  ConvertCancelledError,
  ConvertFailedError
} = await import('./convert')
// T-137 (2): a recording's owner is its take. These tests are about one take's convert; the scoping between takes is the block at the end.
const TAKE = recordingOwner('take-a')
const { EVEN_PICTURE } = await import('./filters')

/** Start a convert and hand back the promise plus its (fake) child. */
function startConvert(
  owner: ConvertOwner = TAKE
): { promise: Promise<void>; child: FakeChild } {
  const promise = convertToMp4(owner, '/tmp/in.webm', '/tmp/out.mp4', () => {})
  const child = lastChild
  if (!child) throw new Error('spawn was never called')
  return { promise, child }
}

beforeEach(() => {
  lastChild = null
  // Nothing should be in flight between tests; also proves the registry
  // empties itself.
  cancelAllConverts()
})

describe('convertToMp4 exit handling', () => {
  it('resolves on a clean exit', async () => {
    const { promise, child } = startConvert()
    child.emit('close', 0, null)
    await expect(promise).resolves.toBeUndefined()
  })

  it('rejects a non-zero exit with the code and ffmpeg stderr tail', async () => {
    const { promise, child } = startConvert()
    child.stderr.emit('data', 'Invalid data found when processing input')
    child.emit('close', 1, null)
    await expect(promise).rejects.toThrow(/convert-to-mp4 exit 1/)
    await promise.catch((err: Error) => {
      expect(err.message).toContain('Invalid data found when processing input')
      expect(err).not.toBeInstanceOf(ConvertCancelledError)
    })
  })

  it('rejects a spawn error with the underlying error', async () => {
    const { promise, child } = startConvert()
    child.emit('error', new Error('ENOENT ffmpeg missing'))
    await expect(promise).rejects.toThrow(/ENOENT ffmpeg missing/)
  })

  // T-59: the exit code and the signal are carried as FIELDS, not only
  // baked into the message. The caller that has to tell the user what
  // happened needs the fact, and parsing ffmpeg's sentence back out of a
  // string is the guessing T-44 named.
  it('carries the exit code on the rejection', async () => {
    const { promise, child } = startConvert()
    child.stderr.emit('data', 'Invalid data found when processing input')
    child.emit('close', 1, null)
    await promise.catch((err: Error) => {
      expect(err).toBeInstanceOf(ConvertFailedError)
      const failed = err as InstanceType<typeof ConvertFailedError>
      expect(failed.code).toBe(1)
      expect(failed.signal).toBeNull()
      expect(failed.stderrTail).toContain('Invalid data found when processing input')
    })
  })

  it('carries the signal when the child died without an exit code', async () => {
    const { promise, child } = startConvert()
    // A crash nobody asked for — the linux ffmpeg-static segfault on mpegts
    // input arrives exactly like this (see the Layer 5 pin).
    child.emit('close', null, 'SIGSEGV')
    await promise.catch((err: Error) => {
      expect(err).toBeInstanceOf(ConvertFailedError)
      const failed = err as InstanceType<typeof ConvertFailedError>
      expect(failed.code).toBeNull()
      expect(failed.signal).toBe('SIGSEGV')
      expect(err.message).toContain('signal SIGSEGV')
    })
    await expect(promise).rejects.not.toBeInstanceOf(ConvertCancelledError)
  })
})

describe('cancelConverts', () => {
  it('returns false when there is no in-flight conversion', () => {
    expect(cancelConverts(TAKE)).toBe(false)
  })

  it('is idempotent', () => {
    expect(cancelConverts(TAKE)).toBe(false)
    expect(cancelConverts(TAKE)).toBe(false)
  })

  it('SIGKILLs the running child and reports that there was one', () => {
    const { promise, child } = startConvert()
    expect(cancelConverts(TAKE)).toBe(true)
    expect(child.signals).toEqual(['SIGKILL'])
    child.emit('close', null, 'SIGKILL')
    return expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('makes the convert reject as CANCELLED, not as a SIGKILL crash', async () => {
    const { promise, child } = startConvert()
    child.stderr.emit('data', 'frame= 120 fps= 30 q=28.0 size= 256kB')
    cancelConverts(TAKE)
    // The kill's close event carries no exit code and a SIGKILL signal —
    // indistinguishable from a crash without the cancelled flag.
    child.emit('close', null, 'SIGKILL')
    await expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
    await promise.catch((err: Error) => {
      // None of the raw ffmpeg vocabulary that used to reach the user.
      expect(err.message).not.toContain('SIGKILL')
      expect(err.message).not.toContain('convert-to-mp4 exit')
      expect(err.message).not.toContain('frame=')
    })
  })

  it('reports cancelled even if the child errors instead of closing', async () => {
    const { promise, child } = startConvert()
    cancelConverts(TAKE)
    child.emit('error', new Error('kill EPERM'))
    await expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('clears the entry, so a second cancel finds nothing to kill', () => {
    const { promise, child } = startConvert()
    expect(cancelConverts(TAKE)).toBe(true)
    expect(cancelConverts(TAKE)).toBe(false)
    child.emit('close', null, 'SIGKILL')
    return expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('does not taint the next convert — a later failure is still a failure', async () => {
    const first = startConvert()
    cancelConverts(TAKE)
    first.child.emit('close', null, 'SIGKILL')
    await expect(first.promise).rejects.toBeInstanceOf(ConvertCancelledError)

    const second = startConvert()
    second.child.emit('close', 1, null)
    await expect(second.promise).rejects.toThrow(/convert-to-mp4 exit 1/)
    await second.promise.catch((err: Error) => {
      expect(err).not.toBeInstanceOf(ConvertCancelledError)
    })
  })
})

// T-60: the registry used to be a single slot, so the LAST convert to start
// owned it — "Discard recording" killed whatever was in there (an import
// transcode of the flv the user had just dropped, say) and whatever it
// replaced became uncancellable, surviving even before-quit. Cancellation is
// keyed on the owner now. The real-ffmpeg half of this proof is in
// tests/integration/media.spec.ts ("job-scoped convert cancellation"), which
// runs two actual encodes and cancels one.
describe('cancelConverts is scoped to the owner that asked (T-60)', () => {
  it('cancelling the recording leaves a concurrent import running', async () => {
    const recording = startConvert(TAKE)
    const importing = startConvert('import')

    expect(cancelConverts(TAKE)).toBe(true)

    expect(recording.child.signals).toEqual(['SIGKILL'])
    expect(importing.child.signals).toEqual([])
    recording.child.emit('close', null, 'SIGKILL')
    await expect(recording.promise).rejects.toBeInstanceOf(ConvertCancelledError)

    // The import's slot is intact: it finishes on its own terms.
    importing.child.emit('close', 0, null)
    await expect(importing.promise).resolves.toBeUndefined()
  })

  it('cancelling the import leaves a concurrent recording convert running', async () => {
    const recording = startConvert(TAKE)
    const importing = startConvert('import')

    expect(cancelConverts('import')).toBe(true)

    expect(importing.child.signals).toEqual(['SIGKILL'])
    expect(recording.child.signals).toEqual([])
    importing.child.emit('close', null, 'SIGKILL')
    await expect(importing.promise).rejects.toBeInstanceOf(ConvertCancelledError)

    recording.child.emit('close', 0, null)
    await expect(recording.promise).resolves.toBeUndefined()
  })

  it('finds nothing to cancel when the only convert belongs to someone else', () => {
    const importing = startConvert('import')
    expect(cancelConverts(TAKE)).toBe(false)
    expect(importing.child.signals).toEqual([])
    cancelAllConverts()
    importing.child.emit('close', null, 'SIGKILL')
    return expect(importing.promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('a second convert does not evict the first — before-quit still reaps both', async () => {
    const first = startConvert('import')
    const second = startConvert('import')

    expect(cancelAllConverts()).toBe(true)

    // The single-slot version lost `first` here: `activeConvert = second`
    // overwrote it, so nothing could ever kill it.
    expect(first.child.signals).toEqual(['SIGKILL'])
    expect(second.child.signals).toEqual(['SIGKILL'])
    first.child.emit('close', null, 'SIGKILL')
    second.child.emit('close', null, 'SIGKILL')
    await expect(first.promise).rejects.toBeInstanceOf(ConvertCancelledError)
    await expect(second.promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('cancelAllConverts takes every owner, and reports nothing when idle', async () => {
    expect(cancelAllConverts()).toBe(false)
    const recording = startConvert(TAKE)
    const importing = startConvert('import')

    expect(cancelAllConverts()).toBe(true)
    expect(recording.child.signals).toEqual(['SIGKILL'])
    expect(importing.child.signals).toEqual(['SIGKILL'])
    recording.child.emit('close', null, 'SIGKILL')
    importing.child.emit('close', null, 'SIGKILL')
    await expect(recording.promise).rejects.toBeInstanceOf(ConvertCancelledError)
    await expect(importing.promise).rejects.toBeInstanceOf(ConvertCancelledError)
    expect(cancelAllConverts()).toBe(false)
  })

  it('a convert that ends on its own leaves the other registrations alone', async () => {
    const recording = startConvert(TAKE)
    const importing = startConvert('import')

    // The finished child clears ITS entry, not the whole registry — the
    // single-slot version nulled the slot and took the survivor with it.
    recording.child.emit('close', 0, null)
    await expect(recording.promise).resolves.toBeUndefined()

    expect(cancelConverts('import')).toBe(true)
    expect(importing.child.signals).toEqual(['SIGKILL'])
    importing.child.emit('close', null, 'SIGKILL')
    await expect(importing.promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })
})

describe('convertToMp4 - the picture it asks for (T-114)', () => {
  it('opens its -vf chain with the even-size stage, ahead of the encoder', async () => {
    const { promise, child } = startConvert()
    child.emit('close', 0, null)
    await promise
    // An odd screen recording died at exit 187 here, and recording.ts unlinks the temp webm
    // when the convert fails. Layer 5 (media.spec.ts) proves the real binary accepts it.
    expect(lastArgs[lastArgs.indexOf('-vf') + 1]).toBe(EVEN_PICTURE)
    expect(lastArgs.indexOf('-vf')).toBeLessThan(lastArgs.indexOf('libx264'))
  })
})

// T-120: a MediaRecorder webm declares no frame rate (ffprobe reads its container rate as 1000/1) and the
// mp4 muxer's default is a constant rate, so the convert wrote one frame per millisecond: 9575 frames for
// a 9.6 s take, 1m56s to write, and a file that probes as 1000 fps. `-fps_mode vfr` keeps each frame at its
// own time. This pins the argument; Layer 5 (media.spec.ts) is the proof that the real binary does it, on a
// file with MediaRecorder's shape, and that sources with a steady rate are unchanged.
describe('convertToMp4 - frames keep their own times (T-120)', () => {
  it('asks for a variable frame rate, as an output option ahead of the encoder', async () => {
    const { promise, child } = startConvert()
    child.emit('close', 0, null)
    await promise
    const at = lastArgs.indexOf('-fps_mode')
    expect(at, `the convert asks for a frame-rate mode: ${lastArgs.join(' ')}`).toBeGreaterThan(lastArgs.indexOf('-i'))
    expect(lastArgs[at + 1]).toBe('vfr')
    expect(at).toBeLessThan(lastArgs.indexOf('libx264'))
    // And it is not the other way to fix a rate: no forced output rate, which would be a guess.
    expect(lastArgs).not.toContain('-r')
  })
})

// T-120: the WebM save is a packet copy through the same child registry (so Discard and the quit sweep
// reach it), and it never re-encodes.
describe('remuxWebm (T-120)', () => {
  function startRemux(owner: ConvertOwner = TAKE): {
    promise: Promise<void>
    child: FakeChild
  } {
    const promise = remuxWebm(owner, '/tmp/in.webm', '/tmp/out.webm')
    const child = lastChild
    if (!child) throw new Error('spawn was never called')
    return { promise, child }
  }

  it('copies the packets into the chosen path and encodes nothing', async () => {
    const { promise, child } = startRemux()
    child.emit('close', 0, null)
    await promise
    expect(lastArgs).toEqual(['-y', '-i', '/tmp/in.webm', '-c', 'copy', '/tmp/out.webm'])
  })

  it('is canceled by "Discard recording" like the convert: the sentinel, not a crash', async () => {
    const { promise, child } = startRemux(TAKE)
    expect(cancelConverts(TAKE)).toBe(true)
    expect(child.signals).toEqual(['SIGKILL'])
    child.emit('close', null, 'SIGKILL')
    await expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('a failed copy is a failure, not a cancel', async () => {
    const { promise, child } = startRemux()
    child.stderr.emit('data', 'Invalid data found when processing input')
    child.emit('close', 1, null)
    await expect(promise).rejects.toBeInstanceOf(ConvertFailedError)
  })

  it('is not reached by an import convert\'s owner', async () => {
    const { child } = startRemux(TAKE)
    expect(cancelConverts('import')).toBe(false)
    expect(child.signals).toEqual([])
    cancelAllConverts()
  })
})

// T-115: the recording's bar used to be `Math.min(99, encodedSeconds * 2)` under a comment saying
// "1% per second" - 50 seconds of a 5-minute take already read 99%, and the bar then sat at 99
// for minutes beside an enabled Discard button. A percent is a measurement or it is absent
// (STYLE_GUIDE, "A progress number is a measurement"): ffmpeg's `out_time` over the length of the
// take, capped at 99, and no percent at all when nobody knows the length. Layer 5 runs the real
// binary through the same path ("convert progress is the encode position over the length").
describe('convertToMp4 - progress is a measurement, or it is absent (T-115)', () => {
  /** A convert with a length (or without), a recorder of what it reported, and its fake child. */
  function startMeasured(durationSec?: number): {
    promise: Promise<void>
    child: FakeChild
    reports: Array<{ percent?: number }>
  } {
    const reports: Array<{ percent?: number }> = []
    const promise = convertToMp4(TAKE, '/tmp/in.webm', '/tmp/out.mp4', (p) => reports.push(p), durationSec)
    const child = lastChild
    if (!child) throw new Error('spawn was never called')
    return { promise, child, reports }
  }
  /** What ffmpeg's `-progress pipe:1` prints for one tick, ending with the key under test. */
  const tick = (outTime: string): string =>
    `frame=10\nfps=30.0\nout_time_us=1\nout_time=${outTime}\nspeed=2x\nprogress=continue\n`

  it('is the position in the output over the length of the take', async () => {
    const { promise, child, reports } = startMeasured(10)
    child.stdout.emit('data', tick('00:00:02.500000'))
    child.stdout.emit('data', tick('00:00:05.000000'))
    child.stdout.emit('data', tick('00:00:07.500000'))
    expect(reports.map((r) => r.percent)).toEqual([25, 50, 75])
    child.emit('close', 0, null)
    await promise
  })

  it('a 5-minute take is not at 99% after 50 seconds (the 1%-per-second guess)', async () => {
    const { promise, child, reports } = startMeasured(300)
    child.stdout.emit('data', tick('00:00:50.000000'))
    expect(reports[0]?.percent).toBeCloseTo(16.667, 2)
    expect(reports[0]?.percent ?? 100).toBeLessThan(20)
    child.emit('close', 0, null)
    await promise
  })

  it('reads hours and minutes, not only seconds', async () => {
    const { promise, child, reports } = startMeasured(7200)
    child.stdout.emit('data', tick('01:00:00.000000'))
    expect(reports[0]?.percent).toBe(50)
    child.emit('close', 0, null)
    await promise
  })

  it('tops out at 99 - the last percent is the file being finalized - and starts at 0', async () => {
    const { promise, child, reports } = startMeasured(10)
    child.stdout.emit('data', tick('00:00:00.000000'))
    child.stdout.emit('data', tick('00:00:10.000000'))
    child.stdout.emit('data', tick('00:00:14.000000'))
    expect(reports.map((r) => r.percent)).toEqual([0, 99, 99])
    child.emit('close', 0, null)
    await promise
  })

  it.each([
    ['no length', undefined],
    ['a length of 0', 0],
    ['a negative length', -3],
    ['a length that is not a number', Number.NaN],
    ['an infinite length', Number.POSITIVE_INFINITY]
  ])('with %s it reports progress WITHOUT a percent, so the bar is indeterminate', async (_label, length) => {
    const { promise, child, reports } = startMeasured(length)
    child.stdout.emit('data', tick('00:00:30.000000'))
    expect(reports).toHaveLength(1)
    expect(reports[0]).not.toHaveProperty('percent')
    child.emit('close', 0, null)
    await promise
  })

  it('ffmpeg\'s first tick, out_time=N/A, reports nothing at all', async () => {
    const { promise, child, reports } = startMeasured(10)
    child.stdout.emit('data', tick('N/A'))
    expect(reports).toEqual([])
    child.emit('close', 0, null)
    await promise
  })

  it('the importer\'s convert (no length) keeps working: it finishes and nothing breaks', async () => {
    const { promise, child } = startConvert('import')
    child.stdout.emit('data', tick('00:00:03.000000'))
    child.emit('close', 0, null)
    await expect(promise).resolves.toBeUndefined()
  })
})

// T-137 (2): a recording's owner is its TAKE. One owner for every take ("recording") meant a Discard on a second take - the first was still being
// saved, because leaving Record during a save returned an idle Record - cancelled the FIRST take's convert too, and that save, seeing a cancel that was
// not the quit's, threw its raw webm away: the only copy of a recording the person never discarded. The owner names the take; there is no owner-wide
// recording cancel (the type has none), and a take that has nothing running answers false.
describe('cancelConverts is scoped to the TAKE that asked (T-137 (2))', () => {
  const A = recordingOwner('take-a')
  const B = recordingOwner('take-b')

  it('a recording owner is the take\'s, and no two takes share one', () => {
    expect(A).not.toBe(B)
    expect(recordingOwner('take-a')).toBe(A)
    expect(A).not.toBe('import')
    expect(A).toContain('take-a')
  })

  it('cancelling the second take leaves the first take\'s convert running, and it finishes', async () => {
    const first = startConvert(A)
    const second = startConvert(B)

    expect(cancelConverts(B)).toBe(true)

    expect(second.child.signals).toEqual(['SIGKILL'])
    expect(first.child.signals, 'the first take\'s child was not signalled').toEqual([])
    second.child.emit('close', null, 'SIGKILL')
    await expect(second.promise).rejects.toBeInstanceOf(ConvertCancelledError)

    // The first take is intact: it finishes on its own terms, as a success and not as a discard.
    first.child.emit('close', 0, null)
    await expect(first.promise).resolves.toBeUndefined()
  })

  it('a take with nothing running finds nothing to cancel, and touches no other take', () => {
    const first = startConvert(A)
    const importing = startConvert('import')
    expect(cancelConverts(B)).toBe(false)
    expect(first.child.signals).toEqual([])
    expect(importing.child.signals).toEqual([])
    cancelAllConverts()
    first.child.emit('close', null, 'SIGKILL')
    importing.child.emit('close', null, 'SIGKILL')
    return Promise.all([expect(first.promise).rejects.toBeInstanceOf(ConvertCancelledError), expect(importing.promise).rejects.toBeInstanceOf(ConvertCancelledError)])
  })

  it('the quit sweep still takes every take, and says it is the quit\'s (the raw take is kept)', async () => {
    const first = startConvert(A)
    const second = startConvert(B)
    expect(cancelAllConverts()).toBe(true)
    first.child.emit('close', null, 'SIGKILL')
    second.child.emit('close', null, 'SIGKILL')
    for (const run of [first, second]) {
      const err = await run.promise.catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ConvertCancelledError)
      expect((err as InstanceType<typeof ConvertCancelledError>).byQuit).toBe(true)
    }
  })

  it('a Discard is not a quit: the cancel of one take says byQuit is false', async () => {
    const { promise, child } = startConvert(A)
    cancelConverts(A)
    child.emit('close', null, 'SIGKILL')
    const err = await promise.catch((e: unknown) => e)
    expect((err as InstanceType<typeof ConvertCancelledError>).byQuit).toBe(false)
  })
})
