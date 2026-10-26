import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { userFacingError } from '../../shared/userFacingError'

/**
 * T-135 (1) - `audio:extractFromVideo` is single-flight in main, and says which video is being worked on.
 *
 * Clean audio's button state was the studio's `useState`, so a trip to Home re-armed it over an extraction that was still running, and a second
 * press ran a SECOND concurrent extraction (two ffmpegs writing two scratch WAVs of up to gigabytes, whose completions cross-talk in the renderer).
 * Audio Studio's own importer takes the same channel, so the guard goes where every caller goes through: the handler. A second start is refused in a
 * finished sentence naming the video that is running; the slot is claimed before the handler's first await and given back in a `finally`.
 * The real handler runs here; the probe and the extraction are the stand-ins.
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
const probed: string[] = []
const extracted: string[] = []
let extraction: Promise<{ wavPath: string; cleanup: () => Promise<void> }> = Promise.resolve({ wavPath: '/tmp/imagii-audio/a.wav', cleanup: async () => undefined })

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
    return { duration: 60, hasVideo: true }
  }
}))
vi.mock('../audio/extract', () => ({
  extractAudioFromVideo: (file: string) => {
    extracted.push(file)
    return extraction
  }
}))

const { registerAudioIpc } = await import('./audio')
registerAudioIpc()

const VOD = path.join(tmpdir(), 'saturday-stream.mp4')
const OTHER = path.join(tmpdir(), 'friday-stream.mp4')
const extract = (file: string): Promise<unknown> => {
  const handler = handlers.get('audio:extractFromVideo')
  if (!handler) throw new Error('no handler')
  return handler({}, file)
}
function gate<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve: (v: T) => void = () => undefined
  let reject: (e: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const SOUND = { wavPath: '/tmp/imagii-audio/a.wav', cleanup: async () => undefined }

beforeEach(() => {
  probed.length = 0
  extracted.length = 0
  extraction = Promise.resolve(SOUND)
})

describe('audio:extractFromVideo - one extraction at a time (T-135 (1))', () => {
  it('a second start while one runs is refused, naming the video that is running, and starts nothing', async () => {
    const held = gate<typeof SOUND>()
    extraction = held.promise
    const first = extract(VOD)
    await expect(extract(OTHER)).rejects.toThrow('Still extracting the sound from "saturday-stream.mp4". Wait for it to finish, then try again.')
    expect(extracted, 'the second never reached the extractor').toEqual([VOD])
    expect(probed, 'nor the probe').toEqual([VOD])
    held.resolve(SOUND)
    await first
  })

  it('the same video again is refused too (a double press of Clean audio)', async () => {
    const held = gate<typeof SOUND>()
    extraction = held.promise
    const first = extract(VOD)
    await expect(extract(VOD)).rejects.toThrow(/^Still extracting the sound from "saturday-stream.mp4"/)
    held.resolve(SOUND)
    await first
    expect(extracted).toEqual([VOD])
  })

  it('the slot is claimed before the handler\'s first await: two starts in the same breath run one', async () => {
    const held = gate<typeof SOUND>()
    extraction = held.promise
    const both = await Promise.allSettled([extract(VOD), extract(OTHER), (async () => { held.resolve(SOUND) })()])
    expect(both.map((r) => r.status).slice(0, 2).sort()).toEqual(['fulfilled', 'rejected'])
    expect(extracted).toHaveLength(1)
  })

  it('the slot comes back when the extraction finishes', async () => {
    await extract(VOD)
    await expect(extract(OTHER)).resolves.toMatchObject({ wavPath: SOUND.wavPath })
    expect(extracted).toEqual([VOD, OTHER])
  })

  it('and when it fails or is canceled (a refused start is retryable)', async () => {
    extraction = Promise.reject(new Error('audio extract exit 1: Invalid data found when processing input'))
    await expect(extract(VOD)).rejects.toThrow(/exit 1/)
    extraction = Promise.resolve(SOUND)
    await expect(extract(VOD)).resolves.toMatchObject({ wavPath: SOUND.wavPath })
  })

  it('and when the probe says the video has no sound (the refusal before any extraction)', async () => {
    const probe = await import('../audio/probe')
    const spy = vi.spyOn(probe, 'probeAudio').mockRejectedValueOnce(new Error('No audio stream found in file'))
    await expect(extract(VOD)).rejects.toThrow(/No audio stream/)
    spy.mockRestore()
    await expect(extract(VOD)).resolves.toMatchObject({ wavPath: SOUND.wavPath })
  })

  it('a refused start does not give the running one\'s slot away: a third start is refused until the first ends', async () => {
    const held = gate<typeof SOUND>()
    extraction = held.promise
    const first = extract(VOD)
    await expect(extract(OTHER)).rejects.toThrow(/Still extracting/)
    await expect(extract(OTHER)).rejects.toThrow(/Still extracting/)
    held.resolve(SOUND)
    await first
    extraction = Promise.resolve(SOUND)
    await expect(extract(OTHER)).resolves.toMatchObject({ wavPath: SOUND.wavPath })
  })

  it('the refusal is a finished sentence that userFacingError lets stand through Electron\'s envelope', async () => {
    const held = gate<typeof SOUND>()
    extraction = held.promise
    const first = extract(VOD)
    const err = await extract(OTHER).then(() => null, (e: Error) => e)
    expect(err).not.toBeNull()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const wrapped = new Error(`Error invoking remote method 'audio:extractFromVideo': Error: ${err?.message}`)
      expect(userFacingError(wrapped, "Couldn't extract the audio.").message).toBe(err?.message)
    } finally {
      vi.restoreAllMocks()
    }
    held.resolve(SOUND)
    await first
  })

  it('a long file name is quoted by code point, cut to one line', async () => {
    const held = gate<typeof SOUND>()
    extraction = held.promise
    const long = path.join(tmpdir(), `${'🎮'.repeat(80)}.mp4`)
    const first = extract(long)
    const err = await extract(OTHER).then(() => null, (e: Error) => e)
    expect(err?.message.length).toBeLessThanOrEqual(240)
    expect(err?.message).toMatch(/…" ?\. Wait for it|…"\. Wait for it/)
    expect(err?.message).not.toMatch(/[\uD800-\uDBFF]"/)
    held.resolve(SOUND)
    await first
  })
})
