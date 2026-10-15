import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NoUsableDurationError, WAVEFORM_MAX_SEC, waveformCeilingRefusal } from '../../shared/audio'
import { userFacingError } from '../../shared/userFacingError'

/**
 * T-124 (6): "Clean audio" and a video dropped on the Audio importer EXTRACTED THE WHOLE SOUND of the video before the
 * 2-hour waveform gate got to refuse the result: a 4 h VOD is minutes of ffmpeg and a ~2.8 GB WAV in
 * %TEMP%\imagii-audio (and the handler dropped `cleanup`, so nothing deleted it). The handler asks for the length first
 * and refuses before it spawns anything. The real `audio:extractFromVideo` handler runs here; the probe and the
 * extraction are the stand-ins, so the evidence is whether the extraction was ever asked for.
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
let probeResult: () => Promise<{ duration: number; hasVideo?: boolean }> = async () => ({ duration: 60 })
// T-126 (8): what the probe says about the EXTRACTED WAV (the probe is asked about the video first, then, when the video had no
// length, about the scratch it made).
let wavProbeResult: () => Promise<{ duration: number }> = async () => ({ duration: 60 })
const probed: string[] = []
const extracted: string[] = []
const cleaned: string[] = []
const FAKE_WAV = '/tmp/imagii-audio/fake.wav'

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  },
  dialog: {},
  BrowserWindow: {},
  shell: {},
  app: { getPath: () => tmpdir() }
}))
vi.mock('../audio/probe', () => ({
  probeAudio: async (file: string) => {
    probed.push(file)
    return file === FAKE_WAV ? wavProbeResult() : probeResult()
  }
}))
vi.mock('../audio/extract', () => ({
  extractAudioFromVideo: async (file: string) => {
    extracted.push(file)
    return { wavPath: FAKE_WAV, cleanup: async () => void cleaned.push(FAKE_WAV) }
  }
}))

const { registerAudioIpc } = await import('./audio')
registerAudioIpc()

// vi.mock is hoisted above this constant, so the factory refers to it lazily (a call, not at definition).
const VIDEO = path.join(tmpdir(), 'vod.mp4')
const extract = (file: string = VIDEO): Promise<unknown> => {
  const handler = handlers.get('audio:extractFromVideo')
  if (!handler) throw new Error('no handler')
  return handler({}, file)
}

beforeEach(() => {
  probed.length = 0
  extracted.length = 0
  cleaned.length = 0
  probeResult = async () => ({ duration: 60 })
  wavProbeResult = async () => ({ duration: 60 })
})

describe('audio:extractFromVideo asks for the length before it extracts (T-124 (6))', () => {
  it('a video over two hours is refused with the video sentence, and the extraction is never started', async () => {
    probeResult = async () => ({ duration: 4 * 3600 })
    const sentence = waveformCeilingRefusal(4 * 3600, 'video') ?? ''
    expect(sentence).toMatch(/Video Studio/)
    await expect(extract()).rejects.toThrow(sentence)
    expect(probed).toEqual([VIDEO])
    expect(extracted, 'ffmpeg was spawned for a file the gate was going to refuse').toEqual([])
  })

  it('one second over the ceiling is refused, the ceiling itself is not', async () => {
    probeResult = async () => ({ duration: WAVEFORM_MAX_SEC + 1 })
    await expect(extract()).rejects.toThrow(/longer than 2 hours/)
    expect(extracted).toEqual([])
    probeResult = async () => ({ duration: WAVEFORM_MAX_SEC })
    await expect(extract()).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: null })
    expect(extracted).toEqual([VIDEO])
  })

  it('a short video still extracts and answers the WAV path, as it always did', async () => {
    await expect(extract()).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: null })
    expect(probed).toEqual([VIDEO])
    expect(extracted).toEqual([VIDEO])
  })

  it('a video with no sound stream fails at the probe, before any extraction (the importer words it: "no sound, nothing to clean")', async () => {
    probeResult = async () => {
      throw new Error('No audio stream found in file')
    }
    await expect(extract()).rejects.toThrow(/No audio stream found/)
    expect(extracted).toEqual([])
  })

  // T-125 (4): the probe's "no usable duration" refused containers extraction handles end to end - a MediaRecorder WebM and a crashed
  // MKV have no duration in their header - and the person read "can't read this audio format" for a file that works. A probe that
  // cannot READ a length is an unknown length, not a verdict: the extraction runs, and the WAV it makes has a real one, which
  // `audioStore.loadSource`'s gate (the same 2-hour ceiling, on the WAV) backstops. Only "no sound" is the probe's to refuse.
  it.each([
    ['a container with no duration in its header', 'ffprobe returned no usable duration for the audio stream'],
    ['a probe that exited non-zero on a file ffmpeg can still read', 'ffprobe exit 1: Invalid data found when processing input'],
    ['a probe that printed something that is not JSON', 'Unexpected token < in JSON at position 0']
  ])('%s: the extraction is still asked for, and the WAV path is answered', async (_label, message) => {
    probeResult = async () => {
      throw new Error(message)
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(extract()).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: null })
      expect(extracted, 'the extractor handled this file before the probe was in front of it').toEqual([VIDEO])
      expect(warn, 'the unknown length is a console note, not a toast').toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('a probe that cannot read a length does not skip the gate where the length is known: a known length over two hours is still refused', async () => {
    probeResult = async () => ({ duration: WAVEFORM_MAX_SEC + 60 })
    await expect(extract()).rejects.toThrow(/longer than 2 hours/)
    expect(extracted).toEqual([])
  })

  // T-125 (7): this handler also extracts the sound of an AIFF or a WMA (audio WebAudio cannot decode). Those are not videos: Video Studio
  // refuses a file with no picture, so the video sentence sent a 3-hour AIFF to a studio that sent it back (the circle T-124 (7) closed
  // for plain audio and these formats missed).
  it.each(['pad.aiff', 'pad.AIF', 'take.wma'])('a %s over two hours is told to split it in another app, never to export a part from Video Studio', async (name) => {
    probeResult = async () => ({ duration: 3 * 3600 })
    const file = path.join(tmpdir(), name)
    const err = await extract(file).catch((e: unknown) => e as Error)
    expect((err as Error).message).toBe(waveformCeilingRefusal(3 * 3600, 'audio'))
    expect((err as Error).message).not.toMatch(/Video Studio/)
    expect(extracted).toEqual([])
  })

  it.each(['vod.mp4', 'vod.MKV', 'vod.webm', 'vod.wmv'])('a %s over two hours still gets the video sentence', async (name) => {
    probeResult = async () => ({ duration: 3 * 3600 })
    const err = await extract(path.join(tmpdir(), name)).catch((e: unknown) => e as Error)
    expect((err as Error).message).toBe(waveformCeilingRefusal(3 * 3600, 'video'))
    expect((err as Error).message).toMatch(/Video Studio/)
  })

  it('the refusal is a finished sentence that reaches the person as written, through the IPC envelope', async () => {
    probeResult = async () => ({ duration: 5 * 3600 })
    const err = await extract().catch((e: unknown) => e)
    const wrapped = new Error(`Error invoking remote method 'audio:extractFromVideo': ${String((err as Error).message ? `Error: ${(err as Error).message}` : err)}`)
    expect(userFacingError(wrapped, "Couldn't extract the audio.").message).toBe(waveformCeilingRefusal(5 * 3600, 'video'))
  })
})

// T-126 (7): what the file IS is read from its STREAMS. An `.mkv` or `.mp4` can hold sound alone (a podcast, a voice memo, a stream's
// audio-only rip), and the extension said "video": the over-ceiling sentence sent it to Video Studio, which refuses a file with no
// picture (the circle T-125 (7) closed for the formats that are never videos), and the renderer set `fromVideo`, which turns Re-attach
// on, whose mux fails on `-map 0:v:0`. The handler hands the answer to the renderer, which decides `fromVideo` from it.
describe('audio:extractFromVideo decides picture or no picture from the probe, not the extension (T-126 (7))', () => {
  it.each(['podcast.mkv', 'memo.mp4', 'rip.MKV', 'cast.webm'])('a %s with NO video stream over two hours gets the audio sentence', async (name) => {
    probeResult = async () => ({ duration: 3 * 3600, hasVideo: false })
    const err = await extract(path.join(tmpdir(), name)).catch((e: unknown) => e as Error)
    expect((err as Error).message).toBe(waveformCeilingRefusal(3 * 3600, 'audio'))
    expect((err as Error).message).not.toMatch(/Video Studio/)
    expect(extracted, 'refused before the work').toEqual([])
  })

  it('the other way: a file whose name says audio but whose streams carry a picture gets the video sentence', async () => {
    probeResult = async () => ({ duration: 3 * 3600, hasVideo: true })
    const err = await extract(path.join(tmpdir(), 'oddly-named.wma')).catch((e: unknown) => e as Error)
    expect((err as Error).message).toBe(waveformCeilingRefusal(3 * 3600, 'video'))
  })

  it('the answer carries what the probe found, so the importer sets the re-attach marker from the streams', async () => {
    probeResult = async () => ({ duration: 60, hasVideo: false })
    await expect(extract(path.join(tmpdir(), 'podcast.mkv'))).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: false })
    probeResult = async () => ({ duration: 60, hasVideo: true })
    await expect(extract()).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: true })
  })

  it('a probe that could not read the file says nothing (null) and the extension is the fallback: .aiff audio, .mp4 video', async () => {
    probeResult = async () => {
      throw new Error('ffprobe returned no usable duration for the audio stream')
    }
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(extract(path.join(tmpdir(), 'pad.aiff'))).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: null })
      await expect(extract()).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: null })
    } finally {
      vi.restoreAllMocks()
    }
  })
})

// T-127 (10): and a probe that READ the streams but found no length (a MediaRecorder WebM, a crashed MKV: no duration in the header) still
// knows the picture question. It used to throw before computing it, so the extension decided: a durationless audio-only WebM or MKV was
// told the video remedy over two hours and came back with `hasVideo: null`, which leaves Re-attach on by default for a file with no
// picture. `NoUsableDurationError` carries the streams' answer; a probe that could not read the file at all (a plain Error) still says nothing.
describe('audio:extractFromVideo keeps the streams\' answer for a file with no length (T-127 (10))', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['take.webm', 'rip.mkv', 'cast.MP4'])('a durationless %s with NO picture hands back hasVideo false, not the extension\'s guess', async (name) => {
    probeResult = async () => {
      throw new NoUsableDurationError(false)
    }
    await expect(extract(path.join(tmpdir(), name))).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: false })
  })

  it('and one with a picture hands back true, even under a name that says audio', async () => {
    probeResult = async () => {
      throw new NoUsableDurationError(true)
    }
    await expect(extract(path.join(tmpdir(), 'oddly-named.wma'))).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: true })
  })

  it('a durationless sound-only .webm whose WAV turns out over two hours gets the AUDIO sentence and the scratch is deleted', async () => {
    probeResult = async () => {
      throw new NoUsableDurationError(false)
    }
    wavProbeResult = async () => ({ duration: 3 * 3600 })
    const err = await extract(path.join(tmpdir(), 'take.webm')).catch((e: unknown) => e as Error)
    expect((err as Error).message).toBe(waveformCeilingRefusal(3 * 3600, 'audio'))
    expect((err as Error).message).not.toMatch(/Video Studio/)
    expect(cleaned, 'and the scratch dies with the refusal').toEqual([FAKE_WAV])
  })

  it('a durationless file WITH a picture, over two hours, still gets the video sentence', async () => {
    probeResult = async () => {
      throw new NoUsableDurationError(true)
    }
    wavProbeResult = async () => ({ duration: 3 * 3600 })
    const err = await extract(path.join(tmpdir(), 'take.wma')).catch((e: unknown) => e as Error)
    expect((err as Error).message).toBe(waveformCeilingRefusal(3 * 3600, 'video'))
  })

  it('a plain "no usable duration" Error (nothing read) still leaves the extension to decide', async () => {
    probeResult = async () => {
      throw new Error('ffprobe returned no usable duration for the audio stream')
    }
    await expect(extract(path.join(tmpdir(), 'take.webm'))).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: null })
  })
})

// T-126 (8): a file whose probe cannot read a length is extracted first (T-125 (4)), and the only gate on the result was the renderer's
// `loadSource` - which refused a WAV of 2+ hours AFTER it was written and never knew where the scratch was: the multi-GB file stayed in
// %TEMP%\imagii-audio until the 6-hour reaper. The handler asks the WAV for its real length, and a refused one is deleted with the refusal.
describe('audio:extractFromVideo does not leave a scratch WAV behind a refusal (T-126 (8))', () => {
  const noLength = async (): Promise<never> => {
    throw new Error('ffprobe returned no usable duration for the audio stream')
  }

  it('a durationless file whose WAV turns out longer than two hours: the scratch is deleted, and the person gets the sentence', async () => {
    probeResult = noLength
    wavProbeResult = async () => ({ duration: 3 * 3600 })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const err = await extract().catch((e: unknown) => e as Error)
      expect((err as Error).message).toBe(waveformCeilingRefusal(3 * 3600, 'video'))
      expect(extracted, 'the work was done (there was no length to refuse it on)').toEqual([VIDEO])
      expect(probed, 'the original first, then the scratch it made').toEqual([VIDEO, FAKE_WAV])
      expect(cleaned, 'and the scratch dies with the refusal').toEqual([FAKE_WAV])
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('the sentence is the one for what the file is (a durationless .wma is not told to use Video Studio)', async () => {
    probeResult = noLength
    wavProbeResult = async () => ({ duration: 3 * 3600 })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const err = await extract(path.join(tmpdir(), 'take.wma')).catch((e: unknown) => e as Error)
      expect((err as Error).message).toBe(waveformCeilingRefusal(3 * 3600, 'audio'))
      expect(cleaned).toEqual([FAKE_WAV])
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('a durationless file whose WAV is within the ceiling is answered, and the scratch is kept', async () => {
    probeResult = noLength
    wavProbeResult = async () => ({ duration: WAVEFORM_MAX_SEC })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(extract()).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: null })
      expect(cleaned).toEqual([])
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('a WAV whose own length cannot be read is not a verdict: it is answered, and the importer\'s gate stays the last resort', async () => {
    probeResult = noLength
    wavProbeResult = async () => {
      throw new Error('ffprobe exit 1')
    }
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(extract()).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: null })
      expect(cleaned).toEqual([])
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('a file whose length was known is probed ONCE: the WAV is not asked about again', async () => {
    probeResult = async () => ({ duration: 600, hasVideo: true })
    await extract()
    expect(probed).toEqual([VIDEO])
  })
})
