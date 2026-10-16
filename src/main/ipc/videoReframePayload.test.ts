import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import { tmpdir } from 'node:os'

/**
 * T-124 (16), (17) - what `video:reframe` and `video:exportGif` take and name.
 *
 * (16) Reframe took only the source, the range, a side and a size, so a clip cropped or sped up was reframed from the whole frame at
 * normal speed (the wrong-file class T-96 and T-105 closed for Compile and the GIF). The handler now carries the clip's crop and
 * speed to the runner, refusing a damaged one in the T-109/T-113 sentences before any ffmpeg exists.
 * (17) Reframe and the GIF named their output from the SCRATCH basename (`stream-aB3dE5fG_reframe-1080x1920-center.mp4`): a
 * converted import is played from an `imagii-import` working copy with a nanoid in its name, and `source.fileName` is the name of the
 * file the person dropped. The name is derived from that, as Export does; the handler sanitizes it, because it is joined into a path.
 *
 * Driven through a captured ipcMain.handle with the two runners mocked (videoCropPayload.test.ts's technique): "rejected" and
 * "runner never called" are the two halves of "before any work". Layer 5 runs the real runners.
 */
const handlers = new Map<string, (e: unknown, req: unknown) => Promise<unknown>>()
const runReframe = vi.fn(async (spec: { outputPath: string }) => ({ outputPath: spec.outputPath }))
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
vi.mock('../ffmpeg/reframe', () => ({
  runReframe: (...args: unknown[]) => (runReframe as (...a: unknown[]) => unknown)(...args),
  cancelReframeJob: vi.fn()
}))
vi.mock('../ffmpeg/gif', () => ({
  runGifExport: (...args: unknown[]) => (runGifExport as (...a: unknown[]) => unknown)(...args),
  cancelGifJob: vi.fn()
}))

const { registerVideoIpc } = await import('./video')

const source = path.join(tmpdir(), 'stream-aB3dE5fG.mp4')
const outDir = tmpdir()
const GOOD_CROP = { x: 0.25, y: 0.1, w: 0.5, h: 0.8 }
const DAMAGED_CROP = "One of this project's clips has a damaged crop — redraw it and try again."
const DAMAGED_CLIP =
  "One of this project's clips has a setting imagii can't use — check its speed, color and text, then try again."

const call = (channel: string, params: Record<string, unknown>): Promise<unknown> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`${channel} was not registered`)
  return handler({ sender: { isDestroyed: () => false, send: vi.fn() } }, params)
}
const reframe = (extra: Record<string, unknown> = {}): Promise<unknown> =>
  call('video:reframe', {
    jobId: 'job-1',
    sourcePath: source,
    outDir,
    position: 'center',
    startSec: 0,
    endSec: 3,
    targetWidth: 1080,
    targetHeight: 1920,
    ...extra
  })
const gif = (extra: Record<string, unknown> = {}): Promise<unknown> =>
  call('video:exportGif', { jobId: 'job-1', sourcePath: source, outDir, startSec: 0, endSec: 3, width: 480, fps: 15, speed: 1, ...extra })

const lastReframeSpec = (): Record<string, unknown> => {
  const calls = runReframe.mock.calls as unknown as Array<[Record<string, unknown>]>
  return (calls[calls.length - 1] ?? [{}])[0]
}

beforeEach(() => {
  runReframe.mockClear()
  runGifExport.mockClear()
  handlers.clear()
  registerVideoIpc()
})

async function refusal(go: () => Promise<unknown>): Promise<unknown> {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    return await go().then(
      () => null,
      (e: unknown) => e
    )
  } finally {
    spy.mockRestore()
  }
}

describe('video:reframe carries the clip\'s crop and speed (T-124 (16))', () => {
  it('hands a good crop and a speed to the runner untouched', async () => {
    await reframe({ cropRect: GOOD_CROP, speedMultiplier: 2 })
    expect(lastReframeSpec()).toMatchObject({ cropRect: GOOD_CROP, speedMultiplier: 2, position: 'center', startSec: 0, endSec: 3 })
  })

  it('no crop and no speed is what it always was: both are absent or null', async () => {
    await reframe()
    expect(lastReframeSpec().cropRect).toBeUndefined()
    expect(lastReframeSpec().speedMultiplier).toBeUndefined()
    await reframe({ cropRect: null, speedMultiplier: 1 })
    expect(lastReframeSpec()).toMatchObject({ cropRect: null, speedMultiplier: 1 })
  })

  it.each([
    ['a string', '0,0,1,1'],
    ['an array', [0, 0, 1, 1]],
    ['NaN', { ...GOOD_CROP, w: Number.NaN }],
    ['no area', { ...GOOD_CROP, w: 0 }],
    ['a rectangle past the right edge', { x: 0.6, y: 0, w: 0.6, h: 1 }]
  ])('a damaged crop (%s) is refused in one plain sentence before the runner is touched', async (_label, cropRect) => {
    const err = await refusal(() => reframe({ cropRect }))
    expect((err as Error).message).toBe(DAMAGED_CROP)
    expect(runReframe).not.toHaveBeenCalled()
  })

  it.each([0, -1, 11, 1e-6, Number.NaN, Number.POSITIVE_INFINITY, '2'])('a speed of %s is refused in the clip sentence before the runner is touched', async (speedMultiplier) => {
    const err = await refusal(() => reframe({ speedMultiplier }))
    expect((err as Error).message).toBe(DAMAGED_CLIP)
    expect(runReframe).not.toHaveBeenCalled()
  })

  it('the speed range is the clip recipe\'s (0.1 to 10), edges included', async () => {
    await reframe({ speedMultiplier: 0.1 })
    await reframe({ speedMultiplier: 10 })
    expect(runReframe).toHaveBeenCalledTimes(2)
  })
})

