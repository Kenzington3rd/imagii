import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { CancelLatch } from './cancelLatch'
import { CANCELLED_MESSAGE, CancelledError, isCancelledError } from '../../shared/cancel'

/**
 * T-98 — the latch itself. What each runner does with it is cancelSentinel.test.ts's
 * business (the real runners against a fake child); this file is the contract the
 * runners lean on: a Cancel marks the runs open when it arrives, a finished run
 * cannot be marked, and the probe wait gives way to a Cancel at once.
 */

/** A promise the test settles by hand — a probe that takes as long as it likes. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: Error) => void
} {
  let resolve: (value: T) => void = () => undefined
  let reject: (err: Error) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const settle = async <T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> =>
  p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  )

describe('CancelLatch — which runs a cancel reaches', () => {
  it('check() is quiet until a cancel lands, then throws the T-84 sentinel', () => {
    const latch = new CancelLatch()
    const run = latch.begin('job-1')
    expect(() => run.check()).not.toThrow()
    expect(latch.cancel('job-1')).toBe(true)
    let caught: unknown
    try {
      run.check()
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CancelledError)
    expect((caught as Error).message).toBe(CANCELLED_MESSAGE)
    expect(isCancelledError(caught)).toBe(true)
  })

  it('a cancel by name marks that job and no other', () => {
    const latch = new CancelLatch()
    const a = latch.begin('a')
    const b = latch.begin('b')
    expect(latch.cancel('a')).toBe(true)
    expect(() => a.check()).toThrow()
    expect(() => b.check()).not.toThrow()
  })

  it('cancelAll marks every open run, named or not', () => {
    const latch = new CancelLatch()
    const named = latch.begin('a')
    const anonymous = latch.begin()
    expect(latch.cancelAll()).toBe(true)
    expect(() => named.check()).toThrow()
    expect(() => anonymous.check()).toThrow()
  })

  it('a run with no name cannot be canceled by the empty name', () => {
    const latch = new CancelLatch()
    const anonymous = latch.begin()
    expect(latch.cancel('')).toBe(false)
    expect(() => anonymous.check()).not.toThrow()
  })

  it('reports whether there was anything to cancel', () => {
    const latch = new CancelLatch()
    expect(latch.cancel('nothing')).toBe(false)
    expect(latch.cancelAll()).toBe(false)
    const run = latch.begin('a')
    expect(latch.cancel('other')).toBe(false)
    expect(latch.cancelAll()).toBe(true)
    run.end()
    expect(latch.cancelAll()).toBe(false)
  })
})

describe('CancelLatch — a stale Cancel cannot reach the next run', () => {
  it('a cancel pressed with nothing running leaves the next run alone', () => {
    const latch = new CancelLatch()
    latch.cancelAll()
    latch.cancel('job-1')
    const run = latch.begin('job-1')
    expect(() => run.check()).not.toThrow()
  })

  it('a cancel aimed at a finished run leaves the next run alone, even under the same name', () => {
    const latch = new CancelLatch()
    const first = latch.begin('job-1')
    first.end()
    expect(latch.cancel('job-1')).toBe(false)
    const second = latch.begin('job-1')
    expect(() => second.check()).not.toThrow()
  })

  it('a run that was canceled stays canceled after it ends, and the next one starts clean', () => {
    const latch = new CancelLatch()
    const first = latch.begin('job-1')
    latch.cancel('job-1')
    first.end()
    expect(() => first.check()).toThrow()
    expect(() => latch.begin('job-1').check()).not.toThrow()
  })
})

describe('CancelLatch.guard — the wait before a child exists', () => {
  it('returns what the work returns when nobody cancels', async () => {
    const latch = new CancelLatch()
    const run = latch.begin('job-1')
    await expect(run.guard(Promise.resolve(42))).resolves.toBe(42)
  })

  it('passes the work\'s own failure through when nobody cancels', async () => {
    const latch = new CancelLatch()
    const run = latch.begin('job-1')
    const boom = new Error('ffprobe exit 1')
    await expect(run.guard(Promise.reject(boom))).rejects.toBe(boom)
  })

  it('a cancel that lands while the work runs ends the wait at once', async () => {
    const latch = new CancelLatch()
    const run = latch.begin('job-1')
    const probe = deferred<number>()
    const waiting = settle(run.guard(probe.promise))
    latch.cancel('job-1')
    // The probe has NOT settled: the wait is over anyway.
    const outcome = await waiting
    expect(outcome.error).toBeInstanceOf(CancelledError)
    // …and the probe finishing later is nobody's problem.
    probe.resolve(1)
    await Promise.resolve()
  })

  it('work that succeeds after a cancel reads as the cancel', async () => {
    const latch = new CancelLatch()
    const run = latch.begin('job-1')
    const cancelled = latch.cancel('job-1')
    expect(cancelled).toBe(true)
    const outcome = await settle(run.guard(Promise.resolve(42)))
    expect(outcome.error).toBeInstanceOf(CancelledError)
  })

  it('work that FAILS after a cancel reads as the cancel, not as a failure nobody asked about', async () => {
    const latch = new CancelLatch()
    const run = latch.begin('job-1')
    latch.cancelAll()
    const outcome = await settle(run.guard(Promise.reject(new Error('ffprobe exit 1'))))
    expect(isCancelledError(outcome.error)).toBe(true)
  })

  it('a cancel aimed at another job does not end this one\'s wait', async () => {
    const latch = new CancelLatch()
    const run = latch.begin('job-1')
    const probe = deferred<number>()
    const waiting = settle(run.guard(probe.promise))
    latch.cancel('job-2')
    probe.resolve(7)
    expect((await waiting).value).toBe(7)
  })

  it('leaves no unhandled rejection behind a run that is never canceled', async () => {
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const latch = new CancelLatch()
      const quiet = latch.begin('quiet')
      await quiet.guard(Promise.resolve(1))
      quiet.end()
      const marked = latch.begin('marked')
      latch.cancel('marked')
      marked.end()
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(seen).toEqual([])
  })
})

/**
 * T-127 (3): the quit waits for the canceled runs' cleanup. The count lives in the MODULE (every latch in the process feeds it), and the
 * runs the tests above open and never end would keep it above zero, so each case here loads a fresh copy of the module.
 */
