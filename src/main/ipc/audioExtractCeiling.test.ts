import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NoUsableDurationError } from '../../shared/audio'

/**
 * `audio:extractFromVideo`, the handler that pulls a video's (or an AIFF's, a WMA's) sound out for Audio Studio. The file keeps
 * the name of the gate it was written for: T-124 (6) made the handler ask the 2-hour waveform ceiling BEFORE extracting (a 4 h
 * VOD used to be minutes of ffmpeg and a ~2.8 GB WAV that the gate then refused), and T-126 (8) asked it of the scratch WAV
 * after a durationless extraction and deleted a refused one.
 *
 * T-129 RETIRED the ceiling: the waveform is drawn from main's streamed peaks, not decoded in the renderer, so a recording of
 * any length is extracted and opened. Every case that pinned a refusal is FLIPPED here to pin that the extraction goes ahead and
 * the scratch is the person's file, not wreckage. What stays from T-125/T-126/T-127 is the probe's other work: "no sound" is
 * refused before anything is spawned, an unreadable length is not a verdict, and whether the file has a PICTURE comes from its
 * streams. The real handler runs here; the probe and the extraction are the stand-ins.
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
let probeResult: () => Promise<{ duration: number; hasVideo?: boolean }> = async () => ({ duration: 60 })
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
    return probeResult()
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
})

describe('audio:extractFromVideo has no length gate (T-129 flips T-124 (6))', () => {
  it.each([
    ['one second over the old 2-hour ceiling', 7201],
    ['a 4 h VOD', 4 * 3600],
    ['a 9 h marathon stream', 9 * 3600]
  ])('%s is extracted and its WAV answered: the waveform no longer limits the length', async (_label, duration) => {
    probeResult = async () => ({ duration, hasVideo: true })
    await expect(extract()).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: true })
    expect(extracted, 'the extraction ran').toEqual([VIDEO])
    expect(cleaned, 'and the scratch is the file the studio opens, not wreckage').toEqual([])
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
  // cannot READ a length is an unknown length, not a verdict: the extraction runs.
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

  // T-125 (7) gave an AIFF or a WMA over two hours its own sentence (they are not videos, and Video Studio refuses a file with no
  // picture). There is no sentence now: they are extracted like any other file, at any length.
  it.each(['pad.aiff', 'pad.AIF', 'take.wma'])('a %s over two hours is extracted', async (name) => {
    probeResult = async () => ({ duration: 3 * 3600, hasVideo: false })
    const file = path.join(tmpdir(), name)
    await expect(extract(file)).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: false })
    expect(extracted).toEqual([file])
  })
})

// T-126 (7): what the file IS is read from its STREAMS. An `.mkv` or `.mp4` can hold sound alone (a podcast, a voice memo, a stream's
// audio-only rip), and the extension said "video": the renderer set `fromVideo`, which turns Re-attach on, whose mux fails on
// `-map 0:v:0`. The handler hands the answer to the renderer, which decides `fromVideo` from it. (Its over-ceiling sentence, the
// other thing the answer chose, went with the ceiling in T-129.)
describe('audio:extractFromVideo decides picture or no picture from the probe, not the extension (T-126 (7))', () => {
  it.each(['podcast.mkv', 'memo.mp4', 'rip.MKV', 'cast.webm'])('a %s with NO video stream, of any length, answers hasVideo false', async (name) => {
    probeResult = async () => ({ duration: 3 * 3600, hasVideo: false })
    await expect(extract(path.join(tmpdir(), name))).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: false })
  })

  it('the other way: a file whose name says audio but whose streams carry a picture answers true', async () => {
    probeResult = async () => ({ duration: 3 * 3600, hasVideo: true })
    await expect(extract(path.join(tmpdir(), 'oddly-named.wma'))).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: true })
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
// knows the picture question. `NoUsableDurationError` carries the streams' answer; a probe that could not read the file at all (a plain
// Error) still says nothing.
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

  it('a plain "no usable duration" Error (nothing read) still leaves the extension to decide', async () => {
    probeResult = async () => {
      throw new Error('ffprobe returned no usable duration for the audio stream')
    }
    await expect(extract(path.join(tmpdir(), 'take.webm'))).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: null })
  })
})

// T-126 (8) asked the scratch WAV of a durationless extraction for ITS length, and deleted a WAV over the ceiling with the refusal. With
// no ceiling there is nothing to ask it: the original is probed once, and the scratch, whatever its length, is what the studio opens.
describe('audio:extractFromVideo asks nothing of the scratch WAV (T-129 retires the T-126 (8) backstop with the ceiling)', () => {
  it('a durationless file is probed ONCE, extracted, and its scratch kept', async () => {
    probeResult = async () => {
      throw new NoUsableDurationError(false)
    }
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(extract(path.join(tmpdir(), 'take.webm'))).resolves.toEqual({ wavPath: FAKE_WAV, hasVideo: false })
      expect(probed, 'the original only: the WAV is not asked for a length').toEqual([path.join(tmpdir(), 'take.webm')])
      expect(cleaned, 'the scratch is the file the studio opens').toEqual([])
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('a file whose length was known is probed ONCE too', async () => {
    probeResult = async () => ({ duration: 600, hasVideo: true })
    await extract()
    expect(probed).toEqual([VIDEO])
  })
})
