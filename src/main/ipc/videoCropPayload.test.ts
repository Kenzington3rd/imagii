import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { userFacingError } from '../../shared/userFacingError'
import { newTextOverlay } from '../../shared/textOverlay'

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
const extractFrame = vi.fn(async (_source: string, _timeSec: number, outputPath: string, _crop?: unknown) => ({ outputPath }))

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
vi.mock('../ffmpeg/frame', () => ({
  extractFrame: (...args: [string, number, string, unknown]) => extractFrame(...args),
  makeKitDir: vi.fn(),
  removeKitDir: vi.fn(),
  cancelAllFrameJobs: vi.fn()
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
  return handler({ sender: { isDestroyed: () => false, send: vi.fn() } }, params)
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
  extractFrame.mockClear()
  handlers.clear()
  registerVideoIpc()
})

// T-109: the refusal is ONE plain sentence on all three paths (the platform export's batch
// already spoke it, T-106). The validator's own message — a path into the payload — is for
// main's console, which is where the second column is read from.
const SENTENCE = "One of this project's clips has a damaged crop — redraw it and try again."
// T-113: the rest of a clip's recipe (speed, grade, effects, text) speaks the batch's sentence on Compile too.
// Compile used to throw the validator's path-shaped message, which reached the person as "Compilation failed."
const CLIP_SENTENCE =
  "One of this project's clips has a setting imagii can't use — check its speed, color and text, then try again."

/** Run `go` with console.error captured; hand back what it threw and what was logged. */
async function refusal(go: () => Promise<unknown>): Promise<{ err: unknown; logged: string }> {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const err = await go().then(
      () => null,
      (e: unknown) => e
    )
    return { err, logged: String(spy.mock.calls[0]?.[1]) }
  } finally {
    spy.mockRestore()
  }
}

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

  it.each(BAD_CROPS)('refuses %s with the plain sentence, before the runner is touched', async (_l, crop, detail) => {
    const { err, logged } = await refusal(() => concat({ cropRect: crop }))
    expect((err as Error).message).toBe(SENTENCE)
    // The detail is not lost: main's console names the segment and the field.
    expect(logged).toMatch(detail)
    expect(logged).toMatch(/segments\[0\]\.cropRect/)
    expect(runConcat).not.toHaveBeenCalled()
  })

  it('checks every segment, not just the first', async () => {
    const { err, logged } = await refusal(() =>
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
    )
    expect((err as Error).message).toBe(SENTENCE)
    expect(logged).toMatch(/segments\[1\]\.cropRect/)
    expect(runConcat).not.toHaveBeenCalled()
  })

  it('reaches the person as that sentence alone, through Electron\'s envelope', () => {
    const wrapped = new Error(`Error invoking remote method 'video:concat': Error: ${SENTENCE}`)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(userFacingError(wrapped, 'Compilation failed.')).toEqual({ cancelled: false, message: SENTENCE })
    } finally {
      logged.mockRestore()
    }
  })

  it('the rest of the recipe speaks its own plain sentence too (T-113), the field kept for the console', async () => {
    const { err, logged } = await refusal(() => concat({ speedMultiplier: 0 }))
    expect((err as Error).message).toBe(CLIP_SENTENCE)
    expect(logged).toMatch(/segments\[0\]\.speedMultiplier/)
  })
})

