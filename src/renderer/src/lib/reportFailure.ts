import toast from 'react-hot-toast'
import { CANCEL_TOAST_MS, ERROR_TOAST_MS, userFacingError } from '@shared/userFacingError'

/**
 * T-84 — what every `catch` around a `window.api.*` call does with the error.
 *
 * `failed` is the feature's context sentence ("GIF export failed.") — the
 * words used when nothing more specific is known, and the lead-in when it is.
 * `canceled` is the feature's own neutral line ("GIF canceled."); only the
 * feature knows what "canceled" means for it (a batch can say what already
 * finished). A job the user stopped raises a plain `toast(...)` — no red
 * cross, no `toast.error` — and a failure raises `toast.error` for long
 * enough to be read (`ERROR_TOAST_MS`).
 *
 * Returns what was decided and the sentence shown, so a caller that also
 * paints state (ExportPanel's queue rows) uses the SAME verdict and words
 * rather than classifying the error a second time.
 */
export function reportFailure(
  err: unknown,
  copy: { failed: string; canceled?: string }
): { cancelled: boolean; message: string } {
  const { cancelled, message } = userFacingError(err, copy.failed)
  if (cancelled) {
    const text = copy.canceled ?? message
    toast(text, { duration: CANCEL_TOAST_MS })
    return { cancelled, message: text }
  }
  toast.error(message, { duration: ERROR_TOAST_MS })
  return { cancelled, message }
}
