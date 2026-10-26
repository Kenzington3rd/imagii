import { describe, it, expect } from 'vitest'
import { claimFirst } from './claimFirst'

/** A promise the test settles by hand: a native dialog that has not answered yet. */
function pending<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve: (v: T) => void = () => undefined
  let reject: (e: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// T-131 (5): the claim is the whole point, so each half of it is a case: raised before anything awaits, given back on every way out, and
// a second call dropped while the first runs. The wiring tests (interactionWiring) pin that each picker goes through it; the e2e
// specs press twice on a real button over a chooser that answers late.
describe('claimFirst - one native dialog at a time (T-131 (5))', () => {
  it('raises the flag the instant it is called, before the work has awaited anything', async () => {
    const flag = { current: false }
    const dialog = pending<string>()
    let seen: boolean | null = null
    const run = claimFirst(flag, async () => {
      seen = flag.current
      return dialog.promise
    })
    expect(flag.current, 'raised synchronously: a second press in the same breath finds it up').toBe(true)
    expect(seen).toBe(true)
    dialog.resolve('x')
    await run
  })

  it('a second call while the first is open does NOT run its work, and answers undefined', async () => {
    const flag = { current: false }
    const dialog = pending<string>()
    let ran = 0
    const work = (): Promise<string> => {
      ran += 1
      return dialog.promise
    }
    const first = claimFirst(flag, work)
    const second = await claimFirst(flag, work)
    expect(second).toBeUndefined()
    expect(ran, 'one chooser, not two').toBe(1)
    dialog.resolve('picked')
    expect(await first).toBe('picked')
  })

  it('gives the claim back when the work finishes, so the next press is a press', async () => {
    const flag = { current: false }
    expect(await claimFirst(flag, async () => 1)).toBe(1)
    expect(flag.current).toBe(false)
    expect(await claimFirst(flag, async () => 2)).toBe(2)
  })

  it('gives the claim back when the work THROWS (a refused or failed pick is retryable), and passes the error on', async () => {
    const flag = { current: false }
    await expect(
      claimFirst(flag, async () => {
        throw new Error('the dialog failed')
      })
    ).rejects.toThrow('the dialog failed')
    expect(flag.current, 'not stuck on').toBe(false)
    expect(await claimFirst(flag, async () => 'again')).toBe('again')
  })

  it('a canceled dialog (work answers null) is a result like any other, and releases the claim', async () => {
    const flag = { current: false }
    expect(await claimFirst(flag, async () => null)).toBeNull()
    expect(flag.current).toBe(false)
  })

  it('a flag that is already up is left alone by the refused call (the first call still owns it)', async () => {
    const flag = { current: true }
    expect(await claimFirst(flag, async () => 'never')).toBeUndefined()
    expect(flag.current, 'a refused call must not lower the first one\'s claim').toBe(true)
  })
})
