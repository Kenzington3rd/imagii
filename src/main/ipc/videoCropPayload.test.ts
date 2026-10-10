import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import { tmpdir } from 'node:os'

// T-96: video:concat and video:exportGif now carry the clip's crop, and the
// crop becomes `crop=` arguments in an ffmpeg filter string — so both handlers
// refuse a malformed one at the IPC boundary, before any ffmpeg is spawned,
// and hand a good one to the runner untouched. Driven through a captured
// ipcMain.handle with the two runners mocked (the captionsBurnIn.test.ts
// technique): "rejected" and "runner never called" are the two halves of
// "before any work". Layer 5 runs the real runners.
const handlers = new Map<string, (e: unknown, req: unknown) => Promise<unknown>>()
const runConcat = vi.fn(async () => ({ outputPath: '/out/compilation.mp4' }))
const runGifExport = vi.fn(async () => ({ outputPath: '/out/clip.gif' }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, req: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  },
  dialog: {},
  BrowserWindow: {},
  shell: {},
  app: { getPath: () => tmpdir() }
}))
vi.mock('../ffmpeg/concat', () => ({
  runConcat: (...args: unknown[]) => (runConcat as (...a: unknown[]) => unknown)(...args),
  runPipComposite: vi.fn(),
  cancelConcatJob: vi.fn()
}))
vi.mock('../ffmpeg/gif', () => ({
  runGifExport: (...args: unknown[]) => (runGifExport as (...a: unknown[]) => unknown)(...args),
  cancelGifJob: vi.fn()
}))

const { registerVideoIpc } = await import('./video')

const source = path.join(tmpdir(), 'in.mp4')
const outDir = tmpdir()
const GOOD_CROP = { x: 0.25, y: 0.1, w: 0.5, h: 0.8 }

const call = (channel: string, params: Record<string, unknown>): Promise<unknown> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`${channel} was not registered`)
  return handler({ sender: { send: vi.fn() } }, params)
}
const concat = (segment: Record<string, unknown>): Promise<unknown> =>
  call('video:concat', {
    jobId: 'job-1',
    sourcePath: source,
    outDir,
    segments: [{ startSec: 0, endSec: 2, name: 'a', ...segment }],
    fadeMs: 0,
    width: 1920,
    height: 1080
  })
const gif = (extra: Record<string, unknown>): Promise<unknown> =>
  call('video:exportGif', {
    jobId: 'job-1',
    sourcePath: source,
    outDir,
    startSec: 0,
    endSec: 3,
    width: 480,
    fps: 15,
    speed: 1,
    ...extra
  })

beforeEach(() => {
  runConcat.mockClear()
  runGifExport.mockClear()
  handlers.clear()
  registerVideoIpc()
})

const BAD_CROPS: Array<[string, unknown, RegExp]> = [
  ['a string', '0,0,1,1', /plain object/],
  ['an array', [0, 0, 1, 1], /plain object/],
  ['a missing field', { x: 0, y: 0, w: 0.5 }, /\.h/],
  ['a numeric string', { ...GOOD_CROP, x: '0.25' }, /\.x/],
  ['NaN', { ...GOOD_CROP, w: Number.NaN }, /\.w/],
  ['an infinite height', { ...GOOD_CROP, h: Number.POSITIVE_INFINITY }, /\.h/],
  ['no area', { ...GOOD_CROP, w: 0 }, /\.w/],
  ['a negative origin', { ...GOOD_CROP, y: -0.2 }, /\.y/],
  ['a thousand-times-the-frame width', { ...GOOD_CROP, w: 1000 }, /\.w/],
  ['a rectangle past the right edge', { x: 0.6, y: 0, w: 0.6, h: 1 }, /right edge/]
]

describe('video:concat segment crops (T-96)', () => {
  it('hands a good crop, no crop and an absent crop to the runner untouched', async () => {
    await expect(concat({ cropRect: GOOD_CROP })).resolves.toEqual({ outputPath: '/out/compilation.mp4' })
    await expect(concat({ cropRect: null })).resolves.toBeDefined()
    await expect(concat({})).resolves.toBeDefined()
    expect(runConcat).toHaveBeenCalledTimes(3)
    const first = (runConcat.mock.calls[0] as unknown[])[0] as {
      segments: Array<{ cropRect?: unknown }>
    }
    expect(first.segments[0]?.cropRect).toEqual(GOOD_CROP)
  })

  it.each(BAD_CROPS)('refuses %s, naming the segment, before the runner is touched', async (_l, crop, message) => {
    await expect(concat({ cropRect: crop })).rejects.toThrow(message)
    await expect(concat({ cropRect: crop })).rejects.toThrow(/segments\[0\]\.cropRect/)
    expect(runConcat).not.toHaveBeenCalled()
  })

  it('checks every segment, not just the first', async () => {
    await expect(
      call('video:concat', {
        sourcePath: source,
        outDir,
        segments: [
          { startSec: 0, endSec: 2, name: 'ok', cropRect: GOOD_CROP },
          { startSec: 3, endSec: 5, name: 'bad', cropRect: { ...GOOD_CROP, w: Number.NaN } }
        ],
        fadeMs: 0,
        width: 1920,
        height: 1080
      })
    ).rejects.toThrow(/segments\[1\]\.cropRect/)
    expect(runConcat).not.toHaveBeenCalled()
  })
})

describe('video:exportGif crop (T-96)', () => {
  it('hands a good crop, no crop and an absent crop to the runner untouched', async () => {
    await expect(gif({ cropRect: GOOD_CROP })).resolves.toEqual({ outputPath: '/out/clip.gif' })
    await expect(gif({ cropRect: null })).resolves.toBeDefined()
    await expect(gif({})).resolves.toBeDefined()
    expect(runGifExport).toHaveBeenCalledTimes(3)
    const first = (runGifExport.mock.calls[0] as unknown[])[0] as { cropRect?: unknown }
    expect(first.cropRect).toEqual(GOOD_CROP)
  })

  it.each(BAD_CROPS)('refuses %s before the runner is touched', async (_l, crop, message) => {
    await expect(gif({ cropRect: crop })).rejects.toThrow(message)
    await expect(gif({ cropRect: crop })).rejects.toThrow(/cropRect/)
    expect(runGifExport).not.toHaveBeenCalled()
  })
})
