import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CANCELLED_MESSAGE, CancelledError } from './cancel'
import { userFacingError, ERROR_TOAST_MS, CANCEL_TOAST_MS } from './userFacingError'

// T-84: the helper every renderer catch goes through. The inputs below are
// the real strings main produces (the runners' exit-code errors, the probe's
// sentences) wrapped the way Electron wraps them, because a helper tested on
// tidy input only proves it handles the input nobody ever sees.

const wrap = (channel: string, inner: string): Error =>
  new Error(`Error invoking remote method '${channel}': Error: ${inner}`)

let errorSpy: ReturnType<typeof vi.spyOn>
let infoSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('cancellation', () => {
  it.each([
    ['the error object', new CancelledError()],
    [
      'wrapped by the IPC bridge, class label and all',
      wrap('video:exportBatch', `CancelledError: ${CANCELLED_MESSAGE}`)
    ],
    ['wrapped with a plain Error label', wrap('video:concat', CANCELLED_MESSAGE)],
    ['a bare string reason', CANCELLED_MESSAGE]
  ])('is detected from %s', (_label, input) => {
    const out = userFacingError(input, 'Export failed.')
    expect(out.cancelled).toBe(true)
  })

  it('never offers the failure sentence, or the sentinel, as the cancel text', () => {
    const out = userFacingError(new CancelledError(), 'Export failed.')
    expect(out.message).toBe('Canceled.')
    expect(out.message).not.toContain('failed')
    expect(out.message).not.toContain(CANCELLED_MESSAGE)
  })

  it('is logged at info level, not as an error — a cancel is not one', () => {
    const err = new CancelledError()
    userFacingError(err, 'Export failed.')
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('canceled'), err)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('is NOT inferred from ffmpeg\'s words — a SIGKILL looks like a crash without the mark', () => {
    // The whole point of T-84's design: the renderer does not guess.
    for (const text of ['FFmpeg exit null: ', 'pip exit 1: ', 'highlight scan cancelled', 'cancelled']) {
      expect(userFacingError(new Error(text), 'Export failed.').cancelled).toBe(false)
    }
  })
})

describe('known failure shapes become the caller\'s sentence plus a plain cause', () => {
  const CTX = 'GIF export failed.'

  it.each([
    [
      'an encoder exit, wrapped',
      wrap('video:exportGif', 'gif exit 1: Conversion failed!'),
      "imagii's video tool stopped before it finished."
    ],
    ['a segment exit', new Error('segment 3 exit 1: x'), "imagii's video tool stopped"],
    ['a hyphenated runner', new Error('convert-to-mp4 exit signal SIGSEGV: '), "imagii's video tool stopped"],
    ['a signal-only exit', new Error('ebur128 exit SIGKILL'), "imagii's video tool stopped"],
    ['FFmpeg exit null', wrap('video:exportBatch', 'FFmpeg exit null: '), "imagii's video tool stopped"],
    [
      'a missing file (errno)',
      new Error("ENOENT: no such file or directory, open 'C:\\a.mp4'"),
      "A file imagii needs isn't there. It may have been moved or deleted."
    ],
    [
      'a missing file inside an ffprobe exit — the cause wins over the generic exit',
      wrap('video:exportBatch', 'ffprobe exit 1: /x/a.mp4: No such file or directory'),
      "A file imagii needs isn't there."
    ],
    [
      'a missing ffmpeg binary',
      new Error('spawn /app/ffmpeg ENOENT'),
      "A file imagii needs isn't there."
    ],
    ['a locked file', new Error('EBUSY: resource busy or locked, unlink'), 'Windows blocked access to a file.'],
    ['a permission error', new Error("EPERM: operation not permitted, open 'x'"), 'Windows blocked access to a file.'],
    ['an access error', new Error('EACCES: permission denied'), 'Windows blocked access to a file.'],
    ['Windows access wording', new Error('Access is denied.'), 'Windows blocked access to a file.'],
    ['a full disk', new Error('FFmpeg exit 1: av_interleaved_write_frame(): No space left on device'), 'Your disk is full.'],
    ['ENOSPC', new Error('ENOSPC: no space left on device, write'), 'Your disk is full.'],
    ['a Chromium network error', new Error('net::ERR_INTERNET_DISCONNECTED'), "imagii couldn't reach the internet."],
    ['a DNS failure', new Error('getaddrinfo ENOTFOUND duckduckgo.com'), "imagii couldn't reach the internet."],
    ['a proxy failure', wrap('search:images', 'net::ERR_PROXY_CONNECTION_FAILED'), "imagii couldn't reach the internet."],
    [
      'a damaged input',
      new Error('ffprobe exit 1: x.mp4: Invalid data found when processing input'),
      "That file looks damaged or isn't a format imagii can read."
    ],
    ['a truncated mp4', new Error('moov atom not found'), "That file looks damaged"],
    ['the model server erroring', 'HTTP 503', "The website didn't send the file."],
    ['a model download that arrived wrong', 'SHA-256 mismatch: expected a got b', 'The download arrived damaged.']
  ])('%s', (_label, input, causeStart) => {
    const out = userFacingError(input, CTX)
    expect(out.cancelled).toBe(false)
    expect(out.message.startsWith(`${CTX} `)).toBe(true)
    expect(out.message).toContain(causeStart)
  })

  it('every mapped message is the context sentence, a space, and ONE plain cause', () => {
    const out = userFacingError(new Error('FFmpeg exit 1: boom'), 'Export failed.')
    expect(out.message).toBe(
      "Export failed. imagii's video tool stopped before it finished. " +
        'Check that the source file still plays and the folder has room, then try again.'
    )
  })

  it('never lets ffmpeg\'s stderr, an errno, a channel name or the word "remote" through', () => {
    const noisy = wrap(
      'video:exportBatch',
      'FFmpeg exit 1: [libx264 @ 0x55] Error initializing output stream 0:0 -- ENOENT'
    )
    const out = userFacingError(noisy, 'Export failed.')
    expect(out.message).not.toMatch(/libx264|0x55|ENOENT|exportBatch|remote|invoking|FFmpeg/i)
  })

  it('maps the browser\'s device errors by NAME, not by message', () => {
    const named = (name: string, message: string): Error => {
      const e = new Error(message)
      e.name = name
      return e
    }
    expect(userFacingError(named('NotFoundError', 'Requested device not found'), "Couldn't start recording.").message).toBe(
      "Couldn't start recording. That device wasn't found. Check it's plugged in, then try again."
    )
    expect(userFacingError(named('NotAllowedError', 'Permission denied'), "Couldn't start recording.").message).toContain(
      "isn't allowed to use that device"
    )
    expect(userFacingError(named('NotReadableError', 'Could not start video source'), "Couldn't start recording.").message).toContain(
      'busy or unavailable'
    )
    // The same words from an ffmpeg exit are NOT a device problem — only the
    // DOMException name is, and an IPC-wrapped error is always named "Error".
    const ffmpegPermission = userFacingError(
      wrap('video:exportBatch', 'FFmpeg exit 1: out.mp4: Permission denied'),
      'Export failed.'
    )
    expect(ffmpegPermission.message).not.toContain('device')
  })
})

describe('a sentence main wrote stands alone', () => {
  it('passes a finished one-line sentence through, envelope stripped', () => {
    const text = 'This file is text, not a video — pick a video file such as MP4, MOV, or MKV.'
    expect(userFacingError(wrap('video:probe', text), 'Import failed.').message).toBe(text)
  })

  it('does not mangle main\'s own sentence that merely mentions an exit code', () => {
    const text = 'Converting the recording to MP4 failed (ffmpeg exit code 1). Nothing was saved.'
    expect(userFacingError(wrap('recording:finalize', text), 'Save failed.').message).toBe(text)
  })

  it.each([
    ['no terminal punctuation', 'jobs[0].clip range invalid (endSec must exceed startSec)'],
    ['a stack', 'Error: boom\n    at foo (bar.js:1:1).'],
    ['a TypeError', "TypeError: Cannot read properties of undefined (reading 'x')"],
    ['over 240 characters', `${'x'.repeat(250)}.`],
    ['a validator path', 'videoStudio.clips not array']
  ])('does not pass %s through — the caller\'s sentence is used', (_label, text) => {
    expect(userFacingError(new Error(text), 'Export failed.').message).toBe('Export failed.')
  })
})

describe('the fallback', () => {
  it.each([undefined, null, 42, {}, [], new Error(''), '', wrap('autosave:clear', '')])(
    'is used when the rejection carries nothing readable (%p)',
    (input) => {
      expect(userFacingError(input, 'Could not do the thing.')).toEqual({
        cancelled: false,
        message: 'Could not do the thing.'
      })
    }
  )
})

describe('the console always gets the raw error', () => {
  it('logs a failure at error level with the original object', () => {
    const err = wrap('video:exportBatch', 'FFmpeg exit 1: the whole stderr')
    userFacingError(err, 'Export failed.')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith('[imagii] Export failed.', err)
  })

  it('logs even when the caller\'s sentence is all the user sees', () => {
    const err = new Error('videoStudio.clips not array')
    userFacingError(err, 'Couldn\'t open that project.')
    expect(errorSpy).toHaveBeenCalledWith("[imagii] Couldn't open that project.", err)
  })

  it('logs once per call, not once per tier', () => {
    userFacingError(new Error('ENOENT: x'), 'Export failed.')
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })
})

describe('toast timing constants', () => {
  it('a failure toast outlives the 4 s default, and a cancel toast outlives a plain one', () => {
    expect(ERROR_TOAST_MS).toBeGreaterThan(4000)
    expect(CANCEL_TOAST_MS).toBeGreaterThan(4000)
  })
})
