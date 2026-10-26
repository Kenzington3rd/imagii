import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// T-117 (4): Record's save failure used to be `toast.error(..., { duration: ERROR_TOAST_MS })` written
// out at the call, pinned by name in interactionWiring.test.ts. It is `reportFailure` now, so the 8 s
// lives here once, for every caller: a failure is a red toast that outlasts the library's default, and a
// cancel is a neutral one (never `toast.error`).
const toastError = vi.fn()
const toastPlain = vi.fn()
vi.mock('react-hot-toast', () => ({
  default: Object.assign((...a: unknown[]) => toastPlain(...a), { error: (...a: unknown[]) => toastError(...a) })
}))

const { reportFailure } = await import('./reportFailure')
const { ERROR_TOAST_MS, CANCEL_TOAST_MS } = await import('@shared/userFacingError')
const { CANCELLED_MESSAGE } = await import('@shared/cancel')

beforeEach(() => {
  toastError.mockReset()
  toastPlain.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('reportFailure', () => {
  it('a failure is a red toast that lasts ERROR_TOAST_MS, in the caller\'s sentence plus the plain cause', () => {
    const out = reportFailure(
      new Error("Error invoking remote method 'recording:finalize': Error: ENOSPC: no space left on device, write"),
      { failed: 'Saving the recording failed.' }
    )
    expect(out.cancelled).toBe(false)
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(
      'Saving the recording failed. Your disk is full. Free up some space and try again.',
      { duration: ERROR_TOAST_MS }
    )
    expect(ERROR_TOAST_MS).toBeGreaterThanOrEqual(8000)
    expect(toastPlain).not.toHaveBeenCalled()
  })

  it('a failure given an id carries it to the toast, so a repeat of the same failure replaces the first instead of stacking (T-132 (13))', () => {
    reportFailure(new Error('config write refused'), { failed: "Couldn't save your settings.", id: 'settings-failed' })
    expect(toastError).toHaveBeenCalledWith("Couldn't save your settings.", { duration: ERROR_TOAST_MS, id: 'settings-failed' })
    // ...and one without an id passes none at all (an `id: undefined` would still be react-hot-toast's own random one).
    toastError.mockReset()
    reportFailure(new Error('config write refused'), { failed: 'x failed.' })
    expect(toastError.mock.calls[0]?.[1]).toEqual({ duration: ERROR_TOAST_MS })
    expect(Object.keys(toastError.mock.calls[0]?.[1] as object)).toEqual(['duration'])
  })

  it('a cancel is a neutral toast in the feature\'s own words, never toast.error', () => {
    const out = reportFailure(new Error(CANCELLED_MESSAGE), { failed: 'x failed.', canceled: 'x canceled.' })
    expect(out).toEqual({ cancelled: true, message: 'x canceled.' })
    expect(toastPlain).toHaveBeenCalledWith('x canceled.', { duration: CANCEL_TOAST_MS })
    expect(toastError).not.toHaveBeenCalled()
  })
})
