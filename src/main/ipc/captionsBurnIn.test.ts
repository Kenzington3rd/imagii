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

const base = {
  jobId: 'job-1',
  videoPath: path.join(tmpdir(), 'in.mp4'),
  srtPath: path.join(tmpdir(), 'in.srt'),
  outputPath: path.join(tmpdir(), 'out.mp4'),
  fontSizePct: 4
}
const sender = { send: vi.fn() }
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
