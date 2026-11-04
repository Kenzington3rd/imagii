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

// T-154 (8): the convert asks ffprobe for the input's first size before it starts the encode. The probe is its own child: it answers by
// itself here (a 1280x720 stream, or nothing/a failure when a test sets `probeAnswer`), or is held for a test that cancels in the middle of it.
// `lastChild` and `lastArgs` stay the ENCODE's, so every test below reads them as before.
let probeAnswer: 'size' | 'fails' | 'held' = 'size'
let probeChild: FakeChild | null = null
let probeArgs: string[] = []
const PROBED = '{"streams":[{"width":1280,"height":720,"sample_aspect_ratio":"1:1"}]}'

vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    const child = new FakeChild()
    if (args.includes('-show_entries')) {
      probeChild = child
      probeArgs = args
      if (probeAnswer !== 'held') {
        queueMicrotask(() => {
          if (probeAnswer === 'size') child.stdout.emit('data', PROBED)
          child.emit('close', probeAnswer === 'size' ? 0 : 1, null)
        })
      }
      return child
    }
    lastChild = child
    lastArgs = args
    return child
  }
}))

const {
  beginConvertRun,
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
const { convertFilter, heldSizeOf } = await import('./convert')

/** Wait for the encode's child: the probe is answered and the encode is spawned a few ticks after the call. */
async function encodeChild(): Promise<FakeChild> {
  for (let i = 0; i < 100 && !lastChild; i++) await new Promise((resolve) => setImmediate(resolve))
  if (!lastChild) throw new Error('spawn was never called')
  return lastChild
}

/** Start a convert and hand back the promise plus its (fake) child. */
async function startConvert(
  owner: ConvertOwner = TAKE
): Promise<{ promise: Promise<void>; child: FakeChild }> {
  lastChild = null
  const promise = convertToMp4(owner, '/tmp/in.webm', '/tmp/out.mp4', () => {})
  return { promise, child: await encodeChild() }
}

beforeEach(() => {
  lastChild = null
  probeChild = null
  probeAnswer = 'size'
  // Nothing should be in flight between tests; also proves the registry
  // empties itself.
  cancelAllConverts()
})

describe('convertToMp4 exit handling', () => {
  it('resolves on a clean exit', async () => {
    const { promise, child } = await startConvert()
    child.emit('close', 0, null)
    await expect(promise).resolves.toBeUndefined()
  })

  it('rejects a non-zero exit with the code and ffmpeg stderr tail', async () => {
    const { promise, child } = await startConvert()
    child.stderr.emit('data', 'Invalid data found when processing input')
    child.emit('close', 1, null)
    await expect(promise).rejects.toThrow(/convert-to-mp4 exit 1/)
    await promise.catch((err: Error) => {
      expect(err.message).toContain('Invalid data found when processing input')
      expect(err).not.toBeInstanceOf(ConvertCancelledError)
    })
  })

  it('rejects a spawn error with the underlying error', async () => {
    const { promise, child } = await startConvert()
    child.emit('error', new Error('ENOENT ffmpeg missing'))
    await expect(promise).rejects.toThrow(/ENOENT ffmpeg missing/)
  })

  // T-59: the exit code and the signal are carried as FIELDS, not only
  // baked into the message. The caller that has to tell the user what
  // happened needs the fact, and parsing ffmpeg's sentence back out of a
  // string is the guessing T-44 named.
  it('carries the exit code on the rejection', async () => {
    const { promise, child } = await startConvert()
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
    const { promise, child } = await startConvert()
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

  it('SIGKILLs the running child and reports that there was one', async () => {
    const { promise, child } = await startConvert()
    expect(cancelConverts(TAKE)).toBe(true)
    expect(child.signals).toEqual(['SIGKILL'])
    child.emit('close', null, 'SIGKILL')
    return expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('makes the convert reject as CANCELLED, not as a SIGKILL crash', async () => {
    const { promise, child } = await startConvert()
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
    const { promise, child } = await startConvert()
    cancelConverts(TAKE)
    child.emit('error', new Error('kill EPERM'))
    await expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('clears the entry, so a second cancel finds nothing to kill', async () => {
    const { promise, child } = await startConvert()
    expect(cancelConverts(TAKE)).toBe(true)
    expect(cancelConverts(TAKE)).toBe(false)
    child.emit('close', null, 'SIGKILL')
    return expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('does not taint the next convert — a later failure is still a failure', async () => {
    const first = await startConvert()
    cancelConverts(TAKE)
    first.child.emit('close', null, 'SIGKILL')
    await expect(first.promise).rejects.toBeInstanceOf(ConvertCancelledError)

    const second = await startConvert()
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
    const recording = await startConvert(TAKE)
    const importing = await startConvert('import')

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
    const recording = await startConvert(TAKE)
    const importing = await startConvert('import')

    expect(cancelConverts('import')).toBe(true)

    expect(importing.child.signals).toEqual(['SIGKILL'])
    expect(recording.child.signals).toEqual([])
    importing.child.emit('close', null, 'SIGKILL')
    await expect(importing.promise).rejects.toBeInstanceOf(ConvertCancelledError)

    recording.child.emit('close', 0, null)
    await expect(recording.promise).resolves.toBeUndefined()
  })

  it('finds nothing to cancel when the only convert belongs to someone else', async () => {
    const importing = await startConvert('import')
    expect(cancelConverts(TAKE)).toBe(false)
    expect(importing.child.signals).toEqual([])
    cancelAllConverts()
    importing.child.emit('close', null, 'SIGKILL')
    return expect(importing.promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('a second convert does not evict the first — before-quit still reaps both', async () => {
    const first = await startConvert('import')
    const second = await startConvert('import')

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
    const recording = await startConvert(TAKE)
    const importing = await startConvert('import')

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
    const recording = await startConvert(TAKE)
    const importing = await startConvert('import')

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
    const { promise, child } = await startConvert()
    child.emit('close', 0, null)
    await promise
    // An odd screen recording died at exit 187 here, and recording.ts unlinks the temp webm
    // when the convert fails. Layer 5 (media.spec.ts) proves the real binary accepts it.
    // T-154 (8): the even crop still comes first; the fit to the first size follows it (the block at the end of this file).
    expect(lastArgs[lastArgs.indexOf('-vf') + 1]?.startsWith(`${EVEN_PICTURE},`)).toBe(true)
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
    const { promise, child } = await startConvert()
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
  async function startMeasured(durationSec?: number): Promise<{
    promise: Promise<void>
    child: FakeChild
    reports: Array<{ percent?: number }>
  }> {
    const reports: Array<{ percent?: number }> = []
    lastChild = null
    const promise = convertToMp4(TAKE, '/tmp/in.webm', '/tmp/out.mp4', (p) => reports.push(p), durationSec)
    return { promise, child: await encodeChild(), reports }
  }
  /** What ffmpeg's `-progress pipe:1` prints for one tick, ending with the key under test. */
  const tick = (outTime: string): string =>
    `frame=10\nfps=30.0\nout_time_us=1\nout_time=${outTime}\nspeed=2x\nprogress=continue\n`

  it('is the position in the output over the length of the take', async () => {
    const { promise, child, reports } = await startMeasured(10)
    child.stdout.emit('data', tick('00:00:02.500000'))
    child.stdout.emit('data', tick('00:00:05.000000'))
    child.stdout.emit('data', tick('00:00:07.500000'))
    expect(reports.map((r) => r.percent)).toEqual([25, 50, 75])
    child.emit('close', 0, null)
    await promise
  })

  it('a 5-minute take is not at 99% after 50 seconds (the 1%-per-second guess)', async () => {
    const { promise, child, reports } = await startMeasured(300)
    child.stdout.emit('data', tick('00:00:50.000000'))
    expect(reports[0]?.percent).toBeCloseTo(16.667, 2)
    expect(reports[0]?.percent ?? 100).toBeLessThan(20)
    child.emit('close', 0, null)
    await promise
  })

  it('reads hours and minutes, not only seconds', async () => {
    const { promise, child, reports } = await startMeasured(7200)
    child.stdout.emit('data', tick('01:00:00.000000'))
    expect(reports[0]?.percent).toBe(50)
    child.emit('close', 0, null)
    await promise
  })

  it('tops out at 99 - the last percent is the file being finalized - and starts at 0', async () => {
    const { promise, child, reports } = await startMeasured(10)
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
    const { promise, child, reports } = await startMeasured(length)
    child.stdout.emit('data', tick('00:00:30.000000'))
    expect(reports).toHaveLength(1)
    expect(reports[0]).not.toHaveProperty('percent')
    child.emit('close', 0, null)
    await promise
  })

  it('ffmpeg\'s first tick, out_time=N/A, reports nothing at all', async () => {
    const { promise, child, reports } = await startMeasured(10)
    child.stdout.emit('data', tick('N/A'))
    expect(reports).toEqual([])
    child.emit('close', 0, null)
    await promise
  })

  it('the importer\'s convert (no length) keeps working: it finishes and nothing breaks', async () => {
    const { promise, child } = await startConvert('import')
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
    const first = await startConvert(A)
    const second = await startConvert(B)

    expect(cancelConverts(B)).toBe(true)

    expect(second.child.signals).toEqual(['SIGKILL'])
    expect(first.child.signals, 'the first take\'s child was not signalled').toEqual([])
    second.child.emit('close', null, 'SIGKILL')
    await expect(second.promise).rejects.toBeInstanceOf(ConvertCancelledError)

    // The first take is intact: it finishes on its own terms, as a success and not as a discard.
    first.child.emit('close', 0, null)
    await expect(first.promise).resolves.toBeUndefined()
  })

  it('a take with nothing running finds nothing to cancel, and touches no other take', async () => {
    const first = await startConvert(A)
    const importing = await startConvert('import')
    expect(cancelConverts(B)).toBe(false)
    expect(first.child.signals).toEqual([])
    expect(importing.child.signals).toEqual([])
    cancelAllConverts()
    first.child.emit('close', null, 'SIGKILL')
    importing.child.emit('close', null, 'SIGKILL')
    return Promise.all([expect(first.promise).rejects.toBeInstanceOf(ConvertCancelledError), expect(importing.promise).rejects.toBeInstanceOf(ConvertCancelledError)])
  })

  it('the quit sweep still takes every take, and says it is the quit\'s (the raw take is kept)', async () => {
    const first = await startConvert(A)
    const second = await startConvert(B)
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
    const { promise, child } = await startConvert(A)
    cancelConverts(A)
    child.emit('close', null, 'SIGKILL')
    const err = await promise.catch((e: unknown) => e)
    expect((err as InstanceType<typeof ConvertCancelledError>).byQuit).toBe(false)
  })
})

// T-141 (5): a save is a RUN (`beginConvertRun`) from the chosen name until the temp take is dealt with, and the swap asks the run, not the child, whether a cancel
// landed (T-140 (1)). A cancel that lands AFTER the child exited therefore has no child to reject with `ConvertCancelledError(byQuit)`, and the run threw a plain
// `CancelledError` that did not say who asked: the save kept the raw take for a Discard (the person threw it away, and the toast said so) as for a quit. The
// convert's latch is told what to throw, and a name (a Discard) and the sweep (the quit) are told apart where they are made.
describe('a cancel that lands on a save\'s run says who asked (T-141 (5))', () => {
  const thrownBy = (run: { check: () => void }): unknown => {
    try {
      run.check()
    } catch (err) {
      return err
    }
    return null
  }

  it('a Discard aimed at the take is a ConvertCancelledError that is not the quit\'s - with no child running at all', () => {
    const run = beginConvertRun(TAKE)
    expect(cancelConverts(TAKE), 'nothing was running to kill: the child had exited').toBe(false)
    const err = thrownBy(run)
    expect(err).toBeInstanceOf(ConvertCancelledError)
    expect((err as InstanceType<typeof ConvertCancelledError>).byQuit).toBe(false)
    run.end()
  })

  it('the quit sweep is a ConvertCancelledError that IS the quit\'s, also with no child running', () => {
    const run = beginConvertRun(TAKE)
    cancelAllConverts()
    const err = thrownBy(run)
    expect(err).toBeInstanceOf(ConvertCancelledError)
    expect((err as InstanceType<typeof ConvertCancelledError>).byQuit).toBe(true)
    run.end()
  })

  it.each([
    ['a Discard, then the quit', (): void => { cancelConverts(TAKE); cancelAllConverts() }],
    ['the quit, then a Discard', (): void => { cancelAllConverts(); cancelConverts(TAKE) }]
  ])('both land on one run (%s): the person\'s Discard wins, in either order', (_label, land) => {
    const run = beginConvertRun(TAKE)
    land()
    expect((thrownBy(run) as InstanceType<typeof ConvertCancelledError>).byQuit, 'the person asked for the take to go').toBe(false)
    run.end()
  })

  it('a Discard aimed at ANOTHER take does not touch this take\'s run', () => {
    const run = beginConvertRun(TAKE)
    cancelConverts(recordingOwner('take-b'))
    expect(thrownBy(run), 'not cancelled').toBeNull()
    run.end()
  })

  it('a run begun after a cancel starts clean: a stale Discard or quit never reaches the next save', () => {
    cancelConverts(TAKE)
    cancelAllConverts()
    const run = beginConvertRun(TAKE)
    expect(thrownBy(run)).toBeNull()
    run.end()
  })

  it('the child path is unchanged: a live convert killed by a Discard rejects as the Discard, and by the quit as the quit', async () => {
    const discarded = await startConvert()
    cancelConverts(TAKE)
    discarded.child.emit('close', null, 'SIGKILL')
    const first = await discarded.promise.catch((e: unknown) => e)
    expect(first).toBeInstanceOf(ConvertCancelledError)
    expect((first as InstanceType<typeof ConvertCancelledError>).byQuit).toBe(false)

    const quit = await startConvert()
    cancelAllConverts()
    quit.child.emit('close', null, 'SIGKILL')
    const second = await quit.promise.catch((e: unknown) => e)
    expect((second as InstanceType<typeof ConvertCancelledError>).byQuit).toBe(true)
  })
})

// T-142: the same rule on a LIVE child. The latch's `mark()` (above) already said "the name wins in either order" for a cancel that lands after the child
// exited; `cancelWhere` stamped `byQuit` on every cancel and dropped the entry, so a Discard that landed after the quit's sweep found nothing to correct and the
// convert rejected as the quit's: the take the person threw away was kept. The entry now stays until the child closes, and `byQuit` stays true only when every
// cancel was the sweep's.
describe('both cancels land on one live convert: the person\'s Discard wins, in either order (T-142)', () => {
  const byQuitOf = async (promise: Promise<void>): Promise<boolean> => {
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConvertCancelledError)
    return (err as InstanceType<typeof ConvertCancelledError>).byQuit
  }

  it('the quit, then a Discard: not the quit\'s (the take is thrown away)', async () => {
    const { promise, child } = await startConvert()
    expect(cancelAllConverts(), 'the sweep killed the child').toBe(true)
    expect(cancelConverts(TAKE), 'the child is already on its way out: nothing new to kill').toBe(false)
    expect(child.signals, 'killed once').toEqual(['SIGKILL'])
    child.emit('close', null, 'SIGKILL')
    expect(await byQuitOf(promise)).toBe(false)
  })

  it('a Discard, then the quit: not the quit\'s', async () => {
    const { promise, child } = await startConvert()
    expect(cancelConverts(TAKE)).toBe(true)
    expect(cancelAllConverts(), 'nothing new to kill').toBe(false)
    expect(child.signals).toEqual(['SIGKILL'])
    child.emit('close', null, 'SIGKILL')
    expect(await byQuitOf(promise)).toBe(false)
  })

  it('the quit alone, and the sweep twice: the quit\'s', async () => {
    const { promise, child } = await startConvert()
    cancelAllConverts()
    cancelAllConverts()
    child.emit('close', null, 'SIGKILL')
    expect(await byQuitOf(promise)).toBe(true)
  })

  it('a Discard alone: not the quit\'s', async () => {
    const { promise, child } = await startConvert()
    cancelConverts(TAKE)
    child.emit('close', null, 'SIGKILL')
    expect(await byQuitOf(promise)).toBe(false)
  })

  it('the rule holds through the child\'s error event too, and a Discard aimed at ANOTHER take does not take the quit back', async () => {
    const a = await startConvert(TAKE)
    cancelAllConverts()
    cancelConverts(recordingOwner('take-b'))
    a.child.emit('error', new Error('kill EPERM'))
    expect(await byQuitOf(a.promise), 'another take\'s Discard is none of this take\'s business').toBe(true)

    const b = await startConvert(TAKE)
    cancelAllConverts()
    cancelConverts(TAKE)
    b.child.emit('error', new Error('kill EPERM'))
    expect(await byQuitOf(b.promise)).toBe(false)
  })

  it('the entry is gone once the child has closed: a later cancel finds nothing, and the next convert starts clean', async () => {
    const first = await startConvert()
    cancelAllConverts()
    first.child.emit('close', null, 'SIGKILL')
    await byQuitOf(first.promise)
    expect(cancelConverts(TAKE)).toBe(false)
    const second = await startConvert()
    cancelConverts(TAKE)
    second.child.emit('close', null, 'SIGKILL')
    expect(await byQuitOf(second.promise)).toBe(false)
  })
})

// T-154 (8): a screen take whose window is resized mid-take was STRETCHED in the mp4 - ffmpeg re-initialises its graph at the change and scales every later
// frame to the first size, aspect ignored. The convert now asks ffprobe for the input's first size and fits every frame inside it, centred on black. These pin
// the argument and the probe's edges; Layer 5 (media.spec.ts, "a recording that changes size keeps its shape") is the proof that the real binary does it.
describe('convertToMp4 - every frame is held to the take\'s first size (T-154 (8))', () => {
  const vf = (): string => lastArgs[lastArgs.indexOf('-vf') + 1] as string

  async function convertOnce(): Promise<void> {
    const { promise, child } = await startConvert()
    child.emit('close', 0, null)
    await promise
  }

  it('fits each frame inside the probed size, aspect kept and centred on black, at a square pixel', async () => {
    await convertOnce()
    expect(vf()).toBe(
      `${EVEN_PICTURE},scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
        'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1'
    )
  })

  it('asks for the first video stream\'s size, its rotation and its pixel aspect, of the input file', async () => {
    await convertOnce()
    expect(probeArgs.at(-1)).toBe('/tmp/in.webm')
    expect(probeArgs).toContain('-select_streams')
    expect(probeArgs[probeArgs.indexOf('-select_streams') + 1]).toBe('v')
    const entries = probeArgs[probeArgs.indexOf('-show_entries') + 1]
    expect(entries).toContain('width,height,sample_aspect_ratio')
    expect(entries).toContain('stream_side_data_list')
  })

  it('an odd probed size is held at the even size below it', () => {
    expect(heldSizeOf({ streams: [{ width: 1281, height: 721 }] })).toEqual({ width: 1280, height: 720 })
    expect(convertFilter({ width: 1280, height: 720 })).toContain('pad=1280:720:')
  })

  it('a probe that fails keeps the plain even crop: a convert must not newly fail', async () => {
    probeAnswer = 'fails'
    await convertOnce()
    expect(vf()).toBe(EVEN_PICTURE)
  })

  it.each([
    ['no answer at all', null],
    ['no streams', { streams: [] }],
    ['a stream with no size', { streams: [{ codec_type: 'video' }] }],
    ['a size below two pixels', { streams: [{ width: 1, height: 720 }] }],
    ['a size that is not a number', { streams: [{ width: 'wide', height: 720 }] }]
  ])('a probe that answers %s holds no size: the plain even crop', (_label, answer) => {
    expect(heldSizeOf(answer)).toBeNull()
  })

  it('a probe whose output is not JSON keeps the plain even crop', async () => {
    probeAnswer = 'held'
    lastChild = null
    const promise = convertToMp4(TAKE, '/tmp/in.webm', '/tmp/out.mp4', () => {})
    probeChild?.stdout.emit('data', 'garbage')
    probeChild?.emit('close', 0, null)
    const child = await encodeChild()
    child.emit('close', 0, null)
    await promise
    expect(vf()).toBe(EVEN_PICTURE)
  })

  it.each([
    ['a rotated stream (the display matrix)', { width: 640, height: 360, side_data_list: [{ rotation: 90 }] }],
    ['a rotated stream (the rotate tag)', { width: 640, height: 360, tags: { rotate: '270' } }],
    ['an anamorphic stream', { width: 720, height: 576, sample_aspect_ratio: '16:15' }]
  ])('%s keeps the plain even crop: the fit would change a constant-size file', (_label, stream) => {
    expect(heldSizeOf({ streams: [stream] })).toBeNull()
  })

  it('two video streams (a cover picture beside the video) keep the plain even crop: ffmpeg picks the biggest, not the first', () => {
    expect(heldSizeOf({ streams: [{ width: 1280, height: 720 }, { width: 600, height: 600 }] })).toBeNull()
  })

  it('a square pixel, an unset pixel aspect and a zero rotation all take the fit', () => {
    for (const stream of [
      { width: 640, height: 360, sample_aspect_ratio: '1:1' },
      { width: 640, height: 360, sample_aspect_ratio: '0:1' },
      { width: 640, height: 360, side_data_list: [{ rotation: 0 }], tags: { rotate: '0' } }
    ]) {
      expect(heldSizeOf({ streams: [stream] })).toEqual({ width: 640, height: 360 })
    }
  })

  it('a Discard that lands while the probe runs rejects as the Discard, starts no encode, and leaves nothing registered', async () => {
    probeAnswer = 'held'
    lastChild = null
    const promise = convertToMp4(TAKE, '/tmp/in.webm', '/tmp/out.mp4', () => {})
    expect(cancelConverts(TAKE), 'the probe is a child the Discard reaches').toBe(true)
    expect(probeChild?.signals).toEqual(['SIGKILL'])
    probeChild?.emit('close', null, 'SIGKILL')
    const err = await promise.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConvertCancelledError)
    expect((err as InstanceType<typeof ConvertCancelledError>).byQuit).toBe(false)
    expect(lastChild, 'no encode was started').toBeNull()
    expect(cancelConverts(TAKE)).toBe(false)
  })

  it('the quit\'s sweep during the probe rejects as the quit\'s', async () => {
    probeAnswer = 'held'
    lastChild = null
    const promise = convertToMp4(TAKE, '/tmp/in.webm', '/tmp/out.mp4', () => {})
    cancelAllConverts()
    probeChild?.emit('close', null, 'SIGKILL')
    const err = await promise.catch((e: unknown) => e)
    expect((err as InstanceType<typeof ConvertCancelledError>).byQuit).toBe(true)
    expect(lastChild).toBeNull()
  })

  it('a probe that cannot even start keeps the plain even crop', async () => {
    probeAnswer = 'held'
    lastChild = null
    const promise = convertToMp4(TAKE, '/tmp/in.webm', '/tmp/out.mp4', () => {})
    probeChild?.emit('error', new Error('spawn ffprobe ENOENT'))
    const child = await encodeChild()
    child.emit('close', 0, null)
    await promise
    expect(vf()).toBe(EVEN_PICTURE)
  })
})