describe('video:reframe carries the clip\'s whole recipe, checked at the boundary like Compile\'s segments (T-125 (9))', () => {
  const OVERLAY = { id: 'o1', text: 'HOOK', font: 'Arial', sizePx: 48, colorHex: '#ff3b30', x: 0.1, y: 0.1, startSec: 1, endSec: 2 }
  const GRADE = { brightness: 0.1, contrast: 1.1, saturation: 0.9, temperature: 0.2 }

  it('hands the text, the grade, Auto Zoom and Hype Shake to the runner untouched', async () => {
    await reframe({ textOverlays: [OVERLAY], colorGrade: GRADE, autoZoom: true, hypeShake: false })
    expect(lastReframeSpec()).toMatchObject({ textOverlays: [OVERLAY], colorGrade: GRADE, autoZoom: true, hypeShake: false })
  })

  it('a reframe with none of them is what it was: all four are absent', async () => {
    await reframe()
    for (const field of ['textOverlays', 'colorGrade', 'autoZoom', 'hypeShake']) expect(lastReframeSpec()[field], field).toBeUndefined()
  })

  it.each([
    ['an overlay color built to inject a filter', { textOverlays: [{ ...OVERLAY, colorHex: 'white,movie=/etc/passwd' }] }],
    ['an overlay with a size outside 8-512', { textOverlays: [{ ...OVERLAY, sizePx: 9000 }] }],
    ['text overlays that are not a list', { textOverlays: 'HOOK' }],
    ['a grade with a NaN', { colorGrade: { ...GRADE, brightness: Number.NaN } }],
    ['a grade out of range', { colorGrade: { ...GRADE, saturation: 40 } }],
    ['Auto Zoom that is not true or false', { autoZoom: 'yes' }],
    ['Hype Shake that is not true or false', { hypeShake: 1 }]
  ])('%s is refused in the clip sentence before the runner is touched', async (_label, extra) => {
    const err = await refusal(() => reframe(extra))
    expect((err as Error).message).toBe(DAMAGED_CLIP)
    expect(runReframe).not.toHaveBeenCalled()
  })
})

