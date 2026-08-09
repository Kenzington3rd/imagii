import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

// Round 18 H1 — streaming save protocol coverage:
//   recording:begin / appendChunk / finalize / abandon.
// Follows the recordingCancel.test.ts pattern: mock the electron surface the
// module touches at import time, capture the registered handlers from the
// ipcMain.handle mock, and drive them directly. The convertToMp4:false path
// is used throughout so no ffmpeg child is ever spawned.

let TMP = ''
const handlers = new Map<string, (...args: unknown[]) => unknown>()

// Mutable dialog/window state so each test controls the finalize branch.
const fakeWin = { webContents: { send: vi.fn() } }
let saveDialogResult: { canceled: boolean; filePath?: string } = { canceled: true }

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  },
  desktopCapturer: { getSources: vi.fn() },
  dialog: { showSaveDialog: async () => saveDialogResult },
  BrowserWindow: {
    getFocusedWindow: () => fakeWin,
    getAllWindows: () => [fakeWin]
  },
  app: { getPath: () => TMP }
}))

const { registerRecordingIpc } = await import('./recording')
registerRecordingIpc()

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return Promise.resolve(handler({}, ...args)) as Promise<T>
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function tempPathFor(id: string): string {
  return path.join(TMP, 'recordings', `${id}.webm`)
}

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'imagii-rec-stream-'))
  saveDialogResult = { canceled: true }
  fakeWin.webContents.send.mockClear()
})
afterEach(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true })
})

describe('recording streaming protocol', () => {
  it('begin returns a nanoid-alphabet session id and creates the temp file', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(existsSync(tempPathFor(id))).toBe(true)
    await invoke('recording:abandon', id)
  })

  it('begin/append/finalize happy path writes the chunks in append order', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('hello '))
    await invoke('recording:appendChunk', id, bytes('world'))

    const outPath = path.join(TMP, 'saved-take.webm')
    saveDialogResult = { canceled: false, filePath: outPath }
    const result = await invoke<{
      outputPath: string
      sizeBytes: number
      format: string
      durationMs: number
    } | null>('recording:finalize', id, {
      filename: 'take.webm',
      durationMs: 1234,
      convertToMp4: false
    })

    expect(result).not.toBeNull()
    expect(result?.outputPath).toBe(outPath)
    expect(result?.sizeBytes).toBe('hello world'.length)
    expect(result?.format).toBe('webm')
    expect(result?.durationMs).toBe(1234)
    expect(readFileSync(outPath, 'utf8')).toBe('hello world')
    // Temp file is reaped after promotion.
    expect(existsSync(tempPathFor(id))).toBe(false)
  })

  it('preserves byte order across many sequential appends', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    let expected = ''
    for (let i = 0; i < 25; i++) {
      const piece = `chunk-${i};`
      expected += piece
      await invoke('recording:appendChunk', id, bytes(piece))
    }
    const outPath = path.join(TMP, 'ordered.webm')
    saveDialogResult = { canceled: false, filePath: outPath }
    await invoke('recording:finalize', id, { filename: 'x.webm', convertToMp4: false })
    expect(readFileSync(outPath, 'utf8')).toBe(expected)
  })

  it('append with a malformed id rejects', async () => {
    await expect(
      invoke('recording:appendChunk', '../escape', bytes('x'))
    ).rejects.toThrow(/malformed/)
  })

  it('append with an unknown (well-formed) id rejects', async () => {
    await expect(
      invoke('recording:appendChunk', 'zzzzzzzzzz', bytes('x'))
    ).rejects.toThrow(/unknown session/)
  })

  it('append with an empty chunk rejects', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await expect(
      invoke('recording:appendChunk', id, new ArrayBuffer(0))
    ).rejects.toThrow(/must not be empty/)
    await invoke('recording:abandon', id)
  })

  it('append with a non-buffer chunk rejects', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await expect(
      invoke('recording:appendChunk', id, 'not bytes')
    ).rejects.toThrow(/ArrayBuffer/)
    await invoke('recording:abandon', id)
  })

  it('append after finalize rejects and the temp file is reaped', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('data'))
    // Canceled dialog: finalize resolves null but the session is closed.
    saveDialogResult = { canceled: true }
    const result = await invoke('recording:finalize', id, {
      filename: 'take.webm',
      convertToMp4: false
    })
    expect(result).toBeNull()
    expect(existsSync(tempPathFor(id))).toBe(false)
    await expect(
      invoke('recording:appendChunk', id, bytes('straggler'))
    ).rejects.toThrow(/unknown session/)
  })

  it('finalize twice rejects the second call', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('data'))
    saveDialogResult = { canceled: true }
    await invoke('recording:finalize', id, { filename: 'a.webm', convertToMp4: false })
    await expect(
      invoke('recording:finalize', id, { filename: 'a.webm', convertToMp4: false })
    ).rejects.toThrow(/unknown session/)
  })

  it('finalize with zero appended bytes rejects and reaps the temp file', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await expect(
      invoke('recording:finalize', id, { filename: 'a.webm', convertToMp4: false })
    ).rejects.toThrow(/empty/)
    expect(existsSync(tempPathFor(id))).toBe(false)
  })

  it('finalize validates its spec', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await expect(
      invoke('recording:finalize', id, { filename: '', convertToMp4: false })
    ).rejects.toThrow(/filename/)
    await expect(
      invoke('recording:finalize', id, { filename: 'a.webm', convertToMp4: 'yes' })
    ).rejects.toThrow(/convertToMp4/)
    await expect(
      invoke('recording:finalize', '../nope', { filename: 'a.webm', convertToMp4: false })
    ).rejects.toThrow(/malformed/)
    await invoke('recording:abandon', id)
  })

  it('abandon removes the partial temp file and returns true, then false', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('partial data'))
    expect(existsSync(tempPathFor(id))).toBe(true)
    expect(await invoke('recording:abandon', id)).toBe(true)
    expect(existsSync(tempPathFor(id))).toBe(false)
    // Idempotent: the renderer calls abandon on already-reaped sessions.
    expect(await invoke('recording:abandon', id)).toBe(false)
  })

  it('append after abandon rejects', async () => {
    const { id } = await invoke<{ id: string }>('recording:begin')
    await invoke('recording:appendChunk', id, bytes('partial'))
    await invoke('recording:abandon', id)
    await expect(
      invoke('recording:appendChunk', id, bytes('more'))
    ).rejects.toThrow(/unknown session/)
  })

  it('abandon with a malformed id rejects', async () => {
    await expect(invoke('recording:abandon', '../etc/passwd')).rejects.toThrow(
      /malformed/
    )
  })
})
