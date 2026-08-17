import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

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

vi.mock('node:child_process', () => ({
  spawn: () => {
    lastChild = new FakeChild()
    return lastChild
  }
}))

const {
  convertToMp4,
  cancelConverts,
  cancelAllConverts,
  ConvertCancelledError,
  ConvertFailedError
} = await import('./convert')

/** Start a convert and hand back the promise plus its (fake) child. */
function startConvert(
  owner: 'recording' | 'import' = 'recording'
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
    expect(cancelConverts('recording')).toBe(false)
  })

  it('is idempotent', () => {
    expect(cancelConverts('recording')).toBe(false)
    expect(cancelConverts('recording')).toBe(false)
  })

  it('SIGKILLs the running child and reports that there was one', () => {
    const { promise, child } = startConvert()
    expect(cancelConverts('recording')).toBe(true)
    expect(child.signals).toEqual(['SIGKILL'])
    child.emit('close', null, 'SIGKILL')
    return expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('makes the convert reject as CANCELLED, not as a SIGKILL crash', async () => {
    const { promise, child } = startConvert()
    child.stderr.emit('data', 'frame= 120 fps= 30 q=28.0 size= 256kB')
    cancelConverts('recording')
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
    cancelConverts('recording')
    child.emit('error', new Error('kill EPERM'))
    await expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('clears the entry, so a second cancel finds nothing to kill', () => {
    const { promise, child } = startConvert()
    expect(cancelConverts('recording')).toBe(true)
    expect(cancelConverts('recording')).toBe(false)
    child.emit('close', null, 'SIGKILL')
    return expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('does not taint the next convert — a later failure is still a failure', async () => {
    const first = startConvert()
    cancelConverts('recording')
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
    const recording = startConvert('recording')
    const importing = startConvert('import')

    expect(cancelConverts('recording')).toBe(true)

    expect(recording.child.signals).toEqual(['SIGKILL'])
    expect(importing.child.signals).toEqual([])
    recording.child.emit('close', null, 'SIGKILL')
    await expect(recording.promise).rejects.toBeInstanceOf(ConvertCancelledError)

    // The import's slot is intact: it finishes on its own terms.
    importing.child.emit('close', 0, null)
    await expect(importing.promise).resolves.toBeUndefined()
  })

  it('cancelling the import leaves a concurrent recording convert running', async () => {
    const recording = startConvert('recording')
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
    expect(cancelConverts('recording')).toBe(false)
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
    const recording = startConvert('recording')
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
    const recording = startConvert('recording')
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
