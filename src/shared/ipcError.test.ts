import { describe, it, expect } from 'vitest'
import { ipcErrorMessage } from './ipcError'

// T-59: every renderer catch that toasts a rejected `window.api.*` call goes
// through here. The cases below are the real strings Electron produced for
// the recording and search channels, plus the ones that must survive
// untouched — a helper that eats the message is worse than the preamble.

describe('ipcErrorMessage', () => {
  it('strips the invoke envelope and the doubled Error label', () => {
    const err = new Error(
      "Error invoking remote method 'recording:finalize': Error: Converting the recording to MP4 failed (ffmpeg exit code 1). Nothing was saved."
    )
    expect(ipcErrorMessage(err, 'Save failed')).toBe(
      'Converting the recording to MP4 failed (ffmpeg exit code 1). Nothing was saved.'
    )
  })

  it('strips a named error class too', () => {
    const err = new Error(
      "Error invoking remote method 'video:probe': TypeError: source is not a video"
    )
    expect(ipcErrorMessage(err, 'fallback')).toBe('source is not a video')
  })

  it('leaves a message that never crossed the IPC alone', () => {
    expect(ipcErrorMessage(new Error('Could not start recording'), 'fallback')).toBe(
      'Could not start recording'
    )
  })

  it('keeps copy that merely contains the word Error', () => {
    const err = new Error('Errors were found in 3 of 5 clips')
    expect(ipcErrorMessage(err, 'fallback')).toBe('Errors were found in 3 of 5 clips')
  })

  it('keeps a channel name that appears mid-sentence', () => {
    const err = new Error("The handler for 'video:export' is not registered")
    expect(ipcErrorMessage(err, 'fallback')).toBe(
      "The handler for 'video:export' is not registered"
    )
  })

  it('falls back when the envelope is all there was', () => {
    const err = new Error("Error invoking remote method 'autosave:clear': Error: ")
    expect(ipcErrorMessage(err, 'unknown reason')).toBe('unknown reason')
  })

  it.each([null, undefined, 42, {}, [], new Error('')])(
    'falls back for a rejection that is not a message (%p)',
    (value) => {
      expect(ipcErrorMessage(value, 'Save failed')).toBe('Save failed')
    }
  )

  it('accepts a bare string rejection', () => {
    expect(ipcErrorMessage('disk full', 'fallback')).toBe('disk full')
  })
})
