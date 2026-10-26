import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CANCELLED_MESSAGE, CancelledError } from './cancel'
import {
  userFacingError,
  isMissingFileError,
  ERROR_TOAST_MS,
  CANCEL_TOAST_MS
} from './userFacingError'

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

// T-112: "Couldn't find X. It may have been moved or deleted." is a claim about ONE
// kind of failure — the file is not there. A project that cannot open its video
// for any other reason (a conversion that failed, a full disk, a file another app
// holds) used to say the same sentence, and the person went looking for a file
// that was sitting where they left it.
describe('isMissingFileError — only a file that is not there', () => {
  it.each([
    ['ffprobe, the way main words it', new Error('ffprobe exit 1: /v/stream.mp4: No such file or directory')],
    ['wrapped by the IPC bridge', wrap('video:probe', 'ffprobe exit 1: /v/a.mp4: No such file or directory')],
    ['a converter on a missing original', new Error('convert-to-mp4 exit 1: /v/a.flv: No such file or directory')],
    ['a Node errno', Object.assign(new Error("ENOENT: no such file or directory, open 'a.wav'"), { code: 'ENOENT' })],
    ['Windows words', new Error('The system cannot find the file specified.')],
    ['Windows words for a path', new Error('The system cannot find the path specified.')]
  ])('%s', (_name, err) => {
    expect(isMissingFileError(err)).toBe(true)
  })

  it.each([
    ['a conversion that failed', new Error('convert-to-mp4 exit 1: /v/a.flv: Invalid data found when processing input')],
    ['a full disk', new Error('ENOSPC: no space left on device, write')],
    ['a file another app holds', new Error('EBUSY: resource busy or locked')],
    ['a permission refusal', new Error('EACCES: permission denied')],
    ['a damaged file', new Error('ffprobe exit 1: moov atom not found')],
    ['a sentence main wrote', new Error('This file is text, not a video — pick a video file such as MP4, MOV, or MKV.')],
    ['no message at all', new Error('')],
    ['not an error', undefined],
    ['a string that happens to be a name', 'stream.mp4']
  ])('%s is not "missing"', (_name, err) => {
    expect(isMissingFileError(err)).toBe(false)
  })

  it('agrees with the sentence userFacingError gives for a missing file', () => {
    // One definition of "missing": whatever userFacingError explains as a missing
    // file is what the project-open path calls missing.
    const err = new Error('ffprobe exit 1: /v/a.mp4: No such file or directory')
    expect(userFacingError(err, 'Export failed.').message).toContain("isn't there")
    expect(isMissingFileError(err)).toBe(true)
  })
})

// T-117 (4): Record's finalize toast only stripped the IPC envelope (`ipcErrorMessage(err, 'Save failed')`),
// so every cause but the convert crash reached the person as main's raw string: a copyfile EPERM with both
// full paths, an ENOSPC from the write stream mid-take, a channel-prefixed "recording is empty". It goes
// through `userFacingError(err, 'Saving the recording failed.')` (reportFailure) now; these are the shapes
// that save can actually reject with, as Electron hands them to the renderer.
describe("Record's save failure is a sentence, whatever the cause (T-117)", () => {
  const FAILED = 'Saving the recording failed.'
  const wrapFinalize = (text: string): Error => wrap('recording:finalize', text)

  it('a copyfile EPERM is "Windows blocked access", and neither path reaches the person', () => {
    const raw =
      "EPERM: operation not permitted, copyfile 'C:\\Users\\maken\\AppData\\Roaming\\imagii\\recordings\\V1StGXR8_Z.webm' -> 'D:\\Videos\\Stream take.webm'"
    const shown = userFacingError(wrapFinalize(raw), FAILED).message
    expect(shown).toBe(
      `${FAILED} Windows blocked access to a file. Close any app using it, or check your antivirus.`
    )
    expect(shown).not.toMatch(/maken|Videos|AppData|\.webm|copyfile|EPERM/)
  })

  it('an ENOSPC from the stream mid-take is "Your disk is full"', () => {
    const shown = userFacingError(wrapFinalize('ENOSPC: no space left on device, write'), FAILED).message
    expect(shown).toBe(`${FAILED} Your disk is full. Free up some space and try again.`)
  })

  it('the same causes read the same when the stream error is thrown by the renderer-side queue (no envelope)', () => {
    const plain = new Error('ENOSPC: no space left on device, write')
    expect(userFacingError(plain, FAILED).message).toBe(`${FAILED} Your disk is full. Free up some space and try again.`)
  })

  it('a raw string with a channel in it and no known cause is the caller\'s sentence, not the raw text', () => {
    expect(userFacingError(wrapFinalize('recording:finalize recording is empty'), FAILED).message).toBe(FAILED)
    expect(userFacingError(new Error('Recording session was never started'), FAILED).message).toBe(FAILED)
  })

  it('main\'s own finished sentences (the convert crash, nothing recorded) stand as written', () => {
    const convert =
      'Converting the recording to MP4 failed (ffmpeg exit code 1). Nothing was saved \u2014 ' +
      'try again, or uncheck "Convert to MP4 after recording" to keep the WebM.'
    expect(userFacingError(wrapFinalize(convert), FAILED).message).toBe(convert)
    const empty = 'Nothing was recorded, so there is nothing to save. Start the recording again.'
    expect(userFacingError(wrapFinalize(empty), FAILED).message).toBe(empty)
  })
})

