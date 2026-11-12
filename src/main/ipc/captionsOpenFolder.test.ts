import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

/**
 * T-119 (7) - "Open models folder" opens a folder that is there.
 *
 * Nothing creates `<userData>/models` before the model installer runs (`installWhisperModel` makes it for
 * itself), so on a fresh profile the button handed `shell.openPath` a path that did not exist and nothing
 * opened - on exactly the screen that tells a person to put the model file there. T-102 gave the bin folder
 * `ensureUserBinDir`; this is the models folder's equivalent, in the handler. This runs the REAL handler with
 * the real filesystem; only electron and the captions status are stood in for.
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
let modelsDir = ''
/** What the folder looked like at the instant `shell.openPath` was called. */
let atOpen: { existed: boolean; path: string } | null = null
let openResult = ''
const openPath = vi.fn(async (p: string): Promise<string> => {
  atOpen = { existed: existsSync(p), path: p }
  return openResult
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  },
  dialog: {},
  BrowserWindow: { getFocusedWindow: () => ({}), getAllWindows: () => [{}] },
  shell: { openPath: (p: string) => openPath(p) },
  app: { getPath: () => tmpdir() }
}))
vi.mock('../sidecars/whisperManager', () => ({
  cancelBurnIn: vi.fn(),
  cancelTranscribe: vi.fn(),
  cancelWhisperModelInstall: vi.fn(),
  getCaptionsStatus: () => ({ modelsDir, exePath: path.join(modelsDir, '..', 'bin', 'whisper-cli.exe') }),
  installWhisperModel: vi.fn(),
  runBurnIn: vi.fn(),
  runTranscribe: vi.fn()
}))
vi.mock('../sidecars/paths', () => ({ captionsOutputDir: () => tmpdir() }))

const { registerCaptionsIpc } = await import('./captions')

const openModels = (): Promise<unknown> => {
  const handler = handlers.get('captions:openModelsFolder')
  if (!handler) throw new Error('captions:openModelsFolder was not registered')
  return handler({})
}

let scratch = ''
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-open-models-'))
  modelsDir = path.join(scratch, 'userData', 'models')
  atOpen = null
  openResult = ''
  openPath.mockClear()
  registerCaptionsIpc()
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(scratch, { recursive: true, force: true })
})

describe('captions:openModelsFolder (T-119)', () => {
  it('creates the folder on a fresh profile BEFORE it asks the shell to open it', async () => {
    expect(existsSync(modelsDir), 'the fixture starts with no models folder').toBe(false)
    await openModels()
    expect(openPath).toHaveBeenCalledTimes(1)
    expect(atOpen).toEqual({ existed: true, path: modelsDir })
    expect(existsSync(modelsDir)).toBe(true)
  })

  it('creates the parents too (a profile that has never been used has no userData folder)', async () => {
    expect(existsSync(path.dirname(modelsDir))).toBe(false)
    await openModels()
    expect(existsSync(modelsDir)).toBe(true)
  })

  it('is idempotent: a folder that already holds the model is opened as it is', async () => {
    mkdirSync(modelsDir, { recursive: true })
    const model = path.join(modelsDir, 'ggml-base.en.bin')
    writeFileSync(model, 'model bytes')
    await openModels()
    await openModels()
    expect(readFileSync(model, 'utf8')).toBe('model bytes')
    expect(openPath).toHaveBeenCalledTimes(2)
    expect(atOpen?.existed).toBe(true)
  })

  it('logs what the shell could not open, and says nothing when it opened', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await openModels()
    expect(log).not.toHaveBeenCalled()
    openResult = 'Failed to open path'
    await openModels()
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0]?.join(' '))).toContain('Failed to open path')
  })

  it('does not throw across the bridge when the folder cannot be made (a file sits where it goes)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mkdirSync(path.dirname(modelsDir), { recursive: true })
    writeFileSync(modelsDir, 'a file, not a folder')
    await expect(openModels()).resolves.toBeUndefined()
    expect(log).toHaveBeenCalled()
  })
})
