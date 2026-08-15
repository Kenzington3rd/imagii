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

const { convertToMp4, cancelActiveConvert, ConvertCancelledError } = await import('./convert')

/** Start a convert and hand back the promise plus its (fake) child. */
function startConvert(): { promise: Promise<void>; child: FakeChild } {
  const promise = convertToMp4('/tmp/in.webm', '/tmp/out.mp4', () => {})
  const child = lastChild
  if (!child) throw new Error('spawn was never called')
  return { promise, child }
}

beforeEach(() => {
  lastChild = null
  // Nothing should be in flight between tests; also proves the slot clears.
  cancelActiveConvert()
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
})

describe('cancelActiveConvert', () => {
  it('returns false when there is no in-flight conversion', () => {
    expect(cancelActiveConvert()).toBe(false)
  })

  it('is idempotent', () => {
    expect(cancelActiveConvert()).toBe(false)
    expect(cancelActiveConvert()).toBe(false)
  })

  it('SIGKILLs the running child and reports that there was one', () => {
    const { promise, child } = startConvert()
    expect(cancelActiveConvert()).toBe(true)
    expect(child.signals).toEqual(['SIGKILL'])
    child.emit('close', null, 'SIGKILL')
    return expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('makes the convert reject as CANCELLED, not as a SIGKILL crash', async () => {
    const { promise, child } = startConvert()
    child.stderr.emit('data', 'frame= 120 fps= 30 q=28.0 size= 256kB')
    cancelActiveConvert()
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
    cancelActiveConvert()
    child.emit('error', new Error('kill EPERM'))
    await expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('clears the slot, so a second cancel finds nothing to kill', () => {
    const { promise, child } = startConvert()
    expect(cancelActiveConvert()).toBe(true)
    expect(cancelActiveConvert()).toBe(false)
    child.emit('close', null, 'SIGKILL')
    return expect(promise).rejects.toBeInstanceOf(ConvertCancelledError)
  })

  it('does not taint the next convert — a later failure is still a failure', async () => {
    const first = startConvert()
    cancelActiveConvert()
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
