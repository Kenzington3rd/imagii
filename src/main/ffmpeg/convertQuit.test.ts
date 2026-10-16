import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isCancelledError } from '../../shared/cancel'
import { drainRuns, openRunCount } from './cancelLatch'

/**
 * T-128 (5), T-127 (3)'s "not covered": the import transcode (`convertForImport`) is a RUN, and a transcode that stops removes its mp4.
 *
 * A dropped flv / ts / wmv is transcoded into `<tmp>/imagii-import/<name>-<id>.mp4`. The quit sweep kills the child; the half-written
 * file (no moov atom) was never removed by anything but the next launch's sweep, and the process was gone before it could have been.
 * Now the transcode holds a run until it has removed its partial, so the quit's wait covers it - and a transcode that FAILS removes
 * its partial too. The temp folder is this file's own (the extraction test's sandbox, for the same reason: `tempCleanup.test.ts` empties
 * the real one while these files are being made).
 */
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const sandbox = mkdtempSync(join(actual.tmpdir(), 'imagii-convertquit-sandbox-'))
  const tmpdir = (): string => sandbox
  return { ...actual, tmpdir, default: { ...actual, tmpdir } }
})
afterAll(() => {
  rmSync(tmpdir(), { recursive: true, force: true })
})

let slowUnlinkMs = 0
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    unlink: async (file: Parameters<typeof real.unlink>[0]) => {
      if (slowUnlinkMs > 0 && String(file).endsWith('.mp4')) await new Promise((resolve) => setTimeout(resolve, slowUnlinkMs))
      return real.unlink(file)
    }
  }
})

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
    setTimeout(() => this.emit('close', null, 'SIGKILL'), 5)
    return true
  }
}
const spawned: Array<{ args: string[]; child: FakeChild }> = []
vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    const child = new FakeChild()
    spawned.push({ args, child })
    // ffmpeg opens its output when it starts.
    writeFileSync(args[args.length - 1] as string, 'half-written transcode')
    return child
  }
}))

const { convertForImport, beginConvertRun, cancelConverts, cancelAllConverts, ConvertCancelledError, ConvertFailedError } = await import('./convert')

const importDir = (): string => path.join(tmpdir(), 'imagii-import')
const outputOf = (i: number): string => spawned[i]?.args[(spawned[i]?.args.length ?? 1) - 1] as string
const settle = (p: Promise<unknown>): Promise<unknown> => p.then((value) => ({ resolved: value }), (err: unknown) => err)
async function untilSpawned(n: number): Promise<void> {
  for (let i = 0; i < 400 && spawned.length < n; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  expect(spawned.length, 'the transcode started').toBeGreaterThanOrEqual(n)
}

let scratch = ''
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-cq-'))
  spawned.length = 0
  slowUnlinkMs = 0
  cancelAllConverts()
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  if (existsSync(importDir())) rmSync(importDir(), { recursive: true, force: true })
})

describe('the import transcode in the middle of a quit (T-128 (5))', () => {
  it('is a run the quit waits for: the sweep kills the child, and the quit is released only once the half-written mp4 is gone', async () => {
    const done = settle(convertForImport('/videos/stream.flv'))
    await untilSpawned(1)
    const out = outputOf(0)
    expect(path.dirname(out)).toBe(importDir())
    expect(path.basename(out)).toMatch(/^stream-[\w-]{8}\.mp4$/)
    expect(existsSync(out), 'ffmpeg has the partial open').toBe(true)
    expect(openRunCount()).toBe(1)
    slowUnlinkMs = 150

    cancelAllConverts()
    await expect(drainRuns(3000)).resolves.toBe('drained')

    expect(existsSync(out), 'released only when the partial is gone (its removal takes 150 ms)').toBe(false)
    const err = await done
    expect(isCancelledError(err)).toBe(true)
    expect((err as InstanceType<typeof ConvertCancelledError>).byQuit, 'and the rejection says the quit did it').toBe(true)
    expect(openRunCount()).toBe(0)
  })

  it('a Discard-style cancel of the import (by owner) is not a quit, and removes its partial too', async () => {
    const done = settle(convertForImport('/videos/stream.flv'))
    await untilSpawned(1)
    expect(cancelConverts('import')).toBe(true)
    const err = await done
    expect(err).toBeInstanceOf(ConvertCancelledError)
    expect((err as InstanceType<typeof ConvertCancelledError>).byQuit).toBe(false)
    expect(readdirSync(importDir())).toEqual([])
  })

  it('a transcode that FAILS removes its partial and rejects with the failure, not as a cancel', async () => {
    const done = settle(convertForImport('/videos/broken.flv'))
    await untilSpawned(1)
    spawned[0]?.child.stderr.emit('data', 'Invalid data found when processing input')
    spawned[0]?.child.emit('close', 1, null)
    const err = await done
    expect(err).toBeInstanceOf(ConvertFailedError)
    expect(readdirSync(importDir()), 'a mp4 with no moov atom is nobody\'s working copy').toEqual([])
    expect(openRunCount()).toBe(0)
  })

  it('the control: a transcode that finishes keeps its file, answers its path, and ends its run', async () => {
    const done = convertForImport('/videos/ok.flv')
    await untilSpawned(1)
    spawned[0]?.child.emit('close', 0, null)
    const result = await done
    expect(result).toBe(outputOf(0))
    expect(existsSync(result)).toBe(true)
    expect(openRunCount()).toBe(0)
  })

  it('a quit that lands while the folder is being made spawns nothing (the T-98 wait)', async () => {
    const done = settle(convertForImport('/videos/early.flv'))
    cancelAllConverts() // synchronously after the call: the mkdir has not finished
    const err = await done
    expect(isCancelledError(err)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(spawned, 'no child was ever started').toHaveLength(0)
    expect(openRunCount()).toBe(0)
  })

  it('Discard recording does not reach an import: the run is scoped by owner', async () => {
    const done = settle(convertForImport('/videos/keep-going.flv'))
    await untilSpawned(1)
    expect(cancelConverts('recording'), 'nothing of the recording\'s is running').toBe(false)
    expect(spawned[0]?.child.signals, 'the import\'s child was not signalled').toEqual([])
    spawned[0]?.child.emit('close', 0, null)
    expect(await done).toEqual({ resolved: outputOf(0) })
  })
})

describe('beginConvertRun (the recording save\'s run)', () => {
  it('is marked by its owner\'s cancel and by the quit sweep, and by nobody else\'s', () => {
    const recording = beginConvertRun('recording')
    const imported = beginConvertRun('import')
    cancelConverts('recording')
    expect(() => recording.check()).toThrow()
    expect(() => imported.check()).not.toThrow()
    cancelAllConverts()
    expect(() => imported.check()).toThrow()
    recording.end()
    imported.end()
    expect(openRunCount()).toBe(0)
  })
})