describe('Reframe and the GIF are named for the file the person dropped (T-124 (17))', () => {
  it('Reframe: the name comes from sourceName, not from the working copy\'s', async () => {
    await reframe({ sourceName: 'stream' })
    expect(path.basename(String(lastReframeSpec().outputPath))).toBe('stream_reframe-1080x1920-center.mp4')
    expect(String(lastReframeSpec().outputPath)).not.toContain('aB3dE5fG')
  })

  it('Reframe: with no sourceName the scratch basename is used (a plain source is its own name)', async () => {
    await reframe()
    expect(path.basename(String(lastReframeSpec().outputPath))).toBe('stream-aB3dE5fG_reframe-1080x1920-center.mp4')
  })

  it('Reframe: a sourceName is sanitized, because it is joined into a path', async () => {
    await reframe({ sourceName: '..\\..\\evil/name: *?"<>|' })
    const out = String(lastReframeSpec().outputPath)
    expect(path.dirname(out)).toBe(path.resolve(outDir))
    expect(path.basename(out)).not.toMatch(/[\\/:*?"<>|]/)
    expect(path.basename(out)).toMatch(/_reframe-1080x1920-center\.mp4$/)
  })

  it('Reframe: a blank or non-string sourceName falls back to the scratch name', async () => {
    for (const sourceName of ['', '   ', 5, null]) {
      await reframe({ sourceName })
      expect(path.basename(String(lastReframeSpec().outputPath))).toBe('stream-aB3dE5fG_reframe-1080x1920-center.mp4')
    }
  })

  it('Reframe: a name in another script keeps its letters (the sanitizer is Unicode-aware)', async () => {
    await reframe({ sourceName: '토끼 방송' })
    expect(path.basename(String(lastReframeSpec().outputPath))).toMatch(/^토끼 ?방송_reframe-/)
  })

  it('the GIF hands the runner the sanitized display name beside the source path', async () => {
    await gif({ sourceName: 'stream' })
    const calls = runGifExport.mock.calls as unknown as Array<[Record<string, unknown>]>
    expect(calls[0]?.[0]).toMatchObject({ sourcePath: source, sourceName: 'stream' })
  })

  it('the GIF with no sourceName passes none (the runner falls back to the scratch name)', async () => {
    await gif()
    const calls = runGifExport.mock.calls as unknown as Array<[Record<string, unknown>]>
    expect(calls[0]?.[0].sourceName).toBeUndefined()
  })

  it('the GIF sanitizes it too', async () => {
    await gif({ sourceName: 'a/b\\c:d' })
    const calls = runGifExport.mock.calls as unknown as Array<[Record<string, unknown>]>
    expect(String(calls[0]?.[0].sourceName)).not.toMatch(/[\\/:]/)
  })
})

// T-125 (22): the scratch-name class, completed. Export names a file `{source}_{clip}_{preset}`; Reframe and the GIF carried only the
// source, so six highlights scanned from one VOD, reframed or turned into GIFs with the same settings, came out as "name.mp4",
// "name (2).mp4" ... "name (6).mp4" - the same name six times, and the person left to open each to learn which clip it was.
describe('Reframe and the GIF carry the clip\'s name after the video\'s, as Export does (T-125 (22))', () => {
  it('Reframe: <source>_<clip>_reframe-WxH-<side>.mp4', async () => {
    await reframe({ sourceName: 'stream', clipName: 'Cold open' })
    expect(path.basename(String(lastReframeSpec().outputPath))).toBe('stream_Cold open_reframe-1080x1920-center.mp4')
  })

  it('Reframe: two clips of one video get two names', async () => {
    await reframe({ sourceName: 'stream', clipName: 'Highlight 1' })
    const first = path.basename(String(lastReframeSpec().outputPath))
    await reframe({ sourceName: 'stream', clipName: 'Highlight 2' })
    const second = path.basename(String(lastReframeSpec().outputPath))
    expect(first).not.toBe(second)
  })

  it('Reframe: the clip name is sanitized like the source name, because it is joined into a path', async () => {
    await reframe({ sourceName: 'stream', clipName: '..\\..\\evil/clip: *?"<>|' })
    const out = String(lastReframeSpec().outputPath)
    expect(path.dirname(out)).toBe(path.resolve(outDir))
    expect(path.basename(out)).not.toMatch(/[\\/:*?"<>|]/)
    expect(path.basename(out)).toMatch(/^stream_.*_reframe-1080x1920-center\.mp4$/)
  })

  it('Reframe: a blank or non-string clip name adds nothing (the name is what it was)', async () => {
    for (const clipName of [undefined, '', '   ', 5, null]) {
      await reframe({ sourceName: 'stream', clipName })
      expect(path.basename(String(lastReframeSpec().outputPath))).toBe('stream_reframe-1080x1920-center.mp4')
    }
  })

  it('Reframe: a clip name with no source name rides on the scratch basename, as the source part always did', async () => {
    await reframe({ clipName: 'Cold open' })
    expect(path.basename(String(lastReframeSpec().outputPath))).toBe('stream-aB3dE5fG_Cold open_reframe-1080x1920-center.mp4')
  })

  it('the GIF: the runner is handed <source>_<clip> as its base name', async () => {
    await gif({ sourceName: 'stream', clipName: 'Cold open' })
    const calls = runGifExport.mock.calls as unknown as Array<[Record<string, unknown>]>
    expect(calls[0]?.[0].sourceName).toBe('stream_Cold open')
  })

  it('the GIF: sanitized, and a blank clip name adds nothing', async () => {
    await gif({ sourceName: 'stream', clipName: 'a/b\\c:d' })
    let calls = runGifExport.mock.calls as unknown as Array<[Record<string, unknown>]>
    expect(String(calls[0]?.[0].sourceName)).toMatch(/^stream_a_b_c_d$/)
    runGifExport.mockClear()
    await gif({ sourceName: 'stream', clipName: '  ' })
    calls = runGifExport.mock.calls as unknown as Array<[Record<string, unknown>]>
    expect(calls[0]?.[0].sourceName).toBe('stream')
  })

  it('the GIF with neither passes none: the runner falls back to the scratch name, as before', async () => {
    await gif()
    const calls = runGifExport.mock.calls as unknown as Array<[Record<string, unknown>]>
    expect(calls[0]?.[0].sourceName).toBeUndefined()
  })
})
