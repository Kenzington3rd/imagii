/**
 * What main does when the window's renderer process goes away (T-123 (15)).
 *
 * Nothing used to listen for `render-process-gone`: a renderer that died (out of memory on a
 * huge file, a GPU-process fault) left a window that looked alive and painted nothing. The
 * sweep proved `webContents.reload()` brings it back to Home, which is where the autosave
 * banner lives, so the work is offered back.
 *
 * One reload per crash, and never a loop: a renderer that dies while it LOADS would otherwise be
 * reloaded forever. A second death inside the cooldown is left as it is (and logged), and a
 * crash after the cooldown is a new crash.
 */
export const CRASH_RELOAD_COOLDOWN_MS = 30_000

export type RendererGoneAction = 'reload' | 'ignore' | 'leave'

/**
 * `reason` is Electron's `details.reason`. `leaving` is "the app is quitting or the window is
 * already gone": the renderer is killed on purpose then and there is nothing to reload into.
 */
export function rendererGoneAction(
  reason: string,
  nowMs: number,
  lastReloadAtMs: number | null,
  leaving: boolean
): RendererGoneAction {
  if (leaving || reason === 'clean-exit') return 'ignore'
  if (lastReloadAtMs !== null && nowMs - lastReloadAtMs < CRASH_RELOAD_COOLDOWN_MS) return 'leave'
  return 'reload'
}
