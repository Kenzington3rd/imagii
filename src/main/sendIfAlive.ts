/**
 * The one way main reports a job's progress to a window (T-123 (1)).
 *
 * `webContents.send` on a destroyed WebContents THROWS ("Object has been destroyed"). Every
 * progress callback in main runs from a child's stdout handler or from a runner's own await, so
 * nothing above it catches the throw, and Electron raises its blocking "A JavaScript error
 * occurred in the main process" dialog: closing the window mid-export did it on 3 of 40 real
 * closes, because the WebContents dies 1-106 ms before `before-quit` kills the child and a chunk
 * the child had already written still dispatches in between. A report for a window that is gone
 * has nobody to read it, so it is dropped.
 *
 * Both halves matter: `isDestroyed()` is the cheap, honest answer, and the `try` is for a window
 * that dies between the question and the send. Returns whether the message was handed over.
 */
export interface ProgressSender {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

export function sendIfAlive(
  sender: ProgressSender | null | undefined,
  channel: string,
  payload?: unknown
): boolean {
  if (!sender) return false
  try {
    if (sender.isDestroyed()) return false
    if (payload === undefined) sender.send(channel)
    else sender.send(channel, payload)
    return true
  } catch (err) {
    console.error(`[imagii] dropped a ${channel} report for a window that went away:`, err)
    return false
  }
}
