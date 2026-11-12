import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { userFacingError } from '../../shared/userFacingError'
import { CancelledError } from '../../shared/cancel'

/**
 * T-138 (9) - `video:findHighlights` is single-flight in main, and says which video is being scanned.
 *
 * `highlights.ts` keeps ONE `activeScan` slot, and the handler had no claim of its own: the panel's "Scan VOD" is off while the renderer's
 * `useScanRun` holds a run, but a renderer reload (the render-process-gone auto-reload, Ctrl+R) starts a fresh store over a scan main is still running.
 * A second press then ran a SECOND ffmpeg, the slot was overwritten, Cancel reached only the newest, and the older survived `app.quit()` (executed in
 * the built app: PPID 1). The guard goes where every caller goes through, the handler, as `video:convertForImport`'s and `audio:extractFromVideo`'s do:
 * a second start is refused in a finished sentence naming the video that is being scanned; the slot is claimed before the handler's first await and given
 * back in a `finally`. The real handler runs here; the scan is the stand-in.
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
const scanned: string[] = []
const hooked: string[] = []
let scan: Promise<unknown[]> = Promise.resolve([])

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
vi.mock('../ffmpeg/highlights', () => ({
  findHighlights: (_jobId: string, file: string) => {
    scanned.push(file)
    return scan
  },
  analyzeClipHook: async (file: string) => {
    hooked.push(file)
    return { audioEnergyDb: -20 }
  },
  cancelActiveHighlightScan: () => false
}))

const { registerVideoIpc } = await import('./video')

const VOD = path.join(tmpdir(), 'saturday-stream.mp4')
const OTHER = path.join(tmpdir(), 'friday-stream.mkv')
const call = (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return handler({ sender: { isDestroyed: () => true } }, ...args)
}
const findHighlights = (file: string): Promise<unknown> => call('video:findHighlights', file)
function gate<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve: (v: T) => void = () => undefined
  let reject: (e: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const FOUND = [{ startSec: 1, endSec: 5, peakDb: -10, reason: 'loud' }]

beforeEach(() => {
  scanned.length = 0
  hooked.length = 0
  scan = Promise.resolve([])
  handlers.clear()
  // Per registration: a fresh gate, as the handler's comment says.
  registerVideoIpc()
})

describe('video:findHighlights - one scan at a time (T-138 (9))', () => {
  it('a second start while one runs is refused, naming the video that is being scanned, and starts nothing', async () => {
    const held = gate<unknown[]>()
    scan = held.promise
    const first = findHighlights(VOD)
    await expect(findHighlights(OTHER)).rejects.toThrow('Still scanning "saturday-stream.mp4" for highlights. Wait for it to finish, then try again.')
    expect(scanned, 'the second never reached the scanner').toEqual([VOD])
    held.resolve(FOUND)
    await expect(first).resolves.toEqual(FOUND)
  })

  it('the same video again is refused too (a reloaded panel is fresh, the scan main runs is not)', async () => {
    const held = gate<unknown[]>()
    scan = held.promise
    const first = findHighlights(VOD)
    await expect(findHighlights(VOD)).rejects.toThrow(/^Still scanning "saturday-stream.mp4" for highlights\./)
    held.resolve(FOUND)
    await first
    expect(scanned).toEqual([VOD])
  })

  it('the slot is claimed before the handler\'s first await: two starts in the same breath run one', async () => {
    const held = gate<unknown[]>()
    scan = held.promise
    const both = await Promise.allSettled([findHighlights(VOD), findHighlights(OTHER), (async () => { held.resolve(FOUND) })()])
    expect(both.map((r) => r.status).slice(0, 2).sort()).toEqual(['fulfilled', 'rejected'])
    expect(scanned).toHaveLength(1)
  })

  it('the slot comes back when the scan finishes', async () => {
    scan = Promise.resolve(FOUND)
    await expect(findHighlights(VOD)).resolves.toEqual(FOUND)
    await expect(findHighlights(OTHER)).resolves.toEqual(FOUND)
    expect(scanned).toEqual([VOD, OTHER])
  })

  it('and when it fails (a refused start is retryable)', async () => {
    scan = Promise.reject(new Error('ebur128 exit 1'))
    await expect(findHighlights(VOD)).rejects.toThrow(/ebur128 exit 1/)
    scan = Promise.resolve(FOUND)
    await expect(findHighlights(VOD)).resolves.toEqual(FOUND)
  })

  it('and when it is canceled', async () => {
    const held = gate<unknown[]>()
    scan = held.promise
    const first = findHighlights(VOD)
    await expect(findHighlights(OTHER)).rejects.toThrow(/Still scanning/)
    held.reject(new CancelledError())
    await expect(first).rejects.toThrow(/imagii:cancelled/)
    scan = Promise.resolve(FOUND)
    await expect(findHighlights(OTHER)).resolves.toEqual(FOUND)
    expect(scanned).toEqual([VOD, OTHER])
  })

  it('a refused start does not give the running one\'s slot away: a third start is refused until the first ends', async () => {
    const held = gate<unknown[]>()
    scan = held.promise
    const first = findHighlights(VOD)
    await expect(findHighlights(OTHER)).rejects.toThrow(/Still scanning/)
    await expect(findHighlights(OTHER)).rejects.toThrow(/Still scanning/)
    held.resolve(FOUND)
    await first
    scan = Promise.resolve(FOUND)
    await expect(findHighlights(OTHER)).resolves.toEqual(FOUND)
  })

  it('a path the handler refuses at the boundary never takes the slot', async () => {
    await expect(findHighlights('relative/path.mp4')).rejects.toThrow()
    await expect(findHighlights('')).rejects.toThrow()
    await expect(findHighlights(VOD)).resolves.toEqual([])
    expect(scanned).toEqual([VOD])
  })

  it('the refusal is a finished sentence that userFacingError lets stand through Electron\'s envelope', async () => {
    const held = gate<unknown[]>()
    scan = held.promise
    const first = findHighlights(VOD)
    const err = await findHighlights(OTHER).then(() => null, (e: Error) => e)
    expect(err).not.toBeNull()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const wrapped = new Error(`Error invoking remote method 'video:findHighlights': Error: ${err?.message}`)
      expect(userFacingError(wrapped, 'Scan failed.').message).toBe('Still scanning "saturday-stream.mp4" for highlights. Wait for it to finish, then try again.')
    } finally {
      vi.restoreAllMocks()
    }
    held.resolve(FOUND)
    await first
  })

  it('a long file name is quoted by code point, cut to one line', async () => {
    const held = gate<unknown[]>()
    scan = held.promise
    const long = path.join(tmpdir(), `${'\u{1F3AE}'.repeat(80)}.mp4`)
    const first = findHighlights(long)
    const err = await findHighlights(OTHER).then(() => null, (e: Error) => e)
    expect(err?.message.length).toBeLessThanOrEqual(240)
    expect(err?.message).toMatch(/…" for highlights\. Wait for it/)
    expect(err?.message).not.toMatch(/[\uD800-\uDBFF]"/)
    held.resolve(FOUND)
    await first
  })

  it('the claim is the scan\'s alone: a clip\'s hook analysis (its own superseding pass) is not refused while a scan runs', async () => {
    const held = gate<unknown[]>()
    scan = held.promise
    const first = findHighlights(VOD)
    await expect(call('video:analyzeClipHook', { sourcePath: VOD, startSec: 0 })).resolves.toEqual({ audioEnergyDb: -20 })
    expect(hooked).toEqual([VOD])
    held.resolve(FOUND)
    await first
  })
})
