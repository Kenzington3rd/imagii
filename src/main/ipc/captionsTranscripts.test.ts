import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

/**
 * T-128 (3), T-110 (s) - `captions:countTranscripts` and `captions:clearTranscripts`.
 *
 * The two handlers take NO argument: the folder is main's own (`captionsOutputDir()`), so a renderer cannot aim a "clear" anywhere. This
 * runs the real handlers over a real `userData` and holds three things: the count is the transcripts, the clear removes them and reports
 * the count, and neither reaches the folders beside `captions` (models, bin) however the call is made - including with an argument.
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
let userData = ''

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  },
  dialog: {},
  BrowserWindow: { getFocusedWindow: () => ({}), getAllWindows: () => [{}] },
  shell: {},
  app: { getPath: () => userData }
}))
vi.mock('../sidecars/whisperManager', () => ({
  cancelBurnIn: vi.fn(),
  cancelTranscribe: vi.fn(),
  cancelWhisperModelInstall: vi.fn(),
  getCaptionsStatus: vi.fn(),
  installWhisperModel: vi.fn(),
  runBurnIn: vi.fn(),
  runTranscribe: vi.fn()
}))
vi.mock('../sidecars/paths', () => ({ captionsOutputDir: () => path.join(userData, 'captions') }))

const { registerCaptionsIpc } = await import('./captions')

const call = (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`${channel} was not registered`)
  return handler({}, ...args)
}

beforeEach(() => {
  userData = mkdtempSync(path.join(tmpdir(), 'imagii-captions-clear-'))
  handlers.clear()
  registerCaptionsIpc()
})
afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

function seed(): { captions: string; models: string; other: string } {
  const captions = path.join(userData, 'captions')
  const models = path.join(userData, 'models')
  const other = path.join(userData, 'elsewhere')
  for (const d of [captions, models, other]) mkdirSync(d, { recursive: true })
  writeFileSync(path.join(captions, 'one-1.srt'), 'x', 'utf8')
  writeFileSync(path.join(captions, 'two-2.srt'), 'x', 'utf8')
  writeFileSync(path.join(models, 'ggml-base.en.srt'), 'a model folder is not ours to touch', 'utf8')
  writeFileSync(path.join(other, 'notes.srt'), 'neither is this one', 'utf8')
  return { captions, models, other }
}

describe('captions:countTranscripts / captions:clearTranscripts (T-128 (3))', () => {
  it('counts the saved transcripts, and is zero on a profile that never transcribed', async () => {
    expect(await call('captions:countTranscripts')).toBe(0)
    seed()
    expect(await call('captions:countTranscripts')).toBe(2)
  })

  it('clears them, answers how many went, and leaves the folders beside it alone', async () => {
    const { captions, models, other } = seed()
    expect(await call('captions:clearTranscripts')).toEqual({ removed: 2, failed: 0 })
    expect(readdirSync(captions)).toEqual([])
    expect(existsSync(captions), 'the folder stays').toBe(true)
    expect(existsSync(path.join(models, 'ggml-base.en.srt'))).toBe(true)
    expect(existsSync(path.join(other, 'notes.srt'))).toBe(true)
    expect(await call('captions:countTranscripts')).toBe(0)
    expect(await call('captions:clearTranscripts')).toEqual({ removed: 0, failed: 0 })
  })

  it('takes no path from the caller: an argument aimed at another folder changes nothing there', async () => {
    const { captions, models, other } = seed()
    for (const aimed of [other, models, '..', path.join(captions, '..', 'elsewhere')]) {
      await call('captions:clearTranscripts', aimed)
    }
    expect(readdirSync(captions)).toEqual([])
    expect(existsSync(path.join(models, 'ggml-base.en.srt'))).toBe(true)
    expect(existsSync(path.join(other, 'notes.srt'))).toBe(true)
  })
})
