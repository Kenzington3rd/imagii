import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import { tmpdir } from 'node:os'

// T-81: captions:burnIn refuses a bad clip range at the IPC boundary, before
// any file is read or ffmpeg spawned. The handler imports electron, so it is
// driven here through a captured ipcMain.handle with the burn-in runner
// mocked out: "rejected" and "runner never called" are the two halves of
// "before any work".
const handlers = new Map<string, (e: unknown, req: unknown) => Promise<unknown>>()
const runBurnIn = vi.fn(async (req: { outputPath: string }) => ({
  outputPath: req.outputPath,
  captioned: true
}))

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
vi.mock('../sidecars/whisperManager', () => ({
  cancelBurnIn: vi.fn(),
  cancelWhisperModelInstall: vi.fn(),
  getCaptionsStatus: vi.fn(),
  installWhisperModel: vi.fn(),
  runBurnIn: (...args: Parameters<typeof runBurnIn>) => runBurnIn(...args),
  runTranscribe: vi.fn()
}))

const { registerCaptionsIpc } = await import('./captions')
const { CAPTION_STYLE_PRESETS, DEFAULT_CAPTION_STYLE } = await import('../../shared/captions')

const base = {
  jobId: 'job-1',
  videoPath: path.join(tmpdir(), 'in.mp4'),
  srtPath: path.join(tmpdir(), 'in.srt'),
  outputPath: path.join(tmpdir(), 'out.mp4'),
  fontSizePct: 4
}
const sender = { isDestroyed: () => false, send: vi.fn() }
const burn = (extra: Record<string, unknown>): Promise<unknown> => {
  const handler = handlers.get('captions:burnIn')
  if (!handler) throw new Error('captions:burnIn was not registered')
  return handler({ sender }, { ...base, ...extra })
}

beforeEach(() => {
  runBurnIn.mockClear()
  handlers.clear()
  registerCaptionsIpc()
})

describe('captions:burnIn range validation (T-81)', () => {
  it('passes an unranged request and a real range through to the runner', async () => {
    // T-89: the runner's `captioned` flag crosses the bridge untouched — the
    // panel's "No captions in this range" toast reads it.
    await expect(burn({})).resolves.toEqual({ outputPath: base.outputPath, captioned: true })
    await expect(burn({ startSec: 0, endSec: 3 })).resolves.toEqual({
      outputPath: base.outputPath,
      captioned: true
    })
    await expect(burn({ startSec: 2400.5, endSec: 2460 })).resolves.toBeDefined()
    expect(runBurnIn).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['a lone startSec', { startSec: 5 }, /given together/],
    ['a lone endSec', { endSec: 5 }, /given together/],
    ['an empty range', { startSec: 5, endSec: 5 }, /greater than startSec/],
    ['an inverted range', { startSec: 9, endSec: 2 }, /greater than startSec/],
    ['a negative start', { startSec: -1, endSec: 5 }, /startSec/],
    ['NaN', { startSec: Number.NaN, endSec: 5 }, /startSec/],
    ['an infinite end', { startSec: 0, endSec: Number.POSITIVE_INFINITY }, /endSec/],
    ['numeric strings', { startSec: '2', endSec: '5' }, /startSec/]
  ])('refuses %s with a plain message, before the runner is touched', async (_label, range, message) => {
    await expect(burn(range)).rejects.toThrow(message)
    expect(runBurnIn).not.toHaveBeenCalled()
  })
})

describe('captions:burnIn caption colors (T-114)', () => {
  // The two style colors become `PrimaryColour=` / `OutlineColour=` inside the `force_style='...'`
  // of the burn's `subtitles` filter. `<input type="color">` only ever writes `#rrggbb`, so the
  // gate takes exactly that; anything else is hand-made, and the runner's own check is the
  // second line. The sentence is a finished one (`userFacingError` stands behind it); the
  // validator's path-into-the-payload detail goes to the console.
  const SENTENCE = "A caption color has a setting imagii can't use — check the text and outline colors, then try again."
  const style = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    fontSize: 32,
    position: 'bottom',
    primaryColor: '#ffffff',
    outlineColor: '#000000',
    ...extra
  })

  it('passes the style the panel sends, and an absent or null style, through to the runner', async () => {
    await expect(burn({ style: style() })).resolves.toBeDefined()
    await expect(burn({ style: style({ primaryColor: '#FFCC00', outlineColor: '#0a0b0c' }) })).resolves.toBeDefined()
    await expect(burn({ style: null })).resolves.toBeDefined()
    await expect(burn({})).resolves.toBeDefined()
    expect(runBurnIn).toHaveBeenCalledTimes(4)
  })

  it('takes every style the panel can produce: the default and each one-click preset', async () => {
    runBurnIn.mockClear()
    await expect(burn({ style: DEFAULT_CAPTION_STYLE })).resolves.toBeDefined()
    for (const preset of CAPTION_STYLE_PRESETS) {
      await expect(burn({ style: preset.style }), preset.id).resolves.toBeDefined()
    }
    expect(runBurnIn).toHaveBeenCalledTimes(1 + CAPTION_STYLE_PRESETS.length)
  })

  it.each([
    ['an ASS override smuggled in the text color', { primaryColor: '&H00FFFFFF&,Fontname=x' }],
    ['a force_style break-out in the outline color', { outlineColor: "#000000',FontName=x,Alpha='" }],
    ['a color name', { primaryColor: 'white' }],
    ['a hex without its #', { primaryColor: 'ffffff' }],
    ['the #rgb shorthand', { outlineColor: '#fff' }],
    ['a hex with a trailing payload', { primaryColor: '#ffffff,x' }],
    ['a hex with a trailing newline', { primaryColor: '#ffffff\n' }],
    ['an empty text color', { primaryColor: '' }],
    ['a missing outline color', { outlineColor: undefined }],
    ['a number for a color', { primaryColor: 16777215 }]
  ])('refuses %s in one plain sentence, before the runner is touched', async (_label, bad) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(burn({ style: style(bad) })).rejects.toThrow(SENTENCE)
      expect(runBurnIn).not.toHaveBeenCalled()
      expect(error, 'the detail goes to the console').toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })

  it('refuses a style that is not an object, in the same sentence', async () => {
    for (const bad of ['white', 7, ['#ffffff'], true]) {
      await expect(burn({ style: bad })).rejects.toThrow(SENTENCE)
    }
    expect(runBurnIn).not.toHaveBeenCalled()
  })
})
