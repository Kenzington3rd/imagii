/**
 * Electron wraps anything an `ipcMain.handle` handler throws before the
 * renderer sees it. What main threw as
 *
 *   "Converting the recording to MP4 failed (ffmpeg exit code 1)."
 *
 * arrives as
 *
 *   "Error invoking remote method 'recording:finalize': Error: Converting…"
 *
 * so a catch that toasts `err.message` verbatim shows the user a channel
 * name, the word "remote" for something that never left their machine, and
 * the word "Error" twice (T-30, T-59). This unwraps the envelope and hands
 * back the sentence main actually wrote, or `fallback` when there is
 * nothing readable inside it.
 *
 * Main is still responsible for putting friendly copy in the envelope —
 * unwrapping a stack trace only makes a shorter stack trace.
 */
const IPC_ENVELOPE = /^Error invoking remote method '[^']*':\s*/
const ERROR_LABEL = /^[A-Za-z]*Error:\s+/

export function ipcErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  let message = raw.replace(IPC_ENVELOPE, '')
  // Electron re-serializes main's Error as "Error: <message>", and a handler
  // that rethrew a wrapped error can stack more than one label.
  while (ERROR_LABEL.test(message)) message = message.replace(ERROR_LABEL, '')
  message = message.trim()
  return message.length > 0 ? message : fallback
}
