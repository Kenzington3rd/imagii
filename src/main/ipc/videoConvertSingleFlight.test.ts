import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { userFacingError } from '../../shared/userFacingError'

/**
 * T-136 (2) - `video:convertForImport` is single-flight in main, and says which file is being converted.
 *
 * Three renderer callers share the channel - the Importer's flv / ts / wmv / mpg transcode, the Player's "Make a preview copy", and the project open's
 * re-convert - and each kept its own busy flag in the component, so a trip to Home re-armed it over a transcode main was still running. A second
 * press ran a SECOND libx264 (executed: two encodes fighting for the CPU) whose landing replaced the video being edited. The guard goes where every
 * caller goes through, the handler, as `audio:extractFromVideo`'s does (`audioExtractSingleFlight.test.ts`): a second start is refused in a finished
 * sentence naming the file that is running; the slot is claimed before the handler's first await and given back in a `finally`. The real handler runs
 * here; the conversion is the stand-in.
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
const converted: string[] = []
let conversion: Promise<string> = Promise.resolve('/tmp/imagii-import/a.mp4')

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
vi.mock('../ffmpeg/convert', () => ({
  convertForImport: (file: string) => {
    converted.push(file)
    return conversion
  }
}))

const { registerVideoIpc } = await import('./video')

const FLV = path.join(tmpdir(), 'saturday-stream.flv')
const OTHER = path.join(tmpdir(), 'friday-stream.wmv')
const convert = (file: string): Promise<unknown> => {
  const handler = handlers.get('video:convertForImport')
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
const COPY = '/tmp/imagii-import/a.mp4'

beforeEach(() => {
  converted.length = 0
  conversion = Promise.resolve(COPY)
  handlers.clear()
  // Per registration: a fresh gate, as the handler's comment says.
  registerVideoIpc()
})

describe('video:convertForImport - one conversion at a time (T-136 (2))', () => {
  it('a second start while one runs is refused, naming the file that is running, and starts nothing', async () => {
    const held = gate<string>()
    conversion = held.promise
    const first = convert(FLV)
    await expect(convert(OTHER)).rejects.toThrow('Still converting "saturday-stream.flv". Wait for it to finish, then try again.')
    expect(converted, 'the second never reached the converter').toEqual([FLV])
    held.resolve(COPY)
    await expect(first).resolves.toBe(COPY)
  })

  it('the same file again is refused too (a double press, or a preview copy asked while the importer converts it)', async () => {
    const held = gate<string>()
    conversion = held.promise
    const first = convert(FLV)
    await expect(convert(FLV)).rejects.toThrow(/^Still converting "saturday-stream.flv"/)
    held.resolve(COPY)
    await first
    expect(converted).toEqual([FLV])
  })

  it('the slot is claimed before the handler\'s first await: two starts in the same breath run one', async () => {
    const held = gate<string>()
    conversion = held.promise
    const both = await Promise.allSettled([convert(FLV), convert(OTHER), (async () => { held.resolve(COPY) })()])
    expect(both.map((r) => r.status).slice(0, 2).sort()).toEqual(['fulfilled', 'rejected'])
    expect(converted).toHaveLength(1)
  })

  it('the slot comes back when the conversion finishes', async () => {
    await convert(FLV)
    await expect(convert(OTHER)).resolves.toBe(COPY)
    expect(converted).toEqual([FLV, OTHER])
  })

  it('and when it fails or is canceled (a refused start is retryable)', async () => {
    conversion = Promise.reject(new Error('convert-to-mp4 exit 1: Invalid data found when processing input'))
    await expect(convert(FLV)).rejects.toThrow(/exit 1/)
    conversion = Promise.resolve(COPY)
    await expect(convert(FLV)).resolves.toBe(COPY)
  })

  it('a refused start does not give the running one\'s slot away: a third start is refused until the first ends', async () => {
    const held = gate<string>()
    conversion = held.promise
    const first = convert(FLV)
    await expect(convert(OTHER)).rejects.toThrow(/Still converting/)
    await expect(convert(OTHER)).rejects.toThrow(/Still converting/)
    held.resolve(COPY)
    await first
    conversion = Promise.resolve(COPY)
    await expect(convert(OTHER)).resolves.toBe(COPY)
  })

  it('a path the handler refuses at the boundary never takes the slot', async () => {
    await expect(convert('relative/path.flv')).rejects.toThrow()
    await expect(convert(FLV)).resolves.toBe(COPY)
    expect(converted).toEqual([FLV])
  })

  it('the refusal is a finished sentence that userFacingError lets stand through Electron\'s envelope', async () => {
    const held = gate<string>()
    conversion = held.promise
    const first = convert(FLV)
    const err = await convert(OTHER).then(() => null, (e: Error) => e)
    expect(err).not.toBeNull()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const wrapped = new Error(`Error invoking remote method 'video:convertForImport': Error: ${err?.message}`)
      expect(userFacingError(wrapped, "Couldn't open that video.").message).toBe(err?.message)
    } finally {
      vi.restoreAllMocks()
    }
    held.resolve(COPY)
    await first
  })

  it('a long file name is quoted by code point, cut to one line', async () => {
    const held = gate<string>()
    conversion = held.promise
    const long = path.join(tmpdir(), `${'🎮'.repeat(80)}.flv`)
    const first = convert(long)
    const err = await convert(OTHER).then(() => null, (e: Error) => e)
    expect(err?.message.length).toBeLessThanOrEqual(240)
    expect(err?.message).toMatch(/…"\. Wait for it/)
    expect(err?.message).not.toMatch(/[\uD800-\uDBFF]"/)
    held.resolve(COPY)
    await first
  })
})
