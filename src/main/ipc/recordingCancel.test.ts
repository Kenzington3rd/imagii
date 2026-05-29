import { describe, it, expect, vi } from 'vitest'

// Round 17 phase-6: cover the recording cancel single-slot exported from
// ipc/recording.ts (round 15 M6). Mocks the electron surface the module
// touches at import-time.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  desktopCapturer: { getSources: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => []
  },
  app: { getPath: () => '/tmp/imagii-test-userdata' }
}))

const { cancelRecordingConvert } = await import('./recording')

describe('cancelRecordingConvert', () => {
  it('returns false when there is no in-flight conversion', () => {
    expect(cancelRecordingConvert()).toBe(false)
  })

  it('is idempotent', () => {
    expect(cancelRecordingConvert()).toBe(false)
    expect(cancelRecordingConvert()).toBe(false)
  })
})
