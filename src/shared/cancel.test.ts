import { describe, it, expect } from 'vitest'
import { CANCELLED_MESSAGE, CancelledError, isCancelledError } from './cancel'

// T-84: the sentinel is the ONE way a cancel crosses from main to the
// renderer. These pin the forms it can arrive in — and the forms that must
// NOT be taken for it, because a false positive hides a real failure behind a
// friendly "canceled".

describe('CancelledError', () => {
  it('carries the sentinel as its message and is an Error', () => {
    const err = new CancelledError()
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe(CANCELLED_MESSAGE)
    expect(err.name).toBe('CancelledError')
  })
})

describe('isCancelledError', () => {
  it('recognises the error object main threw', () => {
    expect(isCancelledError(new CancelledError())).toBe(true)
  })

  it('recognises it after Electron wrapped it for the bridge', () => {
    // What a rejected handler looks like in the renderer: the channel, then
    // "<Name>: <message>" from stringifying the original error.
    expect(
      isCancelledError(
        new Error(`Error invoking remote method 'video:exportBatch': CancelledError: ${CANCELLED_MESSAGE}`)
      )
    ).toBe(true)
    expect(
      isCancelledError(
        new Error(`Error invoking remote method 'video:concat': Error: ${CANCELLED_MESSAGE}`)
      )
    ).toBe(true)
  })

  it('recognises a bare string, such as the reason of an { ok: false } result', () => {
    expect(isCancelledError(CANCELLED_MESSAGE)).toBe(true)
  })

  it.each([
    new Error('FFmpeg exit 1: Conversion failed!'),
    new Error('FFmpeg exit null: '),
    new Error('highlight scan cancelled'),
    new Error('cancelled'),
    'cancelled',
    'Cancelled by user',
    new Error(''),
    '',
    null,
    undefined,
    42,
    {},
    { message: CANCELLED_MESSAGE }
  ])('does not take %p for a cancel', (value) => {
    expect(isCancelledError(value)).toBe(false)
  })
})
