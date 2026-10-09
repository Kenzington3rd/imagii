import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  describeImportError,
  examineDroppedFile,
  pathLooksLikeCloudSync
} from './importDiagnostics'

function makeFile(opts: {
  name?: string
  size?: number
  type?: string
  path?: string | null
}): File {
  const f = new File(['x'], opts.name ?? 'video.mp4', { type: opts.type ?? 'video/mp4' })
  if (opts.path !== undefined) {
    Object.defineProperty(f, 'path', {
      value: opts.path,
      configurable: true
    })
  }
  if (opts.size !== undefined) {
    Object.defineProperty(f, 'size', { value: opts.size })
  }
  return f
}

describe('pathLooksLikeCloudSync', () => {
  it.each([
    'C:\\Users\\mike\\OneDrive\\Documents\\clip.mp4',
    'C:\\Users\\mike\\Google Drive\\My Drive\\clip.mp4',
    'C:\\Users\\mike\\Dropbox\\videos\\clip.mp4',
    '/Users/mike/iCloudDrive/clip.mp4'
  ])('detects %s as cloud-sync', (path) => {
    expect(pathLooksLikeCloudSync(path)).toBe(true)
  })

  it.each([
    'C:\\Users\\mike\\Desktop\\clip.mp4',
    'C:\\Videos\\clip.mp4',
    null,
    undefined,
    ''
  ])('does not flag %s', (path) => {
    expect(pathLooksLikeCloudSync(path)).toBe(false)
  })
})

describe('examineDroppedFile', () => {
  it('reports no-file when undefined', () => {
    const r = examineDroppedFile(undefined)
    expect(r.hadFile).toBe(false)
    expect(r.reason).toBe('no-file')
  })

  it('reports no-path when File has no .path property', () => {
    const f = makeFile({ name: 'vid.mp4', path: null })
    const r = examineDroppedFile(f)
    expect(r.reason).toBe('no-path')
    expect(r.hadFile).toBe(true)
    expect(r.hadPath).toBe(false)
    expect(r.hint).toMatch(/cloud-only|browser tab|sandboxed/)
  })

  it('flags cloud-placeholder paths', () => {
    const f = makeFile({
      name: 'vid.mp4',
      path: 'C:\\Users\\mike\\OneDrive\\Videos\\vid.mp4'
    })
    const r = examineDroppedFile(f)
    expect(r.reason).toBe('cloud-placeholder')
    expect(r.hint).toMatch(/Always keep on this device/)
  })

  it('passes through normal local paths', () => {
    const f = makeFile({
      name: 'vid.mp4',
      path: 'C:\\Users\\mike\\Desktop\\vid.mp4'
    })
    const r = examineDroppedFile(f)
    expect(r.reason).toBe('ok')
    expect(r.hadFile).toBe(true)
    expect(r.hadPath).toBe(true)
  })
})

