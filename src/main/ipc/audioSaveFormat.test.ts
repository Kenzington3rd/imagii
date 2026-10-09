import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'

// T-90: the save dialog and the suggested file name for an audio export, driven
// through the REAL handlers (a captured ipcMain.handle, with Electron's dialog
// stubbed). Two things were wrong and are pinned here:
//   1. the AAC option was saved as a bare `.aac` — a raw stream most players do
//      not treat as audio — and now asks for `.m4a`;
//   2. "Re-attach to video" asks for the `mp4` format, which the handlers'
//      validator (the four audio formats only) rejected, so every export from a
//      video threw before the dialog opened.
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
const showSaveDialog = vi.fn(
  async (_win: unknown, _opts: { title?: string; defaultPath?: string; filters?: unknown[] }) => ({
    canceled: false,
    filePath: '/picked/out'
  })
)

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  },
  dialog: { showSaveDialog: (...a: Parameters<typeof showSaveDialog>) => showSaveDialog(...a) },
  BrowserWindow: {
    getFocusedWindow: () => ({ id: 1 }),
    getAllWindows: () => [{ id: 1 }]
  },
  shell: {},
  app: { getPath: () => tmpdir() }
}))

const { registerAudioIpc } = await import('./audio')

// async so a handler that throws synchronously (suggestOutputName) still
// reaches the test as a rejection, the way Electron hands it to the renderer.
async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`${channel} was not registered`)
  return h({ sender: { send: vi.fn() } }, ...args)
}

const SRC = `${tmpdir()}/my voice.wav`

beforeEach(() => {
  handlers.clear()
  showSaveDialog.mockClear()
  registerAudioIpc()
})

describe('audio:suggestOutputName', () => {
  it.each([
    ['mp3', 'my voice-cleaned.mp3'],
    ['wav', 'my voice-cleaned.wav'],
    ['flac', 'my voice-cleaned.flac'],
    ['aac', 'my voice-cleaned.m4a'],
    ['mp4', 'my voice-cleaned.mp4']
  ])('%s is suggested as %s', async (format, expected) => {
    await expect(call('audio:suggestOutputName', SRC, format)).resolves.toBe(expected)
  })

  it('refuses a format that is not one of ours, before building a name', async () => {
    await expect(call('audio:suggestOutputName', SRC, 'ogg')).rejects.toThrow(/format/)
  })
})

describe('audio:pickOutputFile', () => {
  it('AAC opens the dialog for .m4a, filtered to .m4a', async () => {
    await call('audio:pickOutputFile', { format: 'aac' })
    const opts = showSaveDialog.mock.calls[0]?.[1]
    expect(opts?.defaultPath).toBe('cleaned.m4a')
    expect(opts?.filters).toEqual([{ name: 'M4A', extensions: ['m4a'] }])
  })

  it('keeps the suggested name it is handed', async () => {
    await call('audio:pickOutputFile', { format: 'aac', defaultName: 'take-cleaned.m4a' })
    expect(showSaveDialog.mock.calls[0]?.[1]?.defaultPath).toBe('take-cleaned.m4a')
  })

  it.each(['mp3', 'wav', 'flac'])('%s keeps its own extension', async (format) => {
    await call('audio:pickOutputFile', { format })
    expect(showSaveDialog.mock.calls[0]?.[1]?.filters).toEqual([
      { name: format.toUpperCase(), extensions: [format] }
    ])
  })

  it('mp4 — the re-attach save — opens a dialog instead of throwing', async () => {
    await expect(call('audio:pickOutputFile', { format: 'mp4' })).resolves.toBe('/picked/out')
    const opts = showSaveDialog.mock.calls[0]?.[1]
    expect(opts?.filters).toEqual([{ name: 'MP4', extensions: ['mp4'] }])
    expect(opts?.title).toBe('Save video with cleaned audio')
  })

  it('a cancelled dialog is null, and a hostile format never reaches the dialog', async () => {
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    await expect(call('audio:pickOutputFile', { format: 'mp3' })).resolves.toBeNull()
    showSaveDialog.mockClear()
    await expect(call('audio:pickOutputFile', { format: '../../x' })).rejects.toThrow(/format/)
    expect(showSaveDialog).not.toHaveBeenCalled()
  })
})