// T-105: the segment carries the clip's whole recipe now, and every field of it
// becomes part of an ffmpeg filter string — checked here, before any process.
describe('video:concat segment recipe (T-105)', () => {
  const GRADE = { brightness: 0.1, contrast: 1.2, saturation: 0.8, temperature: 0.5 }
  const OVERLAY = {
    id: 'o1',
    text: 'GG',
    font: 'Arial',
    sizePx: 48,
    colorHex: '#ff3b30',
    x: 0.1,
    y: 0.8,
    startSec: 1,
    endSec: 2
  }
  const RECIPE = {
    cropRect: GOOD_CROP,
    speedMultiplier: 2,
    colorGrade: GRADE,
    autoZoom: true,
    hypeShake: true,
    textOverlays: [OVERLAY]
  }

  it('hands a whole recipe to the runner untouched, field by field', async () => {
    await expect(concat(RECIPE)).resolves.toEqual({ outputPath: '/out/compilation.mp4' })
    const call = (runConcat.mock.calls[0] as unknown[])[0] as { segments: Array<Record<string, unknown>> }
    expect(call.segments[0]).toMatchObject(RECIPE)
  })

  it('a segment with only its range still compiles — the clip at 1x with nothing on it', async () => {
    await expect(concat({})).resolves.toBeDefined()
    expect(runConcat).toHaveBeenCalledTimes(1)
  })

  const BAD: Array<[string, Record<string, unknown>, RegExp]> = [
    ['a speed of zero', { speedMultiplier: 0 }, /segments\[0\]\.speedMultiplier/],
    ['a speed as a string', { speedMultiplier: '2' }, /segments\[0\]\.speedMultiplier/],
    ['a grade with NaN in it', { colorGrade: { ...GRADE, contrast: Number.NaN } }, /segments\[0\]\.colorGrade\.contrast/],
    ['a grade past what ffmpeg takes', { colorGrade: { ...GRADE, temperature: 9 } }, /colorGrade\.temperature/],
    ['an effect flag that is not a boolean', { autoZoom: 'on' }, /segments\[0\]\.autoZoom/],
    ['an overlay with a filter injection in its color', { textOverlays: [{ ...OVERLAY, colorHex: 'red,movie=x' }] }, /segments\[0\]\.textOverlays\[0\] malformed/],
    ['overlays that are not a list', { textOverlays: { text: 'GG' } }, /segments\[0\]\.textOverlays must be an array/]
  ]

  it.each(BAD)('refuses %s with the plain sentence, the segment named in the console, before the runner is touched', async (_l, recipe, detail) => {
    const { err, logged } = await refusal(() => concat(recipe))
    expect((err as Error).message).toBe(CLIP_SENTENCE)
    expect(logged).toMatch(detail)
    expect(runConcat).not.toHaveBeenCalled()
  })

  it('checks every segment, not just the first', async () => {
    const { err, logged } = await refusal(() =>
      call('video:concat', {
        sourcePath: source,
        outDir,
        segments: [
          { startSec: 0, endSec: 2, name: 'ok', ...RECIPE },
          { startSec: 3, endSec: 5, name: 'bad', speedMultiplier: -1 }
        ],
        fadeMs: 0,
        width: 1920,
        height: 1080
      })
    )
    expect((err as Error).message).toBe(CLIP_SENTENCE)
    expect(logged).toMatch(/segments\[1\]\.speedMultiplier/)
    expect(runConcat).not.toHaveBeenCalled()
  })

  it('reaches the person as that sentence alone, through Electron\'s envelope (not "Compilation failed.")', () => {
    const wrapped = new Error(`Error invoking remote method 'video:concat': Error: ${CLIP_SENTENCE}`)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(userFacingError(wrapped, 'Compilation failed.')).toEqual({ cancelled: false, message: CLIP_SENTENCE })
    } finally {
      logged.mockRestore()
    }
  })

  it('a segment carrying the overlay "+ Add text" stores untouched compiles (T-113: its color used to be the name "white")', async () => {
    await expect(concat({ textOverlays: [{ id: 'o-default', ...newTextOverlay(0, 2) }] })).resolves.toEqual({
      outputPath: '/out/compilation.mp4'
    })
    expect(runConcat).toHaveBeenCalledTimes(1)
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

  it.each(BAD_CROPS)('refuses %s with the plain sentence, before the runner is touched', async (_l, crop, detail) => {
    const { err, logged } = await refusal(() => gif({ cropRect: crop }))
    expect((err as Error).message).toBe(SENTENCE)
    expect(logged).toMatch(detail)
    expect(logged).toMatch(/cropRect/)
    expect(runGifExport).not.toHaveBeenCalled()
  })

  it('reaches the person as that sentence alone, through Electron\'s envelope', () => {
    const wrapped = new Error(`Error invoking remote method 'video:exportGif': Error: ${SENTENCE}`)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(userFacingError(wrapped, 'GIF export failed.')).toEqual({ cancelled: false, message: SENTENCE })
    } finally {
      logged.mockRestore()
    }
  })
})