describe('drainRuns - the quit waits, bounded, for every run to end (T-127 (3))', () => {
  const fresh = async (): Promise<typeof import('./cancelLatch')> => {
    vi.resetModules()
    return import('./cancelLatch')
  }
  afterEach(() => {
    vi.useRealTimers()
  })

  it('with nothing running it answers at once, and the ceiling is the quit flush\'s 1.5 s', async () => {
    const mod = await fresh()
    expect(mod.openRunCount()).toBe(0)
    await expect(mod.drainRuns()).resolves.toBe('drained')
    expect(mod.QUIT_DRAIN_TIMEOUT_MS).toBe(1500)
  })

  it('waits for the run to END, not for the cancel: a marked run is still open until its runner has cleaned up', async () => {
    const mod = await fresh()
    const latch = new mod.CancelLatch()
    const run = latch.begin('job')
    let drained = false
    const waiting = mod.drainRuns().then((r) => {
      drained = true
      return r
    })
    latch.cancelAll()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mod.openRunCount(), 'marked, not ended').toBe(1)
    expect(drained, 'the cancel alone does not release the quit').toBe(false)
    run.end()
    await expect(waiting).resolves.toBe('drained')
    expect(mod.openRunCount()).toBe(0)
  })

  it('counts the runs of EVERY latch: it is released only when the last one has ended', async () => {
    const mod = await fresh()
    const a = new mod.CancelLatch().begin('a')
    const b = new mod.CancelLatch().begin('b')
    let drained = false
    const waiting = mod.drainRuns().then(() => {
      drained = true
    })
    a.end()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(drained, 'one latch is still working').toBe(false)
    b.end()
    await waiting
    expect(drained).toBe(true)
  })

  it('a run that is ended twice is counted once', async () => {
    const mod = await fresh()
    const latch = new mod.CancelLatch()
    const a = latch.begin('a')
    latch.begin('b')
    a.end()
    a.end()
    expect(mod.openRunCount(), 'b is still open').toBe(1)
  })

  it('a runner that cleans up after its cancel holds the quit until the cleanup is done', async () => {
    const mod = await fresh()
    const latch = new mod.CancelLatch()
    let cleaned = false
    // What every runner is: try { return await work } finally { run.end() }, with the cleanup between the failure and the end.
    const runner = async (): Promise<void> => {
      const run = latch.begin('j')
      try {
        await run.guard(new Promise<never>(() => undefined))
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 40))
        cleaned = true
        throw new Error('canceled')
      } finally {
        run.end()
      }
    }
    const running = runner().catch(() => undefined)
    latch.cancelAll()
    await expect(mod.drainRuns()).resolves.toBe('drained')
    expect(cleaned, 'the drain returned after the cleanup, not before').toBe(true)
    await running
  })

  it('gives up at the ceiling: a run that never ends costs the quit that long and no more, and its late end() is harmless', async () => {
    const mod = await fresh()
    vi.useFakeTimers()
    const run = new mod.CancelLatch().begin('hung')
    const waiting = mod.drainRuns(1500)
    await vi.advanceTimersByTimeAsync(1499)
    let settled = false
    void waiting.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled, 'still inside the ceiling').toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(waiting).resolves.toBe('timeout')
    // Ending the run later throws nothing, and the next drain starts clean.
    run.end()
    expect(mod.openRunCount()).toBe(0)
    await expect(mod.drainRuns()).resolves.toBe('drained')
  })
})