// T-118 (1): the Autosave banner's Clear goes through `userFacingError(err, "Couldn't clear the autosave.
// It's still on disk.")`. main/autosave.ts `clearAutosave` carries the first failed unlink's errno code in
// its message ("could not delete autosave.json (EBUSY)"); these are the shapes it can raise, as Electron
// hands them over. `autosave.test.ts` drives the real function and checks it throws exactly these.
describe("the Autosave banner's Clear failure (T-118)", () => {
  const FAILED = "Couldn't clear the autosave. It's still on disk."
  const wrapClear = (text: string): Error => wrap('autosave:clear', text)

  it.each([
    ['a locked file', 'could not delete autosave.json (EBUSY)'],
    ['a blocked one', 'could not delete autosave.prev.json (EPERM)'],
    ['one it may not touch', 'could not delete autosave.json, autosave.tmp (EACCES)']
  ])('%s is the sentence plus the plain cause, and no file name or code reaches the person', (_label, text) => {
    const shown = userFacingError(wrapClear(text), FAILED).message
    expect(shown).toBe(`${FAILED} Windows blocked access to a file. Close any app using it, or check your antivirus.`)
    expect(shown).not.toMatch(/EBUSY|EPERM|EACCES|autosave\.(?:json|prev|tmp)|could not delete/)
  })

  it.each([
    ['no code at all (the bare shape)', 'could not delete autosave.json'],
    ['a folder where the file should be', 'could not delete autosave.tmp (EISDIR)'],
    ['a read-only disk', 'could not delete autosave.json (EROFS)'],
    ['a code the helper has no words for', 'could not delete autosave.json (EIO)']
  ])('%s is the caller\'s own sentence, because the shape has no period to stand on', (_label, text) => {
    expect(userFacingError(wrapClear(text), FAILED).message).toBe(FAILED)
  })
})