// T-125 (22): a compilation is named for the video the person opened, not for the working copy a converted import is played from
// (`stream-aB3dE5fG_compilation.mp4`, executed): the same scratch-name bug Reframe and the GIF had until T-124 (17).
describe('video:concat carries the display name of the video (T-125 (22))', () => {
  const lastConcatSpec = (): Record<string, unknown> => {
    const calls = runConcat.mock.calls as unknown as Array<[Record<string, unknown>]>
    return (calls[calls.length - 1] ?? [{}])[0]
  }
  const withName = (extra: Record<string, unknown>): Promise<unknown> =>
    call('video:concat', {
      jobId: 'job-1',
      sourcePath: source,
      outDir,
      segments: [{ startSec: 0, endSec: 2, name: 'a' }],
      fadeMs: 0,
      width: 1920,
      height: 1080,
      ...extra
    })

  it('hands the runner the sanitized display name', async () => {
    await withName({ sourceName: 'stream' })
    expect(lastConcatSpec().sourceName).toBe('stream')
  })

  it('sanitizes it, because the runner joins it into a path', async () => {
    await withName({ sourceName: '..\\..\\evil/name: *?"<>|' })
    expect(String(lastConcatSpec().sourceName)).not.toMatch(/[\\/:*?"<>|]/)
  })

  it.each([undefined, '', '   ', 5, null])('%s passes none: the runner falls back to the source file\'s own name', async (sourceName) => {
    await withName({ sourceName })
    expect(lastConcatSpec().sourceName).toBeUndefined()
  })
})

// T-130 (t): a Clip Kit thumbnail is the clip's crop, so video:extractFrame carries it. It becomes `crop=` in an ffmpeg filter string like the
// other four paths' crops, so it is refused in the same one sentence before the runner (and its probe) is touched, and a good one, no
// crop and an absent one all reach the runner as the fourth argument it takes.
describe('video:extractFrame carries the clip\'s crop (T-130 (t))', () => {
  const frame = (extra: Record<string, unknown>): Promise<unknown> =>
    call('video:extractFrame', { sourcePath: source, timeSec: 1.5, outputPath: path.join(outDir, 'thumb.jpg'), ...extra })

  it('hands a good crop to the runner untouched, and no crop (null or absent) as null', async () => {
    await frame({ cropRect: GOOD_CROP })
    await frame({ cropRect: null })
    await frame({})
    expect(extractFrame.mock.calls.map((c) => c[3])).toEqual([GOOD_CROP, null, null])
    expect(extractFrame.mock.calls[0]?.slice(0, 3)).toEqual([source, 1.5, path.join(outDir, 'thumb.jpg')])
  })

  it.each(BAD_CROPS)('refuses %s with the plain sentence, before the runner is touched', async (_l, crop, detail) => {
    const { err, logged } = await refusal(() => frame({ cropRect: crop }))
    expect((err as Error).message).toBe(SENTENCE)
    expect(logged).toMatch(detail)
    expect(extractFrame).not.toHaveBeenCalled()
  })

  it('reaches the person as that sentence alone, through Electron\'s envelope', () => {
    const wrapped = new Error(`Error invoking remote method 'video:extractFrame': Error: ${SENTENCE}`)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(userFacingError(wrapped, 'Clip Kit failed.')).toEqual({ cancelled: false, message: SENTENCE })
    } finally {
      logged.mockRestore()
    }
  })
})