describe('describeImportError', () => {
  // T-84: what a streamer reads when a file will not open. The raw message
  // (ffprobe's stderr, an errno, Electron's IPC preamble) is for the console;
  // none of it may reach the sentence.
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const wrap = (channel: string, inner: string): Error =>
    new Error(`Error invoking remote method '${channel}': Error: ${inner}`)

  it('falls back to a plain sentence for a message nobody wrote for users', () => {
    expect(describeImportError(new Error('something broke'))).toBe("imagii couldn't open that file.")
  })

  it('passes a sentence main wrote for the user through whole, envelope stripped', () => {
    const refusal = 'This file is text, not a video — pick a video file such as MP4, MOV, or MKV.'
    expect(describeImportError(wrap('video:probe', refusal), 'C:\\notes.txt')).toBe(refusal)
  })

  it('a missing file says so without printing the raw message', () => {
    const msg = describeImportError(
      wrap('video:probe', 'ffprobe exit 1: C:\\foo\\vid.mp4: No such file or directory'),
      'C:\\foo\\vid.mp4'
    )
    expect(msg).toBe(
      "imagii can't find that file. It may have been moved or deleted — pick it again with Choose file…."
    )
    expect(msg).not.toMatch(/ffprobe|exit 1|ENOENT|No such file|Error invoking/)
  })

  it('a missing file inside a cloud-sync folder gets the cloud-aware hint', () => {
    const msg = describeImportError(
      new Error('ENOENT: no such file or directory'),
      'C:\\Users\\mike\\OneDrive\\Videos\\vid.mp4'
    )
    expect(msg).toMatch(/cloud-sync placeholder/)
    expect(msg).toMatch(/Always keep on this device/)
    expect(msg).not.toMatch(/ENOENT/)
  })

  it.each([
    'EACCES: access is denied',
    'EBUSY: resource busy or locked',
    "EPERM: operation not permitted, open 'x'"
  ])('a blocked file (%s) names Windows and the way out', (raw) => {
    expect(describeImportError(new Error(raw))).toBe(
      'Windows blocked access. Close any app using the file, or check your antivirus.'
    )
  })

  describe('a video that is only sound / a sound that is silent', () => {
    it('video: no picture -> Audio Studio', () => {
      expect(describeImportError(new Error('No video stream found in file'), null, 'video')).toBe(
        'This file has no picture, only sound. Open it in Audio Studio instead.'
      )
    })

    it('audio: no sound -> says so in audio words, not video ones', () => {
      expect(describeImportError(new Error('No audio stream found in file'), null, 'audio')).toBe(
        "This file has no sound, so there's nothing to clean. Pick a file with audio."
      )
    })

    it('the two kinds do not answer for each other', () => {
      // A video importer told "no audio stream" has no special line for it,
      // and an audio importer told "no video stream" likewise.
      expect(describeImportError(new Error('No audio stream found in file'), null, 'video')).toBe(
        "imagii couldn't open that file."
      )
      expect(describeImportError(new Error('No video stream found in file'), null, 'audio')).toBe(
        "imagii couldn't open that file."
      )
    })
  })

  describe('a file the decoder cannot read', () => {
    it.each([
      'ffprobe exit 1: x.avi: Invalid data found when processing input',
      'Unsupported codec with id 94213',
      'No decoder for stream 0',
      'moov atom not found',
      'ffprobe returned no usable duration for the video'
    ])('video (%s)', (raw) => {
      expect(describeImportError(new Error(raw), null, 'video')).toBe(
        "imagii can't read this video format. Re-export it as MP4 from your recorder."
      )
    })

    it('audio: the same cause in audio words — no "video" in an mp3 importer', () => {
      const msg = describeImportError(new Error('Invalid data found when processing input'), null, 'audio')
      expect(msg).toBe("imagii can't read this audio format. Re-export it as WAV or MP3 and try again.")
      expect(msg).not.toMatch(/video/i)
    })
  })

  it('never lets a raw message through, whichever branch answers', () => {
    const raws = [
      'ffprobe exit 1: C:\\a.mp4: No such file or directory',
      'EACCES: access is denied',
      'Invalid data found when processing input',
      'No video stream found in file',
      'something odd'
    ]
    for (const raw of raws) {
      const msg = describeImportError(wrap('video:probe', raw), 'C:\\a.mp4')
      expect(msg).not.toMatch(/ffprobe|exit 1|Error invoking|probe'|EACCES|ENOENT/)
      expect(msg.length).toBeLessThan(200)
    }
  })

  it('writes the raw error to the console for every branch', () => {
    const err = wrap('video:probe', 'ffprobe exit 1: a.mp4: No such file or directory')
    describeImportError(err, 'a.mp4')
    expect(errorSpy).toHaveBeenCalledWith('[imagii] could not open', 'a.mp4', err)
    errorSpy.mockClear()
    const odd = new Error('something odd')
    describeImportError(odd, 'a.mp4')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith("[imagii] imagii couldn't open that file.", odd)
  })
})