// T-139 (10): the shipped Windows ffmpeg says "Permission denied" when it may not open a file it was handed (the Microsoft C runtime maps a sharing violation or an
// ACL block to EACCES, and strerror(EACCES) is that phrase) - a recording held open by an editor or a scanner, an export aimed at a file another app has. The runner's
// message carries ffmpeg's stderr, so the person was told "check that the source still plays and the folder has room" about a file that was LOCKED. These are the
// lines the shipped win32 ffmpeg and ffprobe print, as the runners wrap them and Electron wraps those: the sweep captured the export and probe lines, and the
// "all three lines" rows were captured again under Wine from the shipped ffmpeg.exe (a folder where the output / the input should be gives EACCES).
describe('ffmpeg\'s "Permission denied" is the Windows-blocked cause when it is a runner\'s (T-139 (10))', () => {
  const CTX = 'Export failed.'
  const BLOCKED = `${CTX} Windows blocked access to a file. Close any app using it, or check your antivirus.`
  const GENERIC =
    `${CTX} imagii's video tool stopped before it finished. ` +
    'Check that the source file still plays and the folder has room, then try again.'
  /** `export.ts`: `FFmpeg exit ${code}: ${stderr tail}`, the tail in CRLF as the Windows exe prints it. */
  const EXPORT_LINE =
    'FFmpeg exit 1: [out#0/mp4 @ 00007fffff46bfc0] Error opening output C:\\x\\clip.mp4: Permission denied\r\nError opening output files: Permission denied'
  /** The shipped win32 ffmpeg.exe under Wine, given a FOLDER where the output file should be: all of its stderr, CRLF, with the line between the two causes. */
  const WINE_OUTPUT =
    'FFmpeg exit 243: [out#0/mp4 @ 00007fffff466e00] Error opening output Z:\\tmp\\clip.mp4: Permission denied\r\nError opening output file Z:\\tmp\\clip.mp4.\r\nError opening output files: Permission denied'
  /** The same exe given a folder as its INPUT; the cause has no path in front of it, and the runner (audio extract) does not trim the stderr's last CRLF. */
  const WINE_INPUT =
    'audio extract exit 243: [in#0 @ 00007fffff45e500] Error opening input: Permission denied\r\nError opening input file Z:\\tmp\\rec.mp4.\r\nError opening input files: Permission denied\r\n'
  /** `ffmpeg/probe.ts`: `ffprobe exit ${code}: ${stderr}`. */
  const PROBE_LINE = 'ffprobe exit 1: C:\\x\\rec.mp4: Permission denied'

  it.each([
    ['the export (ffmpeg could not open its output), wrapped', wrap('video:exportBatch', EXPORT_LINE)],
    ['the export, as the runner threw it', new Error(EXPORT_LINE)],
    ['the export, all three lines the win32 exe prints when the output is a folder (captured under Wine)', new Error(WINE_OUTPUT)],
    ['an input the win32 exe could not open (captured under Wine)', new Error(WINE_INPUT)],
    ['the probe (ffprobe could not open the recording), wrapped', wrap('video:probe', PROBE_LINE)],
    ['the probe, as the runner threw it', new Error(PROBE_LINE)],
    ['the same with Unix line ends', new Error(EXPORT_LINE.replace(/\r\n/g, '\n'))],
    ['a cause that is not the last line', new Error('ffprobe exit 1: C:\\x\\rec.mp4: Permission denied\nsome later line')],
    ['an audio extract', new Error('audio extract exit 1: C:\\x\\rec.mp4: Permission denied')],
    ['a GIF', new Error('gif exit 1: [out#0/gif @ 000001] Error opening output C:\\x\\a.gif: Permission denied')],
    ['a join segment', new Error('segment 2 exit 1: C:\\x\\part.mp4: Permission denied')],
    ['the join', new Error('concat exit 1: [out#0/mp4 @ 000001] Error opening output C:\\x\\all.mp4: Permission denied')],
    ['the conversion on import', new Error('convert-to-mp4 exit 1: C:\\x\\rec.mkv: Permission denied')],
    ['strerror in lower case (a port that prints it so)', new Error('FFmpeg exit 1: C:\\x\\a.mp4: permission denied')]
  ])('%s is the sentence plus Windows\' cause, and no path, tool name or errno reaches the person', (_label, input) => {
    const shown = userFacingError(input, CTX).message
    expect(shown).toBe(BLOCKED)
    expect(shown).not.toMatch(/ffmpeg|ffprobe|exit \d|C:|Permission denied|out#0/i)
  })

  it('it is the same sentence a locked file already got (EBUSY, EPERM, EACCES, "Access is denied") - one cause, one set of words', () => {
    for (const text of ['EBUSY: resource busy or locked, open', 'EPERM: operation not permitted, open', 'EACCES: permission denied, open', 'Access is denied.']) {
      expect(userFacingError(new Error(text), CTX).message, text).toBe(BLOCKED)
    }
  })

  describe('and only when it is the cause of a runner or probe exit', () => {
    it.each([
      // The control the ticket names (record.spec.ts "Screen recording permission denied"): main's own string for a capture the OS refused.
      ['screen recording refused', new Error('Screen recording permission denied')],
      ['the same through the bridge', wrap('record:listSources', 'Screen recording permission denied')],
      ['a bare errno-less message', new Error('Permission denied')],
      ['ffmpeg\'s line with no runner around it', new Error('Error opening output files: Permission denied')],
      ['a sentence of ours that is not an exit', new Error("Couldn't list the sources: Permission denied")]
    ])('%s is NOT mapped: it falls to the caller\'s own sentence', (_label, input) => {
      expect(userFacingError(input, CTX).message).toBe(CTX)
    })

    it('a runner exit that only MENTIONS the words keeps the generic exit sentence (the words must END a line, as strerror\'s do)', () => {
      expect(userFacingError(new Error('FFmpeg exit 1: Permission denied for the codec; try again'), CTX).message).toBe(GENERIC)
      expect(userFacingError(new Error('FFmpeg exit 1: the Permission denied filter is not a thing'), CTX).message).toBe(GENERIC)
      // and at the end of a line, but not strerror's: it is printed after a colon (a path's, a tool's), never inside a sentence.
      expect(userFacingError(new Error('FFmpeg exit 1: the encoder reported Permission denied'), CTX).message).toBe(GENERIC)
    })

    it('a runner exit with another cause keeps its own sentence (the other causes are not shadowed)', () => {
      expect(userFacingError(new Error('FFmpeg exit 1: Conversion failed!'), CTX).message).toBe(GENERIC)
      expect(userFacingError(new Error('FFmpeg exit 1: av_interleaved_write_frame(): No space left on device'), CTX).message).toBe(`${CTX} Your disk is full. Free up some space and try again.`)
      expect(userFacingError(new Error('ffprobe exit 1: C:\\x\\a.mp4: No such file or directory'), CTX).message).toBe(`${CTX} A file imagii needs isn't there. It may have been moved or deleted.`)
    })

    it('the browser\'s own NotAllowedError (a device refused) still reads as a device, not as a locked file', () => {
      const denied = new Error('Permission denied')
      denied.name = 'NotAllowedError'
      expect(userFacingError(denied, 'Recording failed.').message).toContain('Check Windows Settings > Privacy')
    })
  })
})


// T-140 (10): a failed transcription blamed the video tool. The speech engine's runner words its failure `whisper exit <code>: <stderr>`, which has the runner shape
// `RUNNER_EXIT` knows, so it got the generic sentence about imagii's VIDEO tool ("check that the source file still plays and the folder has room") - the wrong
// program and the wrong advice: a missing .dll beside the exe is Windows' exit 0xC0000135, and a damaged model is the engine's too. The engine has its own sentence,
// and a missing-DLL exit its own again. Node reports a Windows NTSTATUS exit code as the unsigned 32-bit value (libuv hands the DWORD over as it is), so 0xC0000135 reads
// 3221225781; the signed spelling (-1073741515, what .NET and some debuggers print) is pinned too because nothing here depends on which one a runtime picks.
describe('a whisper exit is the captions engine\'s failure, not the video tool\'s (T-140 (10))', () => {
  const CTX = 'Transcription failed.'
  const ENGINE =
    `${CTX} The captions engine stopped before it finished. ` +
    'Open Captions setup to check its files and the model, then try again.'
  const MISSING_FILE_OF_THE_ENGINE =
    `${CTX} The captions engine couldn't start because a file it needs is missing. ` +
    'Copy every .dll that came in the zip next to whisper-cli.exe (Captions setup opens that folder), then try again.'
  const GENERIC =
    `${CTX} imagii's video tool stopped before it finished. ` +
    'Check that the source file still plays and the folder has room, then try again.'
  const BLOCKED = `${CTX} Windows blocked access to a file. Close any app using it, or check your antivirus.`

  it.each([
    ['a damaged model', new Error('whisper exit 1: whisper_init_from_file_with_params_no_state: failed to load model')],
    ['the same through the bridge', wrap('captions:transcribe', 'whisper exit 1: model file is damaged')],
    ['another code', new Error('whisper exit 2: error: unknown argument')],
    ['a signal-less exit (the runner prints null)', new Error('whisper exit null: ')],
    ['a negative code', new Error('whisper exit -1: ')],
    ['no stderr at all', new Error('whisper exit 1: ')],
    ['a crash code that is not the missing-file one (an access violation, 0xC0000005)', new Error('whisper exit 3221225477: ')],
    ['a code that only CONTAINS the missing-file digits', new Error('whisper exit 32212257810: ')],
    ['the missing-file digits in the stderr, not in the code', new Error('whisper exit 1: exit 3221225781 was reported by the loader')]
  ])('%s is the captions engine\'s sentence, and nothing of the runner reaches the person', (_label, input) => {
    const shown = userFacingError(input, CTX).message
    expect(shown).toBe(ENGINE)
    expect(shown).not.toMatch(/video tool|ffmpeg|ffprobe|exit \d|whisper exit|source file|folder has room|invoking|remote/i)
  })

  it.each([
    ['the unsigned code Node reports for 0xC0000135, with the nothing the loader prints', new Error('whisper exit 3221225781: ')],
    ['the same, bare, as the runner throws it', new Error('whisper exit 3221225781')],
    ['the same through the bridge', wrap('captions:transcribe', 'whisper exit 3221225781: ')],
    ['with a stderr tail', new Error('whisper exit 3221225781: some loader text\r\nand a second line')],
    ['the signed spelling of the same status', new Error('whisper exit -1073741515: ')],
    ['the signed spelling through the bridge', wrap('captions:transcribe', 'whisper exit -1073741515: ')]
  ])('%s is the missing-files sentence: the .dll files from the zip belong beside whisper-cli.exe', (_label, input) => {
    expect(userFacingError(input, CTX).message).toBe(MISSING_FILE_OF_THE_ENGINE)
  })

  it('both are one finished sentence after the caller\'s own: one line, a period at the end, short enough for a toast', () => {
    for (const cause of [ENGINE, MISSING_FILE_OF_THE_ENGINE]) {
      expect(cause.startsWith(`${CTX} `)).toBe(true)
      expect(cause).not.toContain('\n')
      expect(cause).toMatch(/\.$/)
      expect(cause.length).toBeLessThanOrEqual(240)
    }
  })

  it('both name where to go: the Captions setup the panel has, and the engine in plain words ("the captions engine")', () => {
    for (const cause of [ENGINE, MISSING_FILE_OF_THE_ENGINE]) {
      expect(cause).toContain('Captions setup')
      expect(cause).toContain('The captions engine')
    }
  })

  it('a burn-in is ffmpeg\'s, so a burn-in exit keeps the video tool\'s sentence - whatever code it carries', () => {
    expect(userFacingError(new Error('burn-in exit 1: Conversion failed!'), CTX).message).toBe(GENERIC)
    expect(userFacingError(new Error('burn-in exit 3221225781: '), CTX).message).toBe(GENERIC)
    expect(userFacingError(wrap('captions:burnIn', 'burn-in exit 1: [out#0/mp4 @ 0x1] Error'), CTX).message).toBe(GENERIC)
    expect(userFacingError(new Error('FFmpeg exit 3221225781: '), CTX).message).toBe(GENERIC)
  })

  it('only a message that STARTS with the engine\'s exit is the engine\'s: an ffmpeg line that mentions it, and a sentence of ours, are not', () => {
    expect(userFacingError(new Error('FFmpeg exit 1: whisper exit 1: not this'), CTX).message).toBe(GENERIC)
    expect(userFacingError(new Error('Transcription stopped (whisper exit code 1).'), CTX).message).toBe('Transcription stopped (whisper exit code 1).')
    expect(userFacingError(new Error('Whisper did not produce C:\\x\\a.srt'), CTX).message).toBe(CTX)
    // the model download has its own words and keeps them
    expect(userFacingError('HTTP 503', CTX).message).toContain("The website didn't send the file.")
  })

  describe('and the causes that were already known to be something else keep their sentence (decided: a more specific cause wins over the engine\'s)', () => {
    it('"Permission denied" at the end of a line is the Windows-blocked cause for the engine too (T-139 (10)): a model another app holds is a locked file, not a damaged engine', () => {
      expect(userFacingError(new Error('whisper exit 1: C:\\x\\ggml-base.en.bin: Permission denied'), CTX).message).toBe(BLOCKED)
      expect(userFacingError(new Error('whisper exit 1: error: failed to open C:\\x\\a.wav: Permission denied\r\n'), CTX).message).toBe(BLOCKED)
      // ...and a line that only mentions the words is the engine's
      expect(userFacingError(new Error('whisper exit 1: Permission denied for the model, try again'), CTX).message).toBe(ENGINE)
    })

    it('a full disk and a missing file read as they do for every runner', () => {
      expect(userFacingError(new Error('whisper exit 1: write failed: No space left on device'), CTX).message).toBe(`${CTX} Your disk is full. Free up some space and try again.`)
      expect(userFacingError(new Error('whisper exit 1: C:\\x\\ggml-base.en.bin: No such file or directory'), CTX).message).toBe(
        `${CTX} A file imagii needs isn't there. It may have been moved or deleted.`
      )
    })

    it('a missing-DLL exit with a locked-file line is the locked file (the stderr is read first), and nothing else changes for the code', () => {
      expect(userFacingError(new Error('whisper exit 3221225781: C:\\x\\a.dll: Permission denied'), CTX).message).toBe(BLOCKED)
    })
  })
})
