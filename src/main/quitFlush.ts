import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { ImagiiProject } from '../shared/workspace'
import { assert } from '../shared/assert'
import { writeAutosave } from './autosave'

/**
 * T-47 — the final autosave, taken as the app goes down.
 *
 * The debounced autosave in the renderer writes at most every 5 s, so the
 * last few seconds of a session are normally lost: close the app right
 * after a trim and the snapshot offered on the next launch predates it.
 * On quit, main asks the renderer for one more capture and writes it.
 *
 * Two rules the implementation exists to keep:
 *
 *   - **Quit never hangs.** The whole exchange — round trip to the renderer
 *     plus the disk write — races a single deadline. A wedged renderer, a
 *     spun-down external drive or an antivirus scanner sitting on the
 *     userData folder costs the user QUIT_FLUSH_TIMEOUT_MS and no more; the
 *     app then quits with the previous snapshot still intact on disk.
 *   - **Nothing crosses back to the renderer.** The outcome is main's
 *     business. A failing write must not surface raw IPC text in a UI that
 *     is on its way out (T-44's sentinel rule).
 */

/**
 * 1.5 s. A snapshot is a small JSON write plus an fsync — single-digit
 * milliseconds on a healthy disk — so this is ~100x the expected cost, wide
 * enough to cover a sleeping drive or a Windows AV scan of the file, and
 * still under the ~2 s where a window that has not gone away yet reads as
 * a hang rather than as a save.
 */
export const QUIT_FLUSH_TIMEOUT_MS = 1500

/** Main -> renderer: "send me one last snapshot". */
export const QUIT_SNAPSHOT_REQUEST = 'autosave:requestQuitSnapshot'
/** Renderer -> main: the snapshot, or null when there is nothing to save. */
export const QUIT_SNAPSHOT_REPLY = 'autosave:quitSnapshot'

export type QuitFlushOutcome =
  /** The final snapshot reached disk. */
  | 'written'
  /** The renderer had nothing worth saving (empty session, or a restore
   *  was mid-flight and capturing would have snapshot half a project). */
  | 'nothing-to-save'
  /** The autosave guards refused it (no studio state, too large). */
  | 'refused'
  /** No live window to ask — the renderer is already gone. */
  | 'no-window'
  /** The deadline won. Quit proceeds; the previous snapshot stands. */
  | 'timeout'
  /** The renderer answered but the write threw. */
  | 'failed'

interface FlushDeps {
  /** Injected by the unit tests to drive the slow-disk branch. */
  write?: (
    project: ImagiiProject
  ) => Promise<{ ok: true; sizeBytes: number } | { ok: false; reason: string }>
  timeoutMs?: number
}

export async function flushAutosaveOnQuit(
  win: BrowserWindow | null,
  deps: FlushDeps = {}
): Promise<QuitFlushOutcome> {
  const timeoutMs = deps.timeoutMs ?? QUIT_FLUSH_TIMEOUT_MS
  const write = deps.write ?? writeAutosave
  assert(Number.isFinite(timeoutMs) && timeoutMs > 0, 'quit flush timeout must be positive')
  assert(typeof write === 'function', 'quit flush needs a write function')

  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return 'no-window'

  let settle: (outcome: QuitFlushOutcome) => void = () => undefined
  const done = new Promise<QuitFlushOutcome>((resolve) => {
    // Resolving twice is a no-op, which is what makes the race safe: the
    // deadline and the reply can both fire, and the first one wins.
    settle = resolve
  })
  const timer = setTimeout(() => settle('timeout'), timeoutMs)

  const onReply = (_event: unknown, project: ImagiiProject | null): void => {
    void (async () => {
      if (!project) {
        settle('nothing-to-save')
        return
      }
      try {
        const result = await write(project)
        settle(result.ok ? 'written' : 'refused')
      } catch {
        settle('failed')
      }
    })()
  }

  ipcMain.once(QUIT_SNAPSHOT_REPLY, onReply)
  try {
    win.webContents.send(QUIT_SNAPSHOT_REQUEST)
  } catch {
    settle('failed')
  }

  const outcome = await done
  clearTimeout(timer)
  ipcMain.removeListener(QUIT_SNAPSHOT_REPLY, onReply)
  return outcome
}
