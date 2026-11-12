import { describe, it, expect, vi } from 'vitest'
import { LIVE_TAKE_MESSAGE, mayLeaveLiveTake, registerLiveTake } from './liveTake'

// T-133 (1): a way off the Record screen that is not the Home link (a toast's "Open Audio Studio", the saved-toast "Edit in Video Studio")
// unmounted RecordStudio, whose cleanup stops the tracks: a LIVE TAKE was cut short with no question. The Home link has always asked
// "Stop and save it before leaving?"; this is that question as one function every way off the screen asks. E2E: record.spec.ts "a toast's
// way off the Record screen asks first while a take is live". The wiring pins (interactionWiring.test.ts) hold that each way asks.
describe('mayLeaveLiveTake - a live take is asked about before anything takes the person off its screen (T-133 (1))', () => {
  it('nothing is being recorded: free to go, and nobody is asked', () => {
    const ask = vi.fn(() => false)
    expect(mayLeaveLiveTake(ask)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('a take is live: the person is asked in the Home link\'s own words, and the answer is "not yet" either way', () => {
    const stop = vi.fn()
    const off = registerLiveTake(stop)
    const ask = vi.fn(() => false)
    expect(mayLeaveLiveTake(ask)).toBe(false)
    expect(ask).toHaveBeenCalledWith(LIVE_TAKE_MESSAGE)
    expect(LIVE_TAKE_MESSAGE).toBe('A recording is in progress. Stop and save it before leaving? (Cancel keeps recording.)')
    expect(stop, 'declined: the take runs on').not.toHaveBeenCalled()
    off()
  })

  it('accepted: the take is stopped (its normal save runs where the person is) and the caller still does not navigate', () => {
    const stop = vi.fn()
    const off = registerLiveTake(stop)
    expect(mayLeaveLiveTake(() => true)).toBe(false)
    expect(stop).toHaveBeenCalledTimes(1)
    off()
  })

  it('once the take is over (the screen unregistered it) the way is free again', () => {
    const off = registerLiveTake(() => undefined)
    off()
    const ask = vi.fn(() => false)
    expect(mayLeaveLiveTake(ask)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it('a late unregister of an earlier registration does not clear a newer take', () => {
    // StrictMode runs an effect's cleanup and then the effect again; a stale cleanup must not unregister what came after it.
    const stopOld = vi.fn()
    const stopNew = vi.fn()
    const offOld = registerLiveTake(stopOld)
    const offNew = registerLiveTake(stopNew)
    offOld()
    expect(mayLeaveLiveTake(() => true)).toBe(false)
    expect(stopNew).toHaveBeenCalledTimes(1)
    expect(stopOld).not.toHaveBeenCalled()
    offNew()
  })
})
