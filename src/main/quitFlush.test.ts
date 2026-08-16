import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ImagiiProject } from '../shared/workspace'

/**
 * T-47 — the quit flush, and the promise that it can never hold quit open.
 *
 * The interesting branch is the one a manual test cannot produce on demand:
 * a disk (or a renderer) slow enough that the write is still running when
 * the user's window should already be gone. It is driven here by injecting
 * a write that never settles, and the assertion is that the call comes back
 * anyway, with 'timeout', inside the budget.
 */

const sent: string[] = []
const ipcMain = new EventEmitter() as EventEmitter & {
  once: (channel: string, listener: (...args: unknown[]) => void) => void
}

vi.mock('electron', () => ({
  ipcMain,
  app: { getPath: () => '/tmp/imagii-quitflush-test' }
}))

const {
  flushAutosaveOnQuit,
  QUIT_FLUSH_TIMEOUT_MS,
  QUIT_SNAPSHOT_REQUEST,
  QUIT_SNAPSHOT_REPLY
} = await import('./quitFlush')

const PROJECT: ImagiiProject = {
  schemaVersion: 3,
  savedAt: Date.now(),
  appVersion: '1.0.0',
  place: { route: '/video' },
  videoStudio: { sourcePath: 'C:/clip.mp4', clips: [], selectedClipId: null }
}

/** A window that answers the flush request with `reply` after `delayMs`. */
function fakeWindow(reply: ImagiiProject | null, delayMs = 0): {
  isDestroyed: () => boolean
  webContents: { isDestroyed: () => boolean; send: (channel: string) => void }
} {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string) => {
        sent.push(channel)
        setTimeout(() => ipcMain.emit(QUIT_SNAPSHOT_REPLY, {}, reply), delayMs)
      }
    }
  }
}

/** A window whose renderer never answers at all. */
const silentWindow = {
  isDestroyed: () => false,
  webContents: {
    isDestroyed: () => false,
    send: (channel: string): void => {
      sent.push(channel)
    }
  }
}

// The fakes above stand in for BrowserWindow at the one narrow surface the
// flush touches (isDestroyed / webContents.send).
const asWindow = (w: unknown): Parameters<typeof flushAutosaveOnQuit>[0] =>
  w as Parameters<typeof flushAutosaveOnQuit>[0]

beforeEach(() => {
  sent.length = 0
  ipcMain.removeAllListeners()
})

describe('flushAutosaveOnQuit', () => {
  it('asks the renderer and writes the snapshot it gets back', async () => {
    const written: ImagiiProject[] = []
    const outcome = await flushAutosaveOnQuit(asWindow(fakeWindow(PROJECT)), {
      write: async (p) => {
        written.push(p)
        return { ok: true, sizeBytes: 42 }
      }
    })

    expect(outcome).toBe('written')
    expect(sent).toEqual([QUIT_SNAPSHOT_REQUEST])
    expect(written).toHaveLength(1)
    expect(written[0]?.place?.route).toBe('/video')
  })

  it('returns without writing when the renderer has nothing to save', async () => {
    const write = vi.fn()
    const outcome = await flushAutosaveOnQuit(asWindow(fakeWindow(null)), { write })

    expect(outcome).toBe('nothing-to-save')
    expect(write).not.toHaveBeenCalled()
  })

  it('reports a refusal from the autosave guards without throwing', async () => {
    const outcome = await flushAutosaveOnQuit(asWindow(fakeWindow(PROJECT)), {
      write: async () => ({ ok: false, reason: 'no studio state to save' })
    })
    expect(outcome).toBe('refused')
  })

  it('survives a write that throws', async () => {
    const outcome = await flushAutosaveOnQuit(asWindow(fakeWindow(PROJECT)), {
      write: async () => {
        throw new Error('EACCES')
      }
    })
    expect(outcome).toBe('failed')
  })

  it('gives up on a slow disk instead of holding quit open', async () => {
    const started = Date.now()
    const outcome = await flushAutosaveOnQuit(asWindow(fakeWindow(PROJECT)), {
      // The write never settles: a spun-down drive, a locked file, an AV
      // scanner sitting on userData.
      write: () => new Promise(() => undefined),
      timeoutMs: 120
    })
    const elapsed = Date.now() - started

    expect(outcome).toBe('timeout')
    expect(elapsed).toBeLessThan(2000)
  })

  it('gives up on a renderer that never answers', async () => {
    const outcome = await flushAutosaveOnQuit(asWindow(silentWindow), {
      write: async () => ({ ok: true, sizeBytes: 1 }),
      timeoutMs: 100
    })
    expect(outcome).toBe('timeout')
  })

  it('leaves no listener behind, on either path', async () => {
    await flushAutosaveOnQuit(asWindow(fakeWindow(PROJECT)), {
      write: async () => ({ ok: true, sizeBytes: 1 })
    })
    expect(ipcMain.listenerCount(QUIT_SNAPSHOT_REPLY)).toBe(0)

    await flushAutosaveOnQuit(asWindow(silentWindow), {
      write: async () => ({ ok: true, sizeBytes: 1 }),
      timeoutMs: 60
    })
    // A timed-out flush that leaked its listener would make the NEXT quit
    // in the same process resolve on a stale reply.
    expect(ipcMain.listenerCount(QUIT_SNAPSHOT_REPLY)).toBe(0)
  })

  it('does nothing when the window is already gone', async () => {
    const write = vi.fn()
    const destroyed = {
      isDestroyed: () => true,
      webContents: { isDestroyed: () => true, send: () => undefined }
    }
    expect(await flushAutosaveOnQuit(null, { write })).toBe('no-window')
    expect(await flushAutosaveOnQuit(asWindow(destroyed), { write })).toBe('no-window')
    expect(write).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('rejects a nonsense timeout rather than quietly waiting forever', async () => {
    await expect(
      flushAutosaveOnQuit(asWindow(fakeWindow(PROJECT)), { timeoutMs: 0 })
    ).rejects.toThrow(/timeout/)
  })

  it('keeps a budget a user would not notice', () => {
    expect(QUIT_FLUSH_TIMEOUT_MS).toBeGreaterThan(0)
    expect(QUIT_FLUSH_TIMEOUT_MS).toBeLessThanOrEqual(2000)
  })

  it('uses the same channel names the preload bridge listens on', () => {
    // The two files name these channels independently (preload cannot
    // import from main), so drift here would silently disable the flush:
    // main would ask on a channel nobody hears and every quit would cost
    // the timeout.
    const preload = readFileSync(
      path.join(process.cwd(), 'src/preload/index.ts'),
      'utf8'
    )
    expect(preload).toContain(`'${QUIT_SNAPSHOT_REQUEST}'`)
    expect(preload).toContain(`'${QUIT_SNAPSHOT_REPLY}'`)
  })
})