/**
 * T-127 (3): `drainRuns` means "the cleanup is done" ONLY because every runner ends its run after its work has settled. In an async
 * function `try { return work() } finally { run.end() }` runs the `finally` BEFORE `work()` has settled (the promise is returned, not
 * awaited), which would end the run, and release the quit, before the failure path deleted anything. Every runner is
 * `try { return await work(...) } finally { run.end() }` today; this holds the next one to it.
 */
describe('every runner ends its run after its work (the premise of drainRuns) (T-127 (3))', () => {
  const MAIN = path.resolve(__dirname, '..')
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) return walk(full)
      return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : []
    })

  /** Every try statement in `text` whose `finally` calls `<x>.end()`, with the expression of each `return` in its try block (own function only). */
  function runTries(text: string): Array<{ line: number; returns: Array<{ awaited: boolean; text: string }> }> {
    const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true)
    const out: Array<{ line: number; returns: Array<{ awaited: boolean; text: string }> }> = []
    const visit = (n: ts.Node): void => {
      if (ts.isTryStatement(n) && n.finallyBlock && /\b\w+\.end\(\)/.test(n.finallyBlock.getText(sf))) {
        const returns: Array<{ awaited: boolean; text: string }> = []
        const inTry = (m: ts.Node): void => {
          if (ts.isFunctionLike(m)) return
          if (ts.isReturnStatement(m) && m.expression) returns.push({ awaited: ts.isAwaitExpression(m.expression), text: m.expression.getText(sf) })
          ts.forEachChild(m, inTry)
        }
        ts.forEachChild(n.tryBlock, inTry)
        out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, returns })
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
    return out
  }

  it('no runner returns an un-awaited promise from the try whose finally ends its run', () => {
    const tries = walk(MAIN).flatMap((file) =>
      runTries(readFileSync(file, 'utf8')).map((t) => ({ file: path.relative(MAIN, file).split(path.sep).join('/'), ...t }))
    )
    expect(tries.length, 'the scan finds the runners (a scan over nothing proves nothing)').toBeGreaterThanOrEqual(10)
    expect(tries.map((t) => t.file)).toEqual(expect.arrayContaining(['ffmpeg/export.ts', 'ffmpeg/reframe.ts', 'ffmpeg/gif.ts', 'ffmpeg/concat.ts', 'audio/process.ts']))
    const bare = tries.flatMap((t) => t.returns.filter((r) => !r.awaited && /\(/.test(r.text)).map((r) => `${t.file}:${t.line} returns ${r.text.slice(0, 60)} without await`))
    expect(bare, 'a runner whose finally can run before its work has settled').toEqual([])
  })

  it('the scan sees the shape it forbids: a bare returned call is flagged, an awaited one and a plain value are not', () => {
    const bad = runTries("async function f() { const run = l.begin(); try { return work(run) } finally { run.end() } }")
    expect(bad[0]?.returns).toEqual([{ awaited: false, text: 'work(run)' }])
    const good = runTries("async function f() { const run = l.begin(); try { return await work(run) } finally { run.end() } }")
    expect(good[0]?.returns).toEqual([{ awaited: true, text: 'await work(run)' }])
    const value = runTries("async function f() { const run = l.begin(); try { await w(); return result } finally { run.end() } }")
    expect(value[0]?.returns).toEqual([{ awaited: false, text: 'result' }])
    const nested = runTries("async function f() { const run = l.begin(); try { go(() => { return other() }) } finally { run.end() } }")
    expect(nested[0]?.returns, 'a nested function\'s return is its own').toEqual([])
    expect(runTries('async function f() { try { return work() } finally { cleanup() } }'), 'a finally that does not end a run is not a runner').toEqual([])
  })
})
